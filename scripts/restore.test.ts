import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { restore } from './restore'
import { backup } from './backup'
import { openDb } from '../server/db'

// The real backup, replaceable per test: some failures (an I/O error) can't be staged with files.
vi.mock('./backup', async (importOriginal) => ({ backup: vi.fn((await importOriginal<typeof import('./backup')>()).backup) }))
afterEach(() => { vi.restoreAllMocks() })
const stopped = async () => { throw new Error('ECONNREFUSED') }

it('refuses while a server answers, even with an error status, and leaves the destination untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  writeFileSync(join(dir, 'slingsh0t.db'), 'live')
  const src = join(mkdtempSync(join(tmpdir(), 'sl-res-src-')), 'slingsh0t.db')
  new Database(src).close()

  await expect(restore(src, dir, { probe: async () => new Response('', { status: 403 }) })).rejects.toThrow('stop it before restoring')

  expect(readFileSync(join(dir, 'slingsh0t.db'), 'utf8')).toBe('live')
  expect(existsSync(join(dir, 'backups'))).toBe(false)
})

it('refuses while a server is busy and does not answer in time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  writeFileSync(join(dir, 'slingsh0t.db'), 'live')
  const src = join(mkdtempSync(join(tmpdir(), 'sl-res-src-')), 'slingsh0t.db')
  new Database(src).close()

  await expect(restore(src, dir, { probe: async () => { throw new DOMException('timed out', 'TimeoutError') } })).rejects.toThrow('stop it before restoring')

  expect(readFileSync(join(dir, 'slingsh0t.db'), 'utf8')).toBe('live')
})

it('refuses a missing source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  await expect(restore(join(dir, 'nope.db'), dir, { probe: stopped })).rejects.toThrow('No database at')
})

it('restores a source with unflushed WAL writes and backs up the database it replaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  openDb(join(dir, 'slingsh0t.db')).close()
  const srcDir = mkdtempSync(join(tmpdir(), 'sl-res-src-'))
  const src = new Database(join(srcDir, 'slingsh0t.db'))
  src.pragma('journal_mode = WAL')
  src.pragma('wal_autocheckpoint = 0')
  src.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept')")
  expect(existsSync(join(srcDir, 'slingsh0t.db-wal'))).toBe(true)

  await restore(join(srcDir, 'slingsh0t.db'), dir, { probe: stopped })
  src.close()

  const out = new Database(join(dir, 'slingsh0t.db'), { readonly: true })
  expect(out.prepare('SELECT v FROM t').pluck().get()).toBe('kept')
  out.close()
  expect(readdirSync(join(dir, 'backups'))).toHaveLength(1)
})

it('restores over a damaged current database and keeps the damaged file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  vi.spyOn(console, 'error').mockImplementation(() => {}) // the fallback says why; asserted in the WAL test below
  writeFileSync(join(dir, 'slingsh0t.db'), 'junk')
  const srcDir = mkdtempSync(join(tmpdir(), 'sl-res-src-'))
  const src = new Database(join(srcDir, 'slingsh0t.db'))
  src.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('good')")
  src.close()

  await restore(join(srcDir, 'slingsh0t.db'), dir, { probe: stopped })

  const out = new Database(join(dir, 'slingsh0t.db'), { readonly: true })
  expect(out.prepare('SELECT v FROM t').pluck().get()).toBe('good')
  out.close()
  const kept = readdirSync(join(dir, 'backups'))
  expect(kept.map((f) => readFileSync(join(dir, 'backups', f), 'utf8'))).toEqual(['junk'])
})

it('restores over a database that fails while being copied before migration, leaving no partial copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  const file = join(dir, 'slingsh0t.db')
  const db = openDb(file)
  db.exec(`CREATE TABLE filler (b BLOB);
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20) INSERT INTO filler SELECT randomblob(3000) FROM n`)
  db.pragma('user_version = 3') // needs migrating, so openDb copies it first
  db.close()
  const bytes = readFileSync(file)
  bytes.fill(0xff, bytes.length - 10 * 4096) // schema pages intact (it opens), filler pages garbage (the copy fails)
  writeFileSync(file, bytes)
  const srcDir = mkdtempSync(join(tmpdir(), 'sl-res-src-'))
  const src = new Database(join(srcDir, 'slingsh0t.db'))
  src.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('good')")
  src.close()
  vi.spyOn(console, 'error').mockImplementation(() => {})

  await restore(join(srcDir, 'slingsh0t.db'), dir, { probe: stopped })

  const out = new Database(file, { readonly: true })
  expect(out.prepare('SELECT v FROM t').pluck().get()).toBe('good')
  out.close()
  expect(readdirSync(join(dir, 'backups')).filter((f) => f.startsWith('pre-migration'))).toEqual([])
})

it('keeps the WAL with the raw copy of a current database it cannot back up, and says why', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  const file = join(dir, 'slingsh0t.db')
  const raw = new Database(file)
  raw.pragma('journal_mode = WAL')
  raw.pragma('wal_autocheckpoint = 0')
  raw.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('wal only')")
  const [main, wal] = [readFileSync(file), readFileSync(`${file}-wal`)]
  raw.close() // checkpoints; put both files back as they were, the row only in the WAL
  writeFileSync(file, main)
  writeFileSync(`${file}-wal`, wal)
  const srcDir = mkdtempSync(join(tmpdir(), 'sl-res-src-'))
  const src = new Database(join(srcDir, 'slingsh0t.db'))
  src.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('good')")
  src.close()
  vi.mocked(backup).mockRejectedValueOnce(new Error('disk I/O error'))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})

  await restore(join(srcDir, 'slingsh0t.db'), dir, { probe: stopped })

  const [kept] = readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.db'))
  const old = new Database(join(dir, 'backups', kept), { readonly: true })
  expect(old.prepare('SELECT v FROM t').pluck().all()).toEqual(['wal only'])
  old.close()
  expect(error).toHaveBeenCalledWith(expect.stringContaining('disk I/O error'))
  expect(error).toHaveBeenCalledWith(expect.stringContaining(kept))
  const out = new Database(file, { readonly: true })
  expect(out.prepare('SELECT v FROM t').pluck().all()).toEqual(['good'])
  out.close()
})

it('never prunes the backup it restores from, even when it is the oldest of 10', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-res-'))
  openDb(join(dir, 'slingsh0t.db')).close()
  const backups = join(dir, 'backups')
  mkdirSync(backups)
  for (let i = 0; i < 10; i++) {
    const f = new Database(join(backups, `slingsh0t-2026010${i < 9 ? 1 : 2}-00000${i % 9}.db`))
    f.exec(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('b${i}')`)
    f.close()
  }
  const before = readdirSync(backups).sort()
  const oldest = join(backups, before[0])

  await restore(oldest, dir, { probe: stopped })

  expect(existsSync(oldest)).toBe(true)
  const after = readdirSync(backups).filter((f) => f.endsWith('.db'))
  expect(after).toHaveLength(11)
  expect(after).toEqual(expect.arrayContaining(before))
})
