import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { openDb } from '../../server/db'
import { fetchMachines } from './client'
import { importHtb } from './import'
import { mapMachine, type HtbMachine } from './map'

const page = JSON.parse(readFileSync(new URL('./fixtures/machines-page.json', import.meta.url), 'utf8'))
const ACTIVE = 'https://labs.hackthebox.com/api/v4/machine/paginated'
const RETIRED = 'https://labs.hackthebox.com/api/v4/machine/list/retired/paginated'
const p = (base: string, n: number) => `${base}?per_page=100&page=${n}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const empty = { data: [], meta: { current_page: 1, last_page: 1, per_page: 100 } }
const fakeFetch = (routes: Record<string, () => Response>) =>
  vi.fn(async (url: string | URL | Request, _init?: RequestInit) => routes[String(url)]?.() ?? json({ message: 'not found' }, 404))
const noWait = vi.fn(async (_ms: number) => {})
const quarry: HtbMachine = { id: 102, name: 'Quarry', os: 'Windows', difficulty: 'Medium', releaseDate: null, userOwned: false, rootOwned: false }
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/ // toISOString(), as server/routes/boxes.ts writes
const box = (db: ReturnType<typeof openDb>) => db.prepare('SELECT * FROM boxes').get() as Record<string, unknown>

describe('htb importer', () => {
  it("an item without os or release keeps the box's values", () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty, os, release_date) VALUES ('H-0042', 'HTB', 'Quarry', 'Medium', 'Windows', '2020-01-01')").run()
    expect(importHtb(db, [{ ...quarry, os: '', releaseDate: null }])).toMatchObject({ updated: 1 }) // adopted
    expect(box(db)).toMatchObject({ os: 'Windows', release_date: '2020-01-01' })
    expect(importHtb(db, [{ ...quarry, os: '', releaseDate: null }])).toMatchObject({ updated: 0, skipped: 1 })
    importHtb(db, [{ ...quarry, os: 'Linux', releaseDate: '2024-05-18' }])
    expect(box(db)).toMatchObject({ os: 'Linux', release_date: '2024-05-18' })
  })

  it('stops after 100 full pages', async () => {
    const f = vi.fn(async () => json({ data: Array.from({ length: 100 }, (_, i) => ({ ...page.data[0], id: i })) }))
    await expect(fetchMachines('tok', f as unknown as typeof fetch, noWait)).rejects.toThrow('HTB kept returning pages; stopped')
    expect(f.mock.calls.length).toBe(100)
  })

  it('passes a timeout signal', async () => {
    const f = fakeFetch({ [p(ACTIVE, 1)]: () => json(empty), [p(RETIRED, 1)]: () => json(empty) })
    await fetchMachines('tok', f, noWait)
    expect(f.mock.calls[0][1]!.signal).toBeInstanceOf(AbortSignal)
    expect(f.mock.calls[0][1]!.signal).not.toBe(f.mock.calls[1][1]!.signal) // one deadline per request, not per import
  })

  it('maps fixture machines', async () => {
    const odd = { ...empty, data: [{ ...page.data[0], id: 999, name: 'Oddity', difficultyText: 'Unrated' }] }
    const f = fakeFetch({ [p(ACTIVE, 1)]: () => json(odd), [p(RETIRED, 1)]: () => json(page) })
    const machines = await fetchMachines('tok', f, noWait)
    expect([...machines]).toEqual([
      { id: 101, name: 'Lantern', os: 'Linux', difficulty: 'Easy', releaseDate: '2024-03-09T19:00:00.000000Z', userOwned: true, rootOwned: true },
      { id: 102, name: 'Quarry', os: 'Windows', difficulty: 'Medium', releaseDate: '2024-05-18T19:00:00.000000Z', userOwned: true, rootOwned: false },
      { id: 103, name: 'Bastion Deep', os: 'Windows', difficulty: 'Insane', releaseDate: null, userOwned: false, rootOwned: false },
    ])
    expect(f.mock.calls[0][1]!.headers).toMatchObject({ Authorization: 'Bearer tok', Accept: 'application/json' })

    const db = openDb(':memory:')
    expect(importHtb(db, machines)).toEqual({ inserted: 3, updated: 0, skipped: 0, unknownDifficulty: 1 })
    const rows = db.prepare('SELECT short_id, platform, source, source_id, status, started_at, rooted_at FROM boxes ORDER BY id').all() as Record<string, unknown>[]
    expect(db.prepare("SELECT url FROM boxes WHERE source_id = 'htb:101'").get()).toEqual({ url: 'https://app.hackthebox.com/machines/101' })
    expect(rows.map(({ started_at, rooted_at, ...r }) => ({ ...r, started: !!started_at, rooted: !!rooted_at }))).toEqual([
      { short_id: 'H-0001', platform: 'HTB', source: 'htb', source_id: 'htb:101', status: 'rooted', started: true, rooted: true },
      { short_id: 'H-0002', platform: 'HTB', source: 'htb', source_id: 'htb:102', status: 'user_flag', started: true, rooted: false },
      { short_id: 'H-0003', platform: 'HTB', source: 'htb', source_id: 'htb:103', status: 'not_started', started: false, rooted: false },
    ])
    expect(rows[0].started_at).toMatch(ISO)
    expect(rows[0].rooted_at).toBe(rows[0].started_at)
  })

  it('tolerates field variants and skips unknown difficulty', () => {
    expect(mapMachine({ id: 7, name: 'X', os: null, difficulty_text: 'hard', release_date: '2020-01-01' }))
      .toEqual({ id: 7, name: 'X', os: '', difficulty: 'Hard', releaseDate: '2020-01-01', userOwned: false, rootOwned: false })
    expect(mapMachine({ id: 8, name: 'Y', difficultyText: 'Unknown' })).toBeNull()
    expect(mapMachine({ id: '9', name: 'Z', difficultyText: 'Easy' })).toBeNull()
  })

  it('reimport keeps owner fields and never lowers status', () => {
    const db = openDb(':memory:')
    importHtb(db, [quarry])
    db.prepare("UPDATE boxes SET notes = 'my notes', target_ip = '10.10.11.5', status = 'rooted' WHERE source_id = 'htb:102'").run()

    const next = { ...quarry, name: 'Quarry2', releaseDate: '2024-05-18', userOwned: true }
    expect(importHtb(db, [next])).toEqual({ inserted: 0, updated: 1, skipped: 0, unknownDifficulty: 0 })
    expect(db.prepare('SELECT short_id, name, release_date, notes, target_ip, status, started_at, rooted_at FROM boxes').all()).toEqual([
      { short_id: 'H-0001', name: 'Quarry2', release_date: '2024-05-18', notes: 'my notes', target_ip: '10.10.11.5', status: 'rooted', started_at: null, rooted_at: null },
    ])
    expect(importHtb(db, [next])).toEqual({ inserted: 0, updated: 0, skipped: 1, unknownDifficulty: 0 })

    db.prepare("UPDATE boxes SET status = 'in_progress'").run()
    importHtb(db, [{ ...quarry, userOwned: true }])
    expect(db.prepare('SELECT status FROM boxes').pluck().get()).toBe('user_flag')
  })

  it('stops running step timers when the import roots a box', () => {
    const db = openDb(':memory:')
    importHtb(db, [quarry])
    const boxId = box(db).id
    const started = Math.floor(Date.now() / 1000) - 100
    db.prepare("INSERT INTO steps (box_id, phase, position, seconds, timer_started_at) VALUES (?, 'Recon', 0, 5, ?)").run(boxId, started)
    importHtb(db, [{ ...quarry, rootOwned: true }])
    const step = db.prepare('SELECT seconds, timer_started_at FROM steps').get() as { seconds: number; timer_started_at: number | null }
    expect(step.timer_started_at).toBeNull()
    expect(step.seconds).toBeGreaterThanOrEqual(105)
  })

  it('stamps started_at and rooted_at only when the import moves status forward', () => {
    const db = openDb(':memory:')
    importHtb(db, [quarry])
    expect(box(db)).toMatchObject({ status: 'not_started', started_at: null, rooted_at: null })

    db.prepare("UPDATE boxes SET started_at = '2020-01-01T00:00:00.000Z'").run()
    expect(importHtb(db, [{ ...quarry, rootOwned: true }])).toMatchObject({ updated: 1 })
    const advanced = box(db)
    expect(advanced).toMatchObject({ status: 'rooted', started_at: '2020-01-01T00:00:00.000Z' })
    expect(advanced.rooted_at).toMatch(ISO)

    expect(importHtb(db, [{ ...quarry, rootOwned: true }])).toMatchObject({ updated: 0, skipped: 1 })
    expect(box(db).rooted_at).toBe(advanced.rooted_at)
  })

  it('ticks every step of a box the import roots', () => {
    const db = openDb(':memory:')
    importHtb(db, [quarry])
    db.prepare("INSERT INTO steps (box_id, phase, position) VALUES (1, 'Recon', 0)").run()
    importHtb(db, [{ ...quarry, rootOwned: true }])
    expect(db.prepare('SELECT done FROM steps').pluck().get()).toBe(1)
  })

  it('adopts a manual HTB box with the same name instead of duplicating it', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty, status, notes) VALUES ('H-0042', 'HTB', '  quarry ', 'Easy', 'in_progress', 'mine')").run()
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('T-0001', 'THM', 'Lantern', 'Easy')").run()

    expect(importHtb(db, [{ ...quarry, userOwned: true }, { ...quarry, id: 101, name: 'Lantern' }]))
      .toEqual({ inserted: 1, updated: 1, skipped: 0, unknownDifficulty: 0 })
    expect(db.prepare("SELECT short_id, name, difficulty, status, notes, source, source_id FROM boxes WHERE platform = 'HTB' ORDER BY id").all()).toEqual([
      { short_id: 'H-0042', name: 'Quarry', difficulty: 'Medium', status: 'user_flag', notes: 'mine', source: 'htb', source_id: 'htb:102' },
      { short_id: 'H-0001', name: 'Lantern', difficulty: 'Medium', status: 'not_started', notes: '', source: 'htb', source_id: 'htb:101' },
    ])
  })

  it('pagination follows meta.last_page, and the short-page rule only without meta', async () => {
    const items = (start: number, n: number) => Array.from({ length: n }, (_, i) => ({ ...page.data[0], id: start + i, name: `M${start + i}` }))
    const f = fakeFetch({
      [p(ACTIVE, 1)]: () => json({ data: items(1000, 50), meta: { current_page: 1, last_page: 2 } }), // capped page, meta says more
      [p(ACTIVE, 2)]: () => json({ data: items(2000, 100), meta: { current_page: 2, last_page: 2 } }), // full page, but meta says last
      [p(RETIRED, 1)]: () => json({ data: items(3000, 100) }), // no meta: full page means keep going
      [p(RETIRED, 2)]: () => json({ data: items(4000, 3) }), // no meta: short page stops
    })
    noWait.mockClear()
    const machines = await fetchMachines('tok', f, noWait)
    expect(machines).toHaveLength(253)
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([p(ACTIVE, 1), p(ACTIVE, 2), p(RETIRED, 1), p(RETIRED, 2)])
    expect(noWait.mock.calls).toEqual([[1000], [1000], [1000]])
  })

  it('backs off on 429 then continues', async () => {
    let calls = 0
    const f = fakeFetch({
      [p(ACTIVE, 1)]: () => (calls++ ? json(empty) : new Response('', { status: 429, headers: { 'retry-after': '3' } })),
      [p(RETIRED, 1)]: () => json(empty),
    })
    noWait.mockClear()
    expect(await fetchMachines('tok', f, noWait)).toHaveLength(0)
    expect(noWait.mock.calls).toEqual([[3000], [1000], [1000]])
  })

  it('caps a Retry-After wait at 60 s', async () => {
    let calls = 0
    const f = fakeFetch({
      [p(ACTIVE, 1)]: () => (calls++ ? json(empty) : new Response('', { status: 429, headers: { 'retry-after': '86400' } })),
      [p(RETIRED, 1)]: () => json(empty),
    })
    noWait.mockClear()
    await fetchMachines('tok', f, noWait)
    expect(noWait.mock.calls[0]).toEqual([60_000])
  })

  it('rejects a body without a data array', async () => {
    const f = fakeFetch({ [p(ACTIVE, 1)]: () => new Response('<html>maintenance</html>', { status: 200 }) })
    await expect(fetchMachines('tok', f, noWait)).rejects.toThrow(`HTB API response has no data array: ${p(ACTIVE, 1)}`)
    const g = fakeFetch({ [p(ACTIVE, 1)]: () => json({ machines: [] }) })
    await expect(fetchMachines('tok', g, noWait)).rejects.toThrow('no data array')
  })

  it('a 401 rejects with a message containing 401 and inserts nothing', async () => {
    const db = openDb(':memory:')
    const f = fakeFetch({ [p(ACTIVE, 1)]: () => json({ message: 'Unauthenticated.' }, 401) })
    await expect(fetchMachines('bad', f, noWait).then((m) => importHtb(db, m))).rejects.toThrow(/401/)
    expect(db.prepare('SELECT count(*) FROM boxes').pluck().get()).toBe(0)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
