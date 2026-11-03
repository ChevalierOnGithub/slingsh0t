import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import { backupDb } from '../db'

export const backupRoutes: FastifyPluginAsync<{ db: Database; dir: string }> = async (app, { db, dir }) => {
  app.post('/api/backup', async (_req, reply) => {
    const path = await backupDb(db, dir)
    return reply.header('content-disposition', `attachment; filename="${basename(path)}"`).type('application/vnd.sqlite3').send(createReadStream(path))
  })
}
