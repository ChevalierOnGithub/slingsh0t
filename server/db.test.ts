import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { backupDb, openDb } from './db'

const tmp = () => mkdtempSync(join(tmpdir(), 'sl-'))
const addBox = (db: ReturnType<typeof openDb>) =>
  db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','Lame','Easy')").run()

test('openDb is idempotent and keeps rows', () => {
  const f = join(tmp(), 'sub', 'a.db')
  const a = openDb(f)
  addBox(a)
  a.close()
  const b = openDb(f)
  expect(b.prepare('SELECT count(*) c FROM boxes').get()).toEqual({ c: 1 })
  b.close()
})

test('context row seeded, phase CHECK enforced', () => {
  const db = openDb(':memory:')
  expect(db.prepare('SELECT id FROM context').get()).toEqual({ id: 1 })
  const { lastInsertRowid } = addBox(db)
  const ins = (phase: string) => db.prepare('INSERT INTO steps (box_id, phase, position) VALUES (?,?,0)').run(lastInsertRowid, phase)
  expect(() => ins('Foothold')).toThrow(/CHECK/)
  expect(() => ins('Recon')).not.toThrow()
})

test('backupDb writes a readable copy', async () => {
  const db = openDb(join(tmp(), 'a.db'))
  addBox(db)
  const path = await backupDb(db, tmp(), new Date('2026-11-01T20:05:09'))
  expect(path.endsWith('slingsh0t-20261101-200509.db')).toBe(true)
  const copy = openDb(path)
  expect(copy.prepare('SELECT count(*) c FROM boxes').get()).toEqual({ c: 1 })
  copy.close()
  db.close()
})

test('backupDb keeps the newest 10 of its own files and nothing else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-prune-'))
  const dir2 = mkdtempSync(join(tmpdir(), 'sl-prune-'))
  const db = openDb(':memory:')
  try {
    for (const keep of ['pre-migration-v3-20260101-000000.db', 'pre-restore-1.db', 'notes.txt']) writeFileSync(join(dir, keep), 'x')
    for (let i = 0; i < 12; i++) await backupDb(db, dir, new Date(2026, 0, 1, 0, 0, i))
    const names = readdirSync(dir).sort()
    expect(names.filter((n) => n.startsWith('slingsh0t-'))).toEqual(Array.from({ length: 10 }, (_, i) => `slingsh0t-20260101-0000${String(i + 2).padStart(2, '0')}.db`))
    expect(names).toEqual(expect.arrayContaining(['pre-migration-v3-20260101-000000.db', 'pre-restore-1.db', 'notes.txt']))
    // same-second: -2 is newer than the bare name, so the bare one is evicted first
    const at = new Date(2026, 0, 2, 0, 0, 0)
    await backupDb(db, dir2, at, Infinity)
    await backupDb(db, dir2, at, Infinity)
    await backupDb(db, dir2, at, 2)
    expect(readdirSync(dir2).sort()).toEqual(['slingsh0t-20260102-000000-2.db', 'slingsh0t-20260102-000000-3.db'])
  } finally {
    db.close(); rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true })
  }
})

test('backupDb orders -10 after -2', async () => {
  const dir = tmp(), db = openDb(':memory:')
  try {
    for (const n of ['', ...Array.from({ length: 9 }, (_, i) => `-${i + 2}`)]) writeFileSync(join(dir, `slingsh0t-20260102-000000${n}.db`), 'x')
    const path = await backupDb(db, dir, new Date(2026, 0, 2, 0, 0, 0), 3) // writes -11
    expect(path.endsWith('-11.db')).toBe(true)
    expect(readdirSync(dir).sort()).toEqual(['slingsh0t-20260102-000000-10.db', 'slingsh0t-20260102-000000-11.db', 'slingsh0t-20260102-000000-9.db'])
  } finally {
    db.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test('backupDb never deletes the file it just wrote', async () => {
  const dir = tmp(), db = openDb(':memory:')
  try {
    for (const keep of [0, NaN, -3]) {
      const path = await backupDb(db, dir, new Date(2026, 0, 1, 0, 0, 5), keep)
      expect(readdirSync(dir).filter((n) => n.startsWith('slingsh0t-'))).toEqual([path.slice(dir.length + 1)])
      rmSync(path)
    }
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, 'slingsh0t-20300101-000000.db'), 'x') // newer than the backup below (clock change)
    const old = await backupDb(db, dir, new Date(2026, 0, 1), 1)
    expect(existsSync(old)).toBe(true)
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true)
  } finally {
    db.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test('backupDb ignores a prune target it cannot delete', async () => {
  const dir = tmp(), db = openDb(':memory:')
  try {
    const stuck = join(dir, 'slingsh0t-20250101-000000.db')
    mkdirSync(stuck)
    writeFileSync(join(stuck, 'inner'), 'x') // rmSync without recursive throws on a directory
    const path = await backupDb(db, dir, new Date(2026, 0, 1), 1)
    expect(existsSync(path)).toBe(true)
  } finally {
    db.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test('two backups in the same second keep both files', async () => {
  const db = openDb(join(tmp(), 'a.db'))
  const dir = tmp(), at = new Date('2026-11-01T20:05:09')
  const [a, b] = [await backupDb(db, dir, at), await backupDb(db, dir, at)]
  expect(b).not.toBe(a)
  expect(b.endsWith('slingsh0t-20261101-200509-2.db')).toBe(true)
  db.close()
})
