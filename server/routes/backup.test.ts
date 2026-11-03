import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDb } from '../db'
import { backupRoutes } from './backup'
import { boxRoutes } from './boxes'

let app: FastifyInstance
let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'backup-'))
  app = Fastify()
  const db = openDb(':memory:')
  await app.register(boxRoutes, { db, now: () => 0 })
  await app.register(backupRoutes, { db, dir })
  await app.inject({ method: 'POST', url: '/api/boxes', payload: { platform: 'THM', name: 'Room', difficulty: 'Easy' } })
})
afterEach(async () => {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

it('POST /api/backup streams a copy of the database and keeps it in dir', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/backup' })
  expect(r.statusCode).toBe(200)
  expect(r.headers['content-type']).toBe('application/vnd.sqlite3')
  const name = /^attachment; filename="(slingsh0t-[\d-]+\.db)"$/.exec(String(r.headers['content-disposition']))?.[1]
  expect(name).toBeTruthy()
  expect(r.rawPayload.length).toBeGreaterThan(0)
  const file = join(dir, name!)
  expect(existsSync(file)).toBe(true)
  const copy = new Database(file, { readonly: true })
  expect((copy.prepare('SELECT COUNT(*) AS n FROM boxes').get() as { n: number }).n).toBe(1)
  copy.close()
})

it('GET /api/backup is 404', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/backup' })).statusCode).toBe(404)
})
