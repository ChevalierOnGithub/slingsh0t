import { randomBytes } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Database } from 'better-sqlite3'
import type { Attachment } from '../../shared/types'
import { fail } from '../validate'

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
type Mime = (typeof IMAGE_MIMES)[number]
const MAX = 10 * 1024 * 1024
const KEY = /^[0-9a-f]{32}$/

/** The image type the bytes claim by their magic number, or null. */
export const sniffImage = (b: Buffer): Mime | null => {
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png'
  if (b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

type Row = { key: string; name: string; mime: string; size: number; created_at: string }
const toAttachment = (r: Row): Attachment => ({ key: r.key, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at })

export const attachmentRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addContentTypeParser([...IMAGE_MIMES], { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.post<{ Params: { id: string }; Body: unknown }>('/api/steps/:id/attachments', { bodyLimit: MAX }, async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM steps WHERE id = ?').get(req.params.id)) fail('step not found', 404)
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]
    if (!(IMAGE_MIMES as readonly string[]).includes(mime)) fail('unsupported image type', 415)
    const body = req.body
    if (!Buffer.isBuffer(body) || sniffImage(body) !== mime) fail(`not a ${mime.slice(6)} image`)
    const data = body as Buffer
    let raw = ''
    try { raw = decodeURIComponent(String(req.headers['x-file-name'] ?? '')) } catch { /* bad escape: use the default name */ }
    const name = raw.split(/[/\\]/).pop()!.trim().slice(0, 100) || `pasted-${Date.now()}.png`
    const key = randomBytes(16).toString('hex')
    const r = db.prepare('INSERT INTO attachments (key, step_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)').run(key, req.params.id, name, mime, data.length, data)
    const row = db.prepare('SELECT key, name, mime, size, created_at FROM attachments WHERE id = ?').get(r.lastInsertRowid) as Row
    return reply.code(201).send(toAttachment(row))
  })

  app.get<{ Params: { id: string } }>('/api/steps/:id/attachments', async (req) =>
    (db.prepare('SELECT key, name, mime, size, created_at FROM attachments WHERE step_id = ? ORDER BY id').all(req.params.id) as Row[]).map(toAttachment))

  app.delete<{ Params: { key: string } }>('/api/attachments/:key', async (req, reply) => {
    if (!db.prepare('DELETE FROM attachments WHERE key = ?').run(req.params.key).changes) fail('not found', 404)
    return reply.code(204).send()
  })
}

// Token-free so <img> can load it; the key is an unguessable capability and the headers stop the bytes running as a page.
export const fileRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get<{ Params: { key: string } }>('/api/files/:key', async (req, reply) => {
    if (!KEY.test(req.params.key)) fail('not found', 404)
    const row = db.prepare('SELECT mime, data FROM attachments WHERE key = ?').get(req.params.key) as { mime: string; data: Buffer } | undefined
    if (!row || sniffImage(row.data) !== row.mime) fail('not found', 404)
    return reply
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .header('content-security-policy', "default-src 'none'")
      .header('cache-control', 'private, max-age=31536000, immutable')
      .type(row!.mime)
      .send(row!.data)
  })
}
