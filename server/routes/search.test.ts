import Fastify from 'fastify'
import { expect, test } from 'vitest'
import { openDb } from '../db'
import type { SearchHit } from '../../shared/types'
import { searchRoutes } from './search'

const setup = async () => {
  const db = openDb(':memory:')
  const app = Fastify()
  await app.register(searchRoutes, { db })
  const q = async (s: string) => (await app.inject({ url: `/api/search?q=${encodeURIComponent(s)}` })).json<SearchHit[]>()
  return { db, q }
}

test('prefix match; update and delete keep index in sync', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Recon',0,'Kerberoast the svc account');`)
  expect(await q('kerber')).toEqual([{ kind: 'step', id: 1, boxId: 1, hostId: null, toolId: null, title: 'Lame · Recon', snippet: expect.stringContaining('\u0002Kerberoast\u0003'), total: 1 }])
  db.exec("UPDATE steps SET body = 'nothing here' WHERE id = 1")
  expect(await q('kerber')).toEqual([])
  expect(await q('nothing')).toHaveLength(1)
  db.exec('DELETE FROM steps WHERE id = 1')
  expect(await q('nothing')).toEqual([])
  expect((await q('lame'))[0]).toMatchObject({ kind: 'box', id: 1, boxId: 1 })
})

test('a step is found by its Saw line', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Recon',0,'');
    UPDATE steps SET saw = 'rusty ftp banner' WHERE id = 1;`)
  expect(await q('rusty')).toEqual([expect.objectContaining({ kind: 'step', id: 1, title: 'Lame · Recon' })])
})

test('done does not reindex', async () => {
  const { db } = await setup()
  // a later row means a delete+reinsert would get a new rowid, not max+1 again
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Recon',0,'nmap');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Root',1,'later');`)
  const rowid = () => (db.prepare("SELECT rowid FROM search_index WHERE kind='step' AND ref_id=1").get() as { rowid: number }).rowid
  const before = rowid()
  db.exec('UPDATE steps SET done = 1 WHERE id = 1')
  expect(rowid()).toBe(before)
  db.exec("UPDATE steps SET got = 'anon login' WHERE id = 1")
  expect(rowid()).not.toBe(before) // control: an indexed column does reindex
})

test('real brackets in content stay plain text in the snippet', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Recon',0,'- [x] ran nmap');`)
  expect((await q('nmap'))[0].snippet).toBe('- [x] ran \u0002nmap\u0003')
})

test('empty query and fts syntax do not throw', async () => {
  const { q } = await setup()
  expect(await q('')).toEqual([])
  expect(await q('   ')).toEqual([])
  expect(await q('nmap "-p-" (x*')).toEqual([])
})

test('NUL in the query does not 500', async () => {
  const { q } = await setup()
  expect(await q('\0')).toEqual([])
  expect(await q('nm\0ap')).toEqual([])
})

test('host steps are titled by host; host and box hits carry hostId', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO networks (short_id, platform, name) VALUES ('N-001','HTB','Dante');
    INSERT INTO hosts (short_id, network_id, name) VALUES ('HS-001',1,'WEB01');
    INSERT INTO host_ips (host_id, ip, is_primary) VALUES (1,'10.10.110.5',1);
    INSERT INTO steps (host_id, phase, position, body) VALUES (1,'Recon',0,'gobuster found admin');`)
  expect(await q('gobuster')).toEqual([{ kind: 'step', id: 1, boxId: null, hostId: 1, toolId: null, title: 'WEB01 · Recon', snippet: expect.any(String), total: 1 }])
  expect((await q('10.10.110.5'))[0]).toMatchObject({ kind: 'host', id: 1, boxId: null, hostId: 1, title: 'WEB01' })
  expect((await q('lame'))[0]).toMatchObject({ kind: 'box', hostId: null })
})

test('a network is found by short id, name or tag', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO networks (short_id, platform, name, tags) VALUES ('N-001','HTB','Dante','["pivoting"]')`)
  for (const s of ['dante', 'N-001', 'pivot'])
    expect(await q(s)).toEqual([{ kind: 'network', id: 1, boxId: null, hostId: null, toolId: null, title: 'N-001 Dante', snippet: expect.any(String), total: 1 }])
})

