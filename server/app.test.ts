import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import type { FastifyPluginAsync } from 'fastify'
import { buildApp } from './app'

const token = 't'.repeat(64)
const mk = () => buildApp({ db: openDb(':memory:'), token })
const get = (app: ReturnType<typeof mk>, headers: Record<string, string>, url = '/api/context') =>
  app.inject({ method: 'GET', url, headers: { host: '127.0.0.1:4317', ...headers } })

describe('security hook', () => {
  it('refuses a short token', () => {
    expect(() => buildApp({ db: openDb(':memory:'), token: '' })).toThrow('install token too short')
  })
  it('requires the token', async () => {
    const app = mk()
    expect((await get(app, {})).statusCode).toBe(401)
    expect((await get(app, { 'x-slingsh0t-token': 'x'.repeat(64) })).statusCode).toBe(401)
    expect((await get(app, { 'x-slingsh0t-token': 'short' })).statusCode).toBe(401)
    expect((await get(app, { 'x-slingsh0t-token': token })).statusCode).toBe(200)
  })
  it('rejects bad host and origin', async () => {
    const app = mk()
    const h = { 'x-slingsh0t-token': token }
    expect((await get(app, { ...h, host: 'evil.example:4317' })).statusCode).toBe(403)
    expect((await get(app, { ...h, origin: 'http://evil.example' })).statusCode).toBe(403)
    expect((await get(app, { ...h, origin: 'http://localhost:5173' })).statusCode).toBe(200)
  })
  it('does not guard non-api paths', async () => {
    expect((await get(mk(), {}, '/')).statusCode).toBe(404)
  })
  it('guards percent-encoded api paths', async () => {
    expect((await get(mk(), {}, '/%61pi/context')).statusCode).toBe(401)
  })
  it('applies the token check to plugins', async () => {
    const ping: FastifyPluginAsync = async (a) => void a.get('/api/ping', async () => ({ ok: true }))
    const app = buildApp({ db: openDb(':memory:'), token, plugins: [ping] })
    expect((await get(app, {}, '/api/ping')).statusCode).toBe(401)
    expect((await get(app, { 'x-slingsh0t-token': token }, '/api/ping')).statusCode).toBe(200)
  })
  it('checks host on non-api paths and origin on PUT', async () => {
    const app = mk()
    expect((await get(app, { host: 'evil.example' }, '/')).statusCode).toBe(403)
    const r = await app.inject({
      method: 'PUT', url: '/api/context', payload: {},
      headers: { host: '127.0.0.1:4317', origin: 'http://evil.example', 'x-slingsh0t-token': token },
    })
    expect(r.statusCode).toBe(403)
  })
})
