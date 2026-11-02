import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import type { Database } from 'better-sqlite3'
import { timingSafeEqual } from 'node:crypto'
import { contextRoutes } from './routes/context'

const HOSTS = ['127.0.0.1:4317', 'localhost:4317', '127.0.0.1:5173', 'localhost:5173']
const ORIGINS = HOSTS.map((h) => `http://${h}`)

export function buildApp(opts: {
  db: Database
  token: string
  plugins?: FastifyPluginAsync<{ db: Database }>[]
}): FastifyInstance {
  if (opts.token.length < 32) throw new Error('install token too short')
  const app = Fastify()
  const want = Buffer.from(opts.token)
  app.addHook('onRequest', async (req, reply) => {
    const { host, origin } = req.headers
    if (!host || !HOSTS.includes(host) || (origin !== undefined && !ORIGINS.includes(origin)))
      return reply.code(403).send({ error: 'forbidden' })
  })
  // Token gate is scoped to the route plugins, not guessed from req.url (raw url can be percent-encoded).
  app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      const got = Buffer.from(String(req.headers['x-slingsh0t-token'] ?? ''))
      if (got.length !== want.length || !timingSafeEqual(got, want))
        return reply.code(401).send({ error: 'unauthorized' })
    })
    api.register(contextRoutes, { db: opts.db })
    for (const p of opts.plugins ?? []) api.register(p, { db: opts.db })
  })
  return app
}