test('box and network snippets show tags as text, not JSON; an untagged box still matches by OS', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO boxes (short_id, platform, name, os, difficulty, tags) VALUES ('H-0001','HTB','Forest','Windows','Easy','["Active Directory","Kerberos"]');
    INSERT INTO boxes (short_id, platform, name, os, difficulty) VALUES ('H-0002','HTB','Lame','Linux','Easy');
    INSERT INTO networks (short_id, platform, name, tags) VALUES ('N-001','HTB','Dante','["Active Directory"]');`)
  expect((await q('forest'))[0].snippet).toBe('Windows Active Directory, Kerberos')
  expect((await q('dante'))[0].snippet).toBe('Active Directory')
  expect(await q('linux')).toEqual([expect.objectContaining({ kind: 'box', id: 2, snippet: '\u0002Linux\u0003' })])
  db.exec(`UPDATE networks SET tags = '["Pro Lab"]' WHERE id = 1`)
  expect((await q('dante'))[0].snippet).toBe('Pro Lab')
})

test('a command hit carries its tool id, null when it has none', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Zebrabox','Easy');
    INSERT INTO tools (short_id, name) VALUES ('T-001','zebratool');
    INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','zebratech','PrivEsc');
    INSERT INTO commands (tool_id, purpose, template) VALUES (1,'zebra scan','zebra -a');
    INSERT INTO commands (technique_id, purpose, template) VALUES (1,'zebra only','zebra -b');`)
  const hits = await q('zebra')
  const toolId = (id: number) => hits.find((h) => h.kind === 'command' && h.id === id)?.toolId
  expect(toolId(1)).toBe(1)
  expect(toolId(2)).toBeNull()
  expect(hits.find((h) => h.kind === 'box')?.toolId).toBeNull()
})

test('repeated q does not crash', async () => {
  const db = openDb(':memory:')
  const app = Fastify()
  await app.register(searchRoutes, { db })
  const res = await app.inject({ url: '/api/search?q=a&q=b' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual([])
})

const seedZeta = (db: any) => db.exec(`INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','zeta one','PrivEsc'), ('TQ-002','zeta two','PrivEsc');
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 60)
  INSERT INTO commands (technique_id, purpose, template) SELECT 1, 'zeta ' || i, 'zeta -' || i FROM n;`)

test('per-kind cap keeps every kind', async () => {
  const { db } = await setup()
  seedZeta(db)
  const app = Fastify()
  await app.register(searchRoutes, { db })
  const hits = (await app.inject({ url: '/api/search?q=zeta&limit=5' })).json<SearchHit[]>()
  const of = (k: string) => hits.filter((h) => h.kind === k)
  expect(of('command')).toHaveLength(5)
  expect(of('technique')).toHaveLength(2)
  expect(of('command').every((h) => h.total === 60)).toBe(true)
  expect(of('technique').every((h) => h.total === 2)).toBe(true)
})

test('default limit is 50 per kind', async () => {
  const { db, q } = await setup()
  seedZeta(db)
  expect((await q('zeta')).filter((h) => h.kind === 'command')).toHaveLength(50)
})

test('kinds interleave in global rank order, not grouped by kind', async () => {
  const { db, q } = await setup()
  const long = 'filler '.repeat(40)
  db.exec(`INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','x','PrivEsc');
    INSERT INTO commands (technique_id, purpose, template) VALUES (1, '${long} quokka', '${long}'), (1, '${long} quokka', '${long}');
    INSERT INTO techniques (short_id, name, phase, description) VALUES ('TQ-002','quokka','PrivEsc','');`)
  expect((await q('quokka')).map((h) => h.kind)).toEqual(['technique', 'command', 'command'])
})

test('a query of 100 repeated words is capped at 32 terms and answers fast', async () => {
  const { db, q } = await setup()
  db.exec(`INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','quokka','PrivEsc')`)
  const t = Date.now()
  const many = await q(Array(100).fill('quokka').join(' '))
  expect(many).toEqual(await q(Array(32).fill('quokka').join(' ')))
  expect(many).toHaveLength(1)
  expect(Date.now() - t).toBeLessThan(2000)
})
