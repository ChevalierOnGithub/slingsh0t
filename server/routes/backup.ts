import { createReadStream, rmSync } from 'node:fs'
import { basename } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import { backupDb } from '../db'

export const backupRoutes: FastifyPluginAsync<{ db: Database; dir: string }> = async (app, { db, dir }) => {
  app.post('/api/backup', async (_req, reply) => {
    // keep = Infinity: a download must never evict a kept backup; the copy is deleted once streamed.
    const path = await backupDb(db, dir, undefined, Infinity)
    const stream = createReadStream(path)
    stream.on('close', () => { try { rmSync(path, { force: true }) } catch { /* locked: an uncaught throw here would take the server down */ } })
    return reply.header('content-disposition', `attachment; filename="${basename(path)}"`).type('application/vnd.sqlite3').send(stream)
  })
}
