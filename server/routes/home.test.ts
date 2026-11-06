import Fastify from 'fastify'
import { expect, test } from 'vitest'
import { openDb } from '../db'
import type { Home } from '../../shared/types'
import { gapTier, homeRoutes } from './home'

const NOW = Date.parse('2026-11-06T12:00:00.000Z')
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()
const z = { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }

async function setup() {
  const db = openDb(':memory:')
  let t = NOW
  const app = Fastify()
  await app.register(homeRoutes, { db, now: () => (t += 1000) })
  const home = async () => (await app.inject({ url: '/api/home' })).json<Home>()
  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/recents', payload: payload as object })
  return { db, home, post }
}
let n = 0
const box = (db: any, o: Record<string, unknown> = {}) => {
  const r = { short_id: `H-${++n}`, platform: 'HTB', name: `Box${n}`, difficulty: 'Easy', status: 'not_started', ...o }
  const cols = Object.keys(r)
  return Number(db.prepare(`INSERT INTO boxes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(r)).lastInsertRowid)
}
const step = (db: any, o: Record<string, unknown>) => {
  const r = { phase: 'Recon', position: 0, ...o }
  const cols = Object.keys(r)
  return Number(db.prepare(`INSERT INTO steps (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(r)).lastInsertRowid)
}

test('gapTier picks the thinnest tier', () => {
  expect(gapTier({ Easy: 105, Medium: 16, Hard: 5, Insane: 0 })).toEqual({ difficulty: 'Medium', reason: '16 Medium rooted against 105 Easy' })
  expect(gapTier({ ...z, Easy: 4 })).toEqual({ difficulty: 'Easy', reason: '4 Easy rooted so far' })
  expect(gapTier({ Easy: 20, Medium: 12, Hard: 3, Insane: 0 }).difficulty).toBe('Hard')
  expect(gapTier({ Easy: 20, Medium: 12, Hard: 8, Insane: 5 }).difficulty).toBe('Insane')
})

test('empty database', async () => {
  const { home } = await setup()
  expect(await home()).toMatchObject({
    working: null, unfinished: [], recents: [], searches: [], writeups: { items: [], more: 0 }, next: { boxes: [], difficulty: 'Easy' },
    networks: [], networksNotStarted: 0, techniques: [], deadEnds: [], rootedThisWeek: 0,
  })
})

test('working: active box, its current step and open threads', async () => {
  const { db, home } = await setup()
  const b = box(db, { name: 'Lantern', status: 'in_progress', next_step: 'try the cron', started_at: ago(5), os: 'Linux' })
  step(db, { box_id: b, position: 0, done: 1, seconds: 60, updated_at: ago(2) })
  step(db, { box_id: b, phase: 'Initial Access', position: 1, saw: 's', think: 't', tried: 'r', got: 'g', seconds: 90, updated_at: ago(1) })
  step(db, { box_id: b, phase: 'Persistence', position: 2, updated_at: ago(3) })
  db.prepare('UPDATE context SET active_box_id = ? WHERE id = 1').run(b)
  const w = (await home()).working!
  expect(w).toMatchObject({
    kind: 'box', id: b, name: 'Lantern', currentPhase: 'Initial Access', stepNumber: 2, persistence: true, totalSeconds: 150,
    lastWorked: ago(1), openThreads: 'try the cron', network: null, difficulty: 'Easy', os: 'Linux',
    step: { saw: 's', think: 't', tried: 'r', got: 'g' },
  })
})

test('working: no steps falls back to started_at; rooted active box yields to the host, else null', async () => {
  const { db, home } = await setup()
  const b = box(db, { status: 'in_progress', started_at: ago(4) })
  db.prepare('UPDATE context SET active_box_id = ? WHERE id = 1').run(b)
  expect((await home()).working).toMatchObject({ currentPhase: null, stepNumber: null, step: null, lastWorked: ago(4) })
  db.prepare(`UPDATE boxes SET status = 'rooted' WHERE id = ?`).run(b)
  expect((await home()).working).toBeNull()
  db.exec(`INSERT INTO networks (short_id, platform, name) VALUES ('N-1','THM','Wreath');
    INSERT INTO hosts (short_id, network_id, name, status, next_step) VALUES ('HS-1',1,'WEB01','in_progress','dump hashes')`)
  db.prepare('UPDATE context SET active_host_id = 1 WHERE id = 1').run()
  expect((await home()).working).toMatchObject({ kind: 'host', name: 'WEB01', network: 'Wreath', platform: 'THM', difficulty: null, openThreads: 'dump hashes' })
})

test('unfinished: boxes and started networks, newest first, nulls last, max 5, working excluded', async () => {
  const { db, home } = await setup()
  const w = box(db, { status: 'in_progress', started_at: ago(1) })
  db.prepare('UPDATE context SET active_box_id = ? WHERE id = 1').run(w)
  const a = box(db, { status: 'user_flag', difficulty: 'Hard', started_at: ago(10) })
  step(db, { box_id: a, phase: 'PrivEsc', updated_at: ago(3) })
  const old = box(db, { status: 'in_progress', started_at: ago(20) })
  box(db, { status: 'not_started' })
  box(db, { status: 'rooted' })
  db.exec(`INSERT INTO networks (short_id, platform, name, hosts_in_scope) VALUES ('N-1','HTB','Dante',13), ('N-2','HTB','Idle',null);
    INSERT INTO hosts (short_id, network_id, name, status) VALUES ('HS-1',1,'A','rooted'), ('HS-2',1,'B','in_progress'), ('HS-3',1,'C','not_started'), ('HS-4',2,'D','not_started')`)
  step(db, { host_id: 2, updated_at: ago(2) })
  const u = (await home()).unfinished
  expect(u.map((r) => `${r.kind}${r.id}`)).toEqual(['network1', `box${a}`, `box${old}`])
  expect(u[0]).toMatchObject({ difficulty: null, status: null, currentPhase: null, hosts: { rooted: 1, total: 13 }, lastWorked: ago(2) })
  expect(u[1]).toMatchObject({ currentPhase: 'PrivEsc', hosts: null, difficulty: 'Hard', status: 'user_flag' })
  for (let i = 0; i < 6; i++) box(db, { status: 'in_progress', started_at: ago(30 + i) })
  expect((await home()).unfinished).toHaveLength(5)
})

test('networks panel counts started networks, hosts total and captured flags', async () => {
  const { db, home } = await setup()
  db.exec(`INSERT INTO networks (short_id, platform, name) VALUES ('N-1','HTB','Dante'), ('N-2','HTB','Idle');
    INSERT INTO hosts (short_id, network_id, name, status) VALUES ('HS-1',1,'A','rooted'), ('HS-2',1,'B','not_started'), ('HS-3',2,'C','not_started');
    INSERT INTO flags (network_id, label, value) VALUES (1,'a','HTB{x}'), (1,'b','')`)
  const h = await home()
  expect(h.networks).toEqual([{ id: 1, name: 'Dante', hostsRooted: 1, hostsTotal: 2, flags: 1 }])
  expect(h.networksNotStarted).toBe(1)
})

test('next: 3 not_started boxes of the gap tier, newest release first, nulls last', async () => {
  const { db, home } = await setup()
  for (let i = 0; i < 10; i++) box(db, { status: 'rooted', rooted_at: ago(100) })
  for (let i = 0; i < 2; i++) box(db, { status: 'rooted', difficulty: 'Medium', rooted_at: ago(100) })
  const m = (release: string | null) => box(db, { difficulty: 'Medium', release_date: release })
  const [old, nul, mid, newer] = [m('2020-01-01'), m(null), m('2022-01-01'), m('2024-01-01')]
  box(db, { difficulty: 'Hard' })
  const x = (await home()).next
  expect(x.difficulty).toBe('Medium')
  expect(x.reason).toBe('2 Medium rooted against 10 Easy')
  expect(x.boxes.map((b) => b.id)).toEqual([newer, mid, old])
  expect(nul).toBeGreaterThan(0)
})

test('learned: techniques, dead ends and writeups use the 30-day window', async () => {
  const { db, home } = await setup()
  const b1 = box(db, { name: 'One' }), b2 = box(db, { name: 'Two' })
  const s1 = step(db, { box_id: b1, updated_at: ago(2) }), s1b = step(db, { box_id: b1, position: 1, updated_at: ago(2) })
  const s2 = step(db, { box_id: b2, updated_at: ago(5) }), sOld = step(db, { box_id: b2, position: 1, updated_at: ago(45) })
  db.exec(`INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-1','Kerberoast','Recon'), ('TQ-2','Old','Recon')`)
  for (const s of [s1, s1b, s2]) db.prepare('INSERT INTO technique_uses (technique_id, step_id) VALUES (1, ?)').run(s)
  db.prepare('INSERT INTO technique_uses (technique_id, step_id) VALUES (2, ?)').run(sOld)
  expect((await home()).techniques).toEqual([{ id: 1, name: 'Kerberoast', count: 2 }])

  step(db, { box_id: b1, position: 2, dead: 1, tried: '', saw: 'saw it', updated_at: ago(1) })
  step(db, { box_id: b2, position: 2, dead: 1, tried: 'x'.repeat(200), updated_at: ago(4) })
  step(db, { box_id: b2, position: 3, dead: 1, tried: 'ancient', updated_at: ago(40) })
  step(db, { box_id: b2, position: 4, dead: 1, body: '\n  first line\nsecond', updated_at: ago(3) })
  const d = (await home()).deadEnds
  expect(d.map((e) => e.text.slice(0, 9))).toEqual(['saw it', 'first lin', 'xxxxxxxxx'])
  expect(d[2].text).toHaveLength(120)
  expect(d[0]).toMatchObject({ kind: 'box', ownerId: b1, owner: 'One' })

  const r = (name: string, at: string, extra = '') => box(db, { name, status: 'rooted', rooted_at: at, foothold: 'f', privesc: 'p', ...(extra ? { privesc: '  ' } : {}) })
  const wa = r('W1', ago(1), 'x'), wb = r('W2', ago(2), 'x'), wc = r('W3', ago(3), 'x'), wd = r('W4', ago(4), 'x')
  r('Done', ago(1))
  const wu = (await home()).writeups
  expect(wu.items.map((i) => i.id)).toEqual([wa, wb, wc])
  expect(wu.more).toBe(1)
  expect(wd).toBeGreaterThan(0)
  expect((await home()).rootedThisWeek).toBe(5)
})

test('POST /api/recents: upsert, trim to 50, searches separate', async () => {
  const { home, post, db } = await setup()
  expect((await post({ kind: 'box', ref: '5', label: 'Lanternfish' })).statusCode).toBe(204)
  let h = await home()
  expect(h.recents).toMatchObject([{ kind: 'box', ref: '5', label: 'Lanternfish' }])
  const first = h.recents[0].openedAt
  await post({ kind: 'host', ref: '2', label: 'WEB01' })
  await post({ kind: 'box', ref: '5', label: 'Renamed' })
  h = await home()
  expect(h.recents.map((r) => r.label)).toEqual(['Renamed', 'WEB01'])
  expect(h.recents[0].openedAt > first).toBe(true)

  for (const q of ['a', 'b', 'c', 'd', 'e']) await post({ kind: 'search', ref: ` ${q} `, label: q })
  h = await home()
  expect(h.searches).toEqual(['e', 'd', 'c', 'b'])
  expect(h.recents.some((r) => r.kind === 'search')).toBe(false)

  for (let i = 1; i <= 51; i++) await post({ kind: 'reference', ref: String(i), label: `R${i}` })
  expect((db.prepare('SELECT COUNT(*) c FROM recents').get() as { c: number }).c).toBe(50)
  expect((await home()).recents).toHaveLength(8)
})

test('POST /api/recents rejects bad input and stores nothing', async () => {
  const { db, post } = await setup()
  const bad = [
    { kind: 'nope', ref: '1', label: 'x' }, { kind: 'box', ref: 'abc', label: 'x' }, { kind: 'box', ref: '0', label: 'x' },
    { kind: 'search', ref: '   ', label: 'x' }, { kind: 'search', ref: 'q'.repeat(201), label: 'x' },
    { kind: 'box', ref: '1' }, { kind: 'box', ref: '1', label: 'x'.repeat(201) }, { kind: 'box', ref: '1', label: '  ' },
  ]
  for (const b of bad) expect((await post(b)).statusCode, JSON.stringify(b)).toBe(400)
  expect((db.prepare('SELECT COUNT(*) c FROM recents').get() as { c: number }).c).toBe(0)
})
