import { mkdtempSync } from 'node:fs'
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

test('two backups in the same second keep both files', async () => {
  const db = openDb(join(tmp(), 'a.db'))
  const dir = tmp(), at = new Date('2026-11-01T20:05:09')
  const [a, b] = [await backupDb(db, dir, at), await backupDb(db, dir, at)]
  expect(b).not.toBe(a)
  expect(b.endsWith('slingsh0t-20261101-200509-2.db')).toBe(true)
  db.close()
})
