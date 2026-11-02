import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { openDb } from './db'
import { nextShortId } from './ids'

test('short ids count per type with padding', () => {
  const db = openDb(':memory:')
  expect(nextShortId(db, 'H')).toBe('H-0001')
  expect(nextShortId(db, 'H')).toBe('H-0002')
  expect(nextShortId(db, 'T')).toBe('T-0001')
  expect(nextShortId(db, 'TQ')).toBe('TQ-001')
  expect(nextShortId(db, 'TL')).toBe('TL-001')
})

test('works inside a transaction', () => {
  const db = openDb(':memory:')
  expect(db.transaction(() => nextShortId(db, 'H'))()).toBe('H-0001')
})

test('the counter survives closing and reopening a file database', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'sl-ids-')), 'a.db')
  const a = openDb(file)
  expect(nextShortId(a, 'H')).toBe('H-0001')
  a.close()
  const b = openDb(file)
  expect(nextShortId(b, 'H')).toBe('H-0002')
  b.close()
})
