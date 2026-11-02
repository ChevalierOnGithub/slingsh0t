import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { PHASES } from '../shared/types'
import { MIGRATIONS, openDb } from './db'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'sl-')); dirs.push(d); return d }

const slice1Db = () => {
  const f = join(tmp(), 'a.db')
  const db = new Database(f)
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8').replaceAll('{{PHASES}}', PHASES.map((p) => `'${p}'`).join(',')))
  for (const m of MIGRATIONS.slice(0, 2)) db.exec(m as string)
  db.pragma('user_version = 2')
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO steps (id, box_id, phase, position, body, seconds, timer_started_at) VALUES
      (7, 1, 'Recon', 0, 'nmap the box', 120, NULL), (9, 1, 'PrivEsc', 1, 'Kerberoast the svc account', 30, 1700000000);
    INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','Kerberoasting','PrivEsc');
    INSERT INTO technique_uses (technique_id, step_id, tool_ids) VALUES (1, 9, '[]');`)
  db.close()
  return f
}

test('steps rebuild keeps rows and uses', () => {
  const db = openDb(slice1Db())
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  expect(db.prepare('SELECT id, box_id, host_id, phase, body, seconds, timer_started_at FROM steps ORDER BY id').all()).toEqual([
    { id: 7, box_id: 1, host_id: null, phase: 'Recon', body: 'nmap the box', seconds: 120, timer_started_at: null },
    { id: 9, box_id: 1, host_id: null, phase: 'PrivEsc', body: 'Kerberoast the svc account', seconds: 30, timer_started_at: 1700000000 },
  ])
  expect(db.prepare('SELECT technique_id, step_id FROM technique_uses').all()).toEqual([{ technique_id: 1, step_id: 9 }])
  expect(db.pragma('foreign_key_check')).toEqual([])
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  // the old step rows in search_index are replaced, not duplicated
  expect(db.prepare("SELECT ref_id, box_id FROM search_index WHERE kind='step' ORDER BY ref_id").all()).toEqual([{ ref_id: 7, box_id: 1 }, { ref_id: 9, box_id: 1 }])
  // technique_uses.step_id still points at the rebuilt steps table
  expect((db.prepare("SELECT sql FROM sqlite_master WHERE name='technique_uses'").get() as any).sql).toMatch(/REFERENCES steps\(id\)/)
  db.prepare('DELETE FROM steps WHERE id = 9').run()
  expect(db.prepare('SELECT count(*) c FROM technique_uses').get()).toEqual({ c: 0 })
  expect(db.prepare("SELECT count(*) c FROM search_index WHERE kind='step'").get()).toEqual({ c: 1 })
  db.close()
})

test('a migration that breaks a foreign key aborts and leaves the v2 db, its FTS rows and triggers as they were', () => {
  const f = slice1Db()
  const rebuild = MIGRATIONS[2] as { sql: string }
  const sql = rebuild.sql
  rebuild.sql += '\nDELETE FROM steps WHERE id = 9;' // strands technique_uses -> step 9
  try {
    expect(() => openDb(f)).toThrow(/migration 3 broke foreign keys: technique_uses/)
  } finally {
    rebuild.sql = sql
  }
  const after = new Database(f, { readonly: true })
  expect(after.pragma('user_version', { simple: true })).toBe(2)
  expect(after.prepare("SELECT count(*) c FROM sqlite_master WHERE name IN ('networks','steps_new')").get()).toEqual({ c: 0 })
  expect(after.prepare('SELECT count(*) c FROM steps').get()).toEqual({ c: 2 })
  expect(after.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'steps' ORDER BY name").all())
    .toEqual([{ name: 'steps_si_ad' }, { name: 'steps_si_ai' }, { name: 'steps_si_au' }])
  expect(after.prepare("SELECT ref_id FROM search_index WHERE kind = 'step' ORDER BY ref_id").all()).toEqual([{ ref_id: 7 }, { ref_id: 9 }])
  after.close()
})

test('an old dangling foreign key (not made by the migration) does not block it', () => {
  const f = slice1Db()
  const raw = new Database(f)
  raw.pragma('foreign_keys = OFF')
  raw.exec('INSERT INTO technique_uses (technique_id, step_id) VALUES (1, 999)')
  raw.exec("INSERT INTO steps (box_id, phase, position) VALUES (999, 'Recon', 5)") // the steps rebuild renumbers its fk ids
  raw.close()
  const db = openDb(f)
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  expect(db.prepare('SELECT count(*) c FROM steps').get()).toEqual({ c: 3 })
  db.close()
})

const withNetwork = () => {
  const db = openDb(':memory:')
  db.exec(`INSERT INTO networks (short_id, platform, name) VALUES ('N-001','HTB','Dante');
    INSERT INTO hosts (short_id, network_id, name, os) VALUES ('HS-001', 1, 'DANTE-WEB-NIX01', 'Linux');
    INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');`)
  return db
}

