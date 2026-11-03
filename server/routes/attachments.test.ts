import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { boxRoutes } from './boxes'
import { attachmentRoutes, fileRoutes } from './attachments'
import type { Attachment, BoxDetail } from '../../shared/types'

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)])
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)])

let app: FastifyInstance
let db: ReturnType<typeof openDb>
let stepId: number

beforeEach(async () => {
  db = openDb(':memory:')
  app = Fastify()
  await app.register(boxRoutes, { db, now: () => 0 })
  await app.register(attachmentRoutes, { db })
  await app.register(fileRoutes, { db })
  const box = (await app.inject({ method: 'POST', url: '/api/boxes', payload: { platform: 'THM', name: 'Room', difficulty: 'Easy' } })).json<BoxDetail>()
  stepId = box.steps[0].id
})

const up = (payload: Buffer | string, type = 'image/png', extra: Record<string, string> = {}, id: number | string = stepId) =>
  app.inject({ method: 'POST', url: `/api/steps/${id}/attachments`, headers: { 'content-type': type, ...extra }, payload })
const count = () => (db.prepare('SELECT count(*) c FROM attachments').get() as { c: number }).c

describe('attachments', () => {
  it('uploads a png and serves it back', async () => {
    const r = await up(png, 'image/png', { 'x-file-name': encodeURIComponent('Flag proof.png') })
    expect(r.statusCode).toBe(201)
    const a = r.json<Attachment>()
    expect(a).toEqual({ key: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Flag proof.png', mime: 'image/png', size: 24, createdAt: expect.any(String) })
    const f = await app.inject({ method: 'GET', url: `/api/files/${a.key}` })
    expect(f.statusCode).toBe(200)
    expect(f.headers['content-type']).toMatch(/^image\/png/)
    expect(f.headers['x-content-type-options']).toBe('nosniff')
    expect(f.headers['content-disposition']).toBe('inline')
    expect(f.headers['content-security-policy']).toBe("default-src 'none'")
    expect(f.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(f.rawPayload.equals(png)).toBe(true)
  })

  it('lists and deletes', async () => {
    const a = (await up(png)).json<Attachment>()
    expect((await app.inject({ method: 'GET', url: `/api/steps/${stepId}/attachments` })).json()).toEqual([a])
    expect((await app.inject({ method: 'DELETE', url: `/api/attachments/${a.key}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/api/steps/${stepId}/attachments` })).json()).toEqual([])
    expect((await app.inject({ method: 'GET', url: `/api/files/${a.key}` })).statusCode).toBe(404)
  })

  it('rejects a type that does not match the bytes', async () => {
    const r = await up(jpeg)
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ message: 'not a png image' })
    expect(count()).toBe(0)
  })

  it('rejects non-image content types', async () => {
    expect((await up('hi', 'text/plain')).statusCode).toBe(415)
  })

  it('rejects a body over 10 MB', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1)
    png.copy(big)
    expect((await up(big)).statusCode).toBe(413)
  })

  it('defaults the name and sanitises it', async () => {
    expect((await up(png)).json<Attachment>().name).toMatch(/^pasted-\d+\.png$/)
    expect((await up(png, 'image/png', { 'x-file-name': '..%2Fetc%2F[evil](x).png' })).json<Attachment>().name).toBe('[evil](x).png')
  })

  it('404s on unknown step and bad key', async () => {
    expect((await up(png, 'image/png', {}, 999)).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/files/zz' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/api/files/${'a'.repeat(32)}` })).statusCode).toBe(404)
  })

  it('refuses to serve bytes that are not the stored mime', async () => {
    const key = 'b'.repeat(32)
    db.prepare("INSERT INTO attachments (key, step_id, name, mime, size, data) VALUES (?, ?, 'x', 'image/png', 6, ?)").run(key, stepId, Buffer.from('<html>'))
    expect((await app.inject({ method: 'GET', url: `/api/files/${key}` })).statusCode).toBe(404)
  })

  it('cascades on step delete', async () => {
    await up(png)
    expect((await app.inject({ method: 'DELETE', url: `/api/steps/${stepId}` })).statusCode).toBeLessThan(300)
    expect(count()).toBe(0)
  })
})
