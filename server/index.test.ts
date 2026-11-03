import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { startServer } from './index'

const open: FastifyInstance[] = []
afterEach(async () => { await Promise.all(open.splice(0).map((a) => a.close())) })

const setup = async (dataDir = mkdtempSync(join(tmpdir(), 'sl-data-'))) => {
  const webDir = join(mkdtempSync(join(tmpdir(), 'sl-web-')), 'web')
  mkdirSync(webDir)
  writeFileSync(join(webDir, '..', 'secret.txt'), 'outside-the-web-dir')
  writeFileSync(join(webDir, 'index.html'), '<html><head></head><body></body></html>')
  mkdirSync(join(webDir, 'assets'))
  writeFileSync(join(webDir, 'assets', 'a.js'), 'console.log(1)')
  const app = await startServer({ dataDir, port: 0, webDir, env: {} })
  open.push(app)
  const token = readFileSync(join(dataDir, 'install-token'), 'utf8').trim()
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers: { host: '127.0.0.1:4317', ...headers } })
  return { app, dataDir, webDir, token, get }
}

describe('startServer', () => {
  it('injects the token into index.html and falls back for SPA routes', async () => {
    const { token, get } = await setup()
    const meta = `<meta name="slingsh0t-token" content="${token}">`
    const res = await get('/')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain(meta)
    expect((await get('/boxes/whatever')).body).toContain(meta)
    expect((await get('/assets/a.js')).body).toBe('console.log(1)')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'; img-src 'self' data:")
  })

  it('reuses the token on restart', async () => {
    const a = await setup()
    await a.app.close()
    const b = await setup(a.dataDir)
    expect(b.token).toBe(a.token)
  })

  it('gates the API by token', async () => {
    const { token, get } = await setup()
    expect((await get('/api/boxes')).statusCode).toBe(401)
    expect((await get('/%61pi/boxes')).statusCode).toBe(401)
    const ok = await get('/api/boxes', { 'x-slingsh0t-token': token })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual([])
  })

  it('serves stats and search with the token', async () => {
    const { token, get } = await setup()
    const h = { 'x-slingsh0t-token': token }
    expect((await get('/api/stats', h)).json()).not.toHaveProperty('reverseShells')
    const s = await get('/api/search?q=x', h)
    expect(s.statusCode).toBe(200)
    expect(Array.isArray(s.json())).toBe(true)
  })

  it.each(['/api/networks', '/api/network-presets', '/api/credentials?all=1'])('gates %s by token', async (url) => {
    const { token, get } = await setup()
    expect((await get(url)).statusCode).toBe(401)
    expect((await get(url, { 'x-slingsh0t-token': token })).statusCode).toBe(200)
  })

  it('gates import routes by token', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/import/htb', headers: { host: '127.0.0.1:4317' }, payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('returns JSON 404 for unknown api paths, not index.html', async () => {
    const { get } = await setup()
    const res = await get('/api/nope')
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
    expect((await get('/%61pi/nope')).statusCode).toBe(404)
  })

  it('rejects a foreign Host on the page too', async () => {
    const { get } = await setup()
    expect((await get('/', { host: 'evil.example:4317' })).statusCode).toBe(403)
    expect((await get('/boxes/x', { host: 'evil.example:4317' })).statusCode).toBe(403)
    expect((await get('/assets/a.js', { host: 'evil.example:4317' })).statusCode).toBe(403)
  })

  it('never serves the raw (token-less) index.html, whatever its spelling', async () => {
    const { get } = await setup()
    for (const url of ['/index.html', '/Index.html', '/INDEX.HTML', '/%69ndex.html', '/assets/../Index.html'])
      expect((await get(url)).body, url).not.toContain('<head></head>')
  })

  it('does not serve files outside the web dir', async () => {
    const { get } = await setup()
    for (const url of ['/../secret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e%2f%2e%2e%2fsecret.txt', '/..%5csecret.txt'])
      expect((await get(url)).body, url).not.toContain('outside-the-web-dir')
  })

  it('answers 503 without a file path when the web build is missing', async () => {
    const { webDir, get } = await setup()
    rmSync(join(webDir, 'index.html'))
    const res = await get('/')
    expect(res.statusCode).toBe(503)
    expect(res.body).not.toContain(webDir)
    expect(res.body).not.toContain('index.html')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'; img-src 'self' data:")
  })

  it('regenerates an empty install-token instead of disabling auth', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sl-data-'))
    writeFileSync(join(dataDir, 'install-token'), '')
    const { token, get } = await setup(dataDir)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect((await get('/api/boxes')).statusCode).toBe(401)
  })

  it('serves attachment bytes without the token', async () => {
    const { app, token, get } = await setup()
    const h = { host: '127.0.0.1:4317', 'x-slingsh0t-token': token }
    const box = await app.inject({ method: 'POST', url: '/api/boxes', headers: h, payload: { name: 'B', platform: 'THM', difficulty: 'Easy' } })
    const id = box.json().steps[0].id
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')])
    const up = await app.inject({ method: 'POST', url: `/api/steps/${id}/attachments`, headers: { ...h, 'content-type': 'image/png' }, payload: png })
    expect(up.statusCode).toBe(201)
    const file = await get(`/api/files/${up.json().key}`)
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toMatch(/^image\/png/)
    expect((await get(`/api/steps/${id}/attachments`)).statusCode).toBe(401)
  })
})