test('network tables, counters and context columns exist', () => {
  const db = withNetwork()
  expect(db.prepare("SELECT type, next FROM id_counters WHERE type IN ('N','HS') ORDER BY type").all()).toEqual([{ type: 'HS', next: 1 }, { type: 'N', next: 1 }])
  db.prepare('UPDATE context SET active_host_id = 1, active_host_ip = ? WHERE id = 1').run('10.10.110.100')
  db.prepare('DELETE FROM hosts WHERE id = 1').run()
  expect(db.prepare('SELECT active_host_id, active_host_ip FROM context').get()).toEqual({ active_host_id: null, active_host_ip: '10.10.110.100' })
})

test('a step belongs to exactly one box or host', () => {
  const db = withNetwork()
  const ins = (box: number | null, host: number | null) => db.prepare("INSERT INTO steps (box_id, host_id, phase, position) VALUES (?, ?, 'Recon', 0)").run(box, host)
  expect(() => ins(1, 1)).toThrow(/CHECK/)
  expect(() => ins(null, null)).toThrow(/CHECK/)
  const { lastInsertRowid } = ins(null, 1)
  expect(db.prepare("SELECT box_id FROM search_index WHERE kind='step' AND ref_id = ?").get(lastInsertRowid)).toEqual({ box_id: null })
  db.prepare('DELETE FROM hosts WHERE id = 1').run()
  expect(db.prepare('SELECT count(*) c FROM steps').get()).toEqual({ c: 0 })
})

test('a host is searchable by name, ips and os', () => {
  const db = withNetwork()
  db.exec("INSERT INTO host_ips (host_id, ip, is_primary) VALUES (1, '10.10.110.100', 1), (1, '172.16.1.100', 0)")
  const hit = () => db.prepare("SELECT ref_id, box_id, title, body FROM search_index WHERE kind='host'").all()
  expect(hit()).toEqual([{ ref_id: 1, box_id: null, title: 'DANTE-WEB-NIX01', body: expect.stringMatching(/10\.10\.110\.100.*172\.16\.1\.100.*Linux|172\.16\.1\.100.*10\.10\.110\.100.*Linux/) }])
  db.exec("DELETE FROM host_ips WHERE ip = '172.16.1.100'")
  expect(hit()).toEqual([{ ref_id: 1, box_id: null, title: 'DANTE-WEB-NIX01', body: '10.10.110.100 Linux' }])
  db.exec('DELETE FROM hosts WHERE id = 1')
  expect(hit()).toEqual([])
})

test("a credential's secret never enters search_index", () => {
  const db = withNetwork()
  const leaks = () => db.prepare("SELECT count(*) c FROM search_index WHERE title LIKE '%Sup3r%' OR body LIKE '%Sup3r%'").get()
  db.prepare("INSERT INTO credentials (network_id, username, kind, secret, found_note) VALUES (1, 'svc_sql', 'password', 'Sup3rS3cret!', 'web.config on NIX01')").run()
  expect(leaks()).toEqual({ c: 0 })
  db.prepare("UPDATE credentials SET secret = 'Sup3rS3cret2', found_note = 'backup share' WHERE id = 1").run()
  expect(leaks()).toEqual({ c: 0 })
  expect(db.prepare("SELECT title, body FROM search_index WHERE kind='credential'").all()).toEqual([{ title: 'svc_sql', body: 'backup share' }])
  // exactly one owner
  expect(() => db.prepare("INSERT INTO credentials (network_id, box_id, username, kind, secret) VALUES (1, 1, 'a', 'ntlm', 'x')").run()).toThrow(/CHECK/)
  expect(() => db.prepare("INSERT INTO credentials (username, kind, secret) VALUES ('a', 'ntlm', 'x')").run()).toThrow(/CHECK/)
})
