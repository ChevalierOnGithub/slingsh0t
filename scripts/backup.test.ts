import { expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup } from './backup'
import { openDb } from '../server/db'

it('refuses to back up a missing database and does not create one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-bak-'))
  const file = join(dir, 'slingsh0t.db')
  await expect(backup(dir)).rejects.toThrow(`No database at ${file}`)
  expect(existsSync(file)).toBe(false)
})

it('copies an existing database into backups/', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sl-bak-'))
  openDb(join(dir, 'slingsh0t.db')).close()
  expect(existsSync(await backup(dir))).toBe(true)
})
