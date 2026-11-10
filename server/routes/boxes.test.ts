import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { boxRoutes } from './boxes'
import type { BoxDetail, BoxSummary, Step } from '../../shared/types'

let t = 0
let app: FastifyInstance
let db: ReturnType<typeof openDb>

beforeEach(async () => {
  t = 0
  db = openDb(':memory:')
  app = Fastify()
  await app.register(boxRoutes, { db, now: () => t })
})

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload })
const mk = async (extra: object = {}) =>
  (await call('POST', '/api/boxes', { platform: 'THM', name: 'Room', difficulty: 'Easy', ...extra })).json<BoxDetail>()
const order = async (id: number) => (await call('GET', `/api/boxes/${id}`)).json<BoxDetail>().steps.map((s) => s.phase)

describe('boxes', () => {
  it('creates HTB AD box with 6 steps and THM box with 5', async () => {
    const r = await call('POST', '/api/boxes', { platform: 'HTB', name: ' Cicada ', os: 'Windows', difficulty: 'Easy', tags: ['Active Directory'] })
    expect(r.statusCode).toBe(201)
    const b = r.json<BoxDetail>()
    expect(b.shortId).toBe('H-0001')
    expect(b.name).toBe('Cicada')
    expect(b.steps.map((s) => s.phase)).toEqual(['Recon', 'Initial Access', 'PrivEsc', 'Lateral Movement', 'Root', 'Persistence'])
    const m = await mk()
    expect(m.shortId).toBe('T-0001')
    expect(m.steps).toHaveLength(5)
    expect((await call('GET', '/api/boxes')).json<{ id: number }[]>().length).toBe(2)
  })

  it('adds default steps to a box with none, only once', async () => {
    const ins = (sid: string, tags: string[]) => Number(db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty, tags) VALUES (?, 'HTB', 'Imp', 'Easy', ?)").run(sid, JSON.stringify(tags)).lastInsertRowid)
    const plain = ins('H-0008', [])
    const r = await call('POST', `/api/boxes/${plain}/default-steps`)
    expect(r.statusCode).toBe(201)
    expect(r.json<BoxDetail>().steps.map((s) => [s.phase, s.position])).toEqual([['Recon', 0], ['Initial Access', 1], ['PrivEsc', 2], ['Lateral Movement', 3], ['Root', 4]])
    expect((await call('POST', `/api/boxes/${plain}/default-steps`)).statusCode).toBe(409)
    expect(await order(plain)).toHaveLength(5)
    const ad = ins('H-0009', ['Active Directory'])
    expect((await call('POST', `/api/boxes/${ad}/default-steps`)).json<BoxDetail>().steps.at(-1)!.phase).toBe('Persistence')
    expect((await call('POST', '/api/boxes/999/default-steps')).statusCode).toBe(404)
  })

  it('rejects bad input', async () => {
    expect((await call('POST', '/api/boxes', { platform: 'THM', name: '  ', difficulty: 'Easy' })).statusCode).toBe(400)
    expect((await call('POST', '/api/boxes', { platform: 'THM', name: 'x', difficulty: 'Extreme' })).statusCode).toBe(400)
    expect(db.prepare('SELECT count(*) c FROM boxes').get()).toEqual({ c: 0 })
  })

  it('404s on unknown box', async () => {
    expect((await call('GET', '/api/boxes/99')).statusCode).toBe(404)
  })

  it('patches box fields, validates targetIp, empty targetIp stores null', async () => {
    const b = await mk()
    const r = await call('PATCH', `/api/boxes/${b.id}`, { targetIp: '10.10.10.5', notes: 'n' })
    expect(r.json<BoxDetail>()).toMatchObject({ targetIp: '10.10.10.5', notes: 'n' })
    expect((await call('PATCH', `/api/boxes/${b.id}`, { targetIp: '1.1.1.1; rm' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { targetIp: '' })).json<BoxDetail>().targetIp).toBeNull()
  })

  it('patches the summary fields', async () => {
    const b = await mk()
    const body = { foothold: 'anon FTP', privesc: 'SUID find', rating: 'easier than rated' }
    const r = await call('PATCH', `/api/boxes/${b.id}`, body)
    expect(r.statusCode).toBe(200)
    expect(r.json<BoxDetail>()).toMatchObject(body)
    expect((await call('GET', `/api/boxes/${b.id}`)).json<BoxDetail>()).toMatchObject(body)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { rating: 5 })).statusCode).toBe(400)
  })

  it('patches the No writeup flag', async () => {
    const b = await mk()
    expect((await call('GET', `/api/boxes/${b.id}`)).json<BoxDetail>().noWriteup).toBe(false)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { noWriteup: true })).json<BoxDetail>().noWriteup).toBe(true)
    expect((await call('GET', `/api/boxes/${b.id}`)).json<BoxDetail>().noWriteup).toBe(true)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { noWriteup: 'yes' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { noWriteup: false })).json<BoxDetail>().noWriteup).toBe(false)
  })

  it('patches services and haves, deduped and validated', async () => {
    const b = await mk()
    expect(b).toMatchObject({ services: [], haves: [] })
    const url = `/api/boxes/${b.id}`
    const r = await call('PATCH', url, { services: [{ name: 'http', port: 80 }, { name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds', 'creds'] })
    expect(r.statusCode).toBe(200)
    expect(r.json<BoxDetail>()).toMatchObject({ services: [{ name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds'] })
    const many = Array.from({ length: 65 }, (_, i) => ({ name: 'http', port: i + 1 }))
    for (const p of [{ services: [{ name: 'HTTP', port: 80 }] }, { services: [{ name: 'http', port: 70000 }] }, { services: [{ name: 'http', port: 0 }] },
      { services: [{ name: 'http' }] }, { services: many }, { services: 'http' }, { haves: ['root'] }, { haves: 'creds' }])
      expect((await call('PATCH', url, p)).statusCode).toBe(400)
    expect((await call('GET', url)).json<BoxDetail>()).toMatchObject({ services: [{ name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds'] })
    // a PATCH without them leaves them alone
    expect((await call('PATCH', url, { notes: 'x' })).statusCode).toBe(200)
    expect((await call('GET', url)).json<BoxDetail>()).toMatchObject({ notes: 'x', services: [{ name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds'] })
  })

  it('the list carries startedAt, set when status first leaves not_started', async () => {
    const b = await mk()
    expect((await call('GET', '/api/boxes')).json<BoxSummary[]>()[0].startedAt).toBeNull()
    await call('PATCH', `/api/boxes/${b.id}`, { status: 'in_progress' })
    expect((await call('GET', '/api/boxes')).json<BoxSummary[]>()[0].startedAt).toBeTruthy()
  })

  it('PATCH validates fields and 404s an unknown box', async () => {
    const b = await mk()
    for (const p of [{ name: '  ' }, { name: 3 }, { difficulty: 'Extreme' }, { status: 'pwned' }, { tags: 'AD' }, { notes: 1 }])
      expect((await call('PATCH', `/api/boxes/${b.id}`, p)).statusCode).toBe(400)
    expect((await call('GET', `/api/boxes/${b.id}`)).json<BoxDetail>()).toMatchObject({ name: 'Room', difficulty: 'Easy', status: 'not_started', tags: [] })
    expect((await call('PATCH', '/api/boxes/99', { notes: 'x' })).statusCode).toBe(404)
  })

  it('keeps the AD tag while a Persistence step exists', async () => {
    const b = await mk({ tags: ['Active Directory'] })
    expect((await call('PATCH', `/api/boxes/${b.id}`, { tags: [] })).statusCode).toBe(400)
    await call('DELETE', `/api/steps/${b.steps.at(-1)!.id}`)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { tags: [] })).json<BoxDetail>().tags).toEqual([])
  })

  it('status rooted sets rootedAt', async () => {
    const b = await mk()
    const r = (await call('PATCH', `/api/boxes/${b.id}`, { status: 'rooted' })).json<BoxDetail>()
    expect(r.rootedAt).toBeTruthy()
  })
  it('has no timer route and steps carry no time fields', async () => {
    const b = await mk()
    expect((await call('POST', `/api/steps/${b.steps[0].id}/timer`, { action: 'start' })).statusCode).toBe(404)
    expect(b.steps[0]).not.toHaveProperty('seconds')
    expect(b.steps[0]).not.toHaveProperty('timerStartedAt')
    expect((await call('GET', '/api/boxes')).json<object[]>()[0]).not.toHaveProperty('totalSeconds')
  })
  it('status rooted ticks every step done', async () => {
    const b = await mk()
    expect(b.steps.every((s) => !s.done)).toBe(true)
    const r = (await call('PATCH', `/api/boxes/${b.id}`, { status: 'rooted' })).json<BoxDetail>()
    expect(r.steps.map((s) => s.done)).toEqual(b.steps.map(() => true))
  })
  it('leaving rooted clears rootedAt; rooting from not_started also sets startedAt', async () => {
    const b = await mk()
    const r = (await call('PATCH', `/api/boxes/${b.id}`, { status: 'rooted' })).json<BoxDetail>()
    expect(r.startedAt).toBeTruthy()
    expect((await call('PATCH', `/api/boxes/${b.id}`, { status: 'in_progress' })).json<BoxDetail>().rootedAt).toBeNull()
  })
  it('a step can be ticked done and unticked; done must be a boolean', async () => {
    const b = await mk()
    const id = b.steps[0].id
    expect((await call('PATCH', `/api/steps/${id}`, { done: true })).json<Step>().done).toBe(true)
    expect((await call('PATCH', `/api/steps/${id}`, { body: 'kept' })).json<Step>()).toMatchObject({ done: true, body: 'kept' })
    expect((await call('PATCH', `/api/steps/${id}`, { done: false })).json<Step>().done).toBe(false)
    expect((await call('PATCH', `/api/steps/${id}`, { done: 'yes' })).statusCode).toBe(400)
  })
  it('patches the loop fields and dead', async () => {
    const b = await mk()
    const id = b.steps[0].id
    const want = { saw: 'a', think: 'b', tried: 'c', got: 'd', dead: true }
    const r = await call('PATCH', `/api/steps/${id}`, want)
    expect(r.statusCode).toBe(200)
    expect(r.json<Step>()).toMatchObject(want)
    expect((await call('GET', `/api/boxes/${b.id}`)).json<BoxDetail>().steps[0]).toMatchObject(want)
    expect((await call('PATCH', `/api/steps/${id}`, { dead: 'yes' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/steps/${id}`, { saw: 1 })).statusCode).toBe(400)
  })
  it('stamps updated_at on step writes', async () => {
    const stamp = (id: number) => (db.prepare('SELECT updated_at u FROM steps WHERE id = ?').get(id) as { u: string | null }).u
    const iso = (s: number) => new Date(s * 1000).toISOString()
    t = 1000
    const b = await mk()
    const [a, c] = b.steps
    expect(stamp(a.id)).toBe(iso(1000))
    for (const [at, send] of [
      [2000, () => call('PATCH', `/api/steps/${a.id}`, { body: 'x' })],
      [3000, () => call('POST', `/api/steps/${a.id}/tried`, { name: 'nmap' })],
    ] as const) {
      t = at
      expect((await send()).statusCode).toBe(200)
      expect(stamp(a.id), String(at)).toBe(iso(at))
    }
    // reorder leaves it alone
    t = 8000
    const ids = b.steps.map((s) => s.id).reverse()
    expect((await call('PUT', `/api/boxes/${b.id}/step-order`, { stepIds: ids })).statusCode).toBe(200)
    expect(stamp(a.id)).toBe(iso(3000))
  })
  it('newlines in a field are flattened', async () => {
    const b = await mk()
    expect((await call('PATCH', `/api/steps/${b.steps[0].id}`, { tried: 'ffuf\r\ncurl\n\nwget' })).json<Step>().tried).toBe('ffuf curl wget')
    expect((await call('PATCH', `/api/steps/${b.steps[0].id}`, { tried: 'a\r\n\r\nb\rc' })).json<Step>().tried).toBe('a b c')
  })
  it('tried append', async () => {
    const id = (await mk()).steps[0].id
    const tried = async (name: unknown) => (await call('POST', `/api/steps/${id}/tried`, { name })).json<Step>().tried
    expect(await tried('nmap')).toBe('nmap')
    expect(await tried('ffuf')).toBe('nmap, ffuf')
    expect((await call('POST', `/api/steps/${id}/tried`, { name: '' })).statusCode).toBe(400)
    expect((await call('POST', `/api/steps/${id}/tried`, { name: 3 })).statusCode).toBe(400)
    expect((await call('POST', '/api/steps/9999/tried', { name: 'x' })).statusCode).toBe(404)
  })
  it('tried append skips a duplicate', async () => {
    const id = (await mk()).steps[0].id
    const tried = async (name: string) => (await call('POST', `/api/steps/${id}/tried`, { name })).json<Step>().tried
    await tried('nmap')
    await tried('ffuf')
    expect(await tried('FFUF')).toBe('nmap, ffuf')
    expect(await tried('a\nb')).toBe('nmap, ffuf, a b')
  })
  it('tried dedupe is a whole-word match, and trailing separators go', async () => {
    const id = (await mk()).steps[0].id
    const set = (tried: string) => call('PATCH', `/api/steps/${id}`, { tried })
    const tried = async (name: string) => (await call('POST', `/api/steps/${id}/tried`, { name })).json<Step>().tried
    await set('ncat')
    expect(await tried('nc')).toBe('ncat, nc')
    await set('nmap -sV then ffuf')
    expect(await tried('nmap')).toBe('nmap -sV then ffuf')
    await set('ran FFUF earlier')
    expect(await tried('ffuf')).toBe('ran FFUF earlier')
    await set('nmap, ')
    expect(await tried('ffuf')).toBe('nmap, ffuf')
    await set('gobusterXpy')
    expect(await tried('gobuster.py')).toBe('gobusterXpy, gobuster.py')
    expect(await tried('sudo -l')).toBe('gobusterXpy, gobuster.py, sudo -l')
    expect(await tried('gobuster.py')).toBe('gobusterXpy, gobuster.py, sudo -l')
    expect(await tried('sudo -l')).toBe('gobusterXpy, gobuster.py, sudo -l')
  })
  it('rooted leaves dead alone', async () => {
    const b = await mk()
    await call('PATCH', `/api/steps/${b.steps[0].id}`, { dead: true })
    const r = (await call('PATCH', `/api/boxes/${b.id}`, { status: 'rooted' })).json<BoxDetail>()
    expect(r.steps[0]).toMatchObject({ done: true, dead: true })
  })
})

describe('steps', () => {
  it('adds after a step, duplicates, patches', async () => {
    const b = await mk()
    const r = await call('POST', `/api/boxes/${b.id}/steps`, { phase: 'PrivEsc', afterStepId: b.steps[3].id })
    expect(r.statusCode).toBe(201)
    expect(await order(b.id)).toEqual(['Recon', 'Initial Access', 'PrivEsc', 'Lateral Movement', 'PrivEsc', 'Root'])
    const p = await call('PATCH', `/api/steps/${b.steps[0].id}`, { body: 'hi' })
    expect(p.json<Step>().body).toBe('hi')
    const d = await call('POST', `/api/steps/${b.steps[0].id}/duplicate`)
    expect(d.statusCode).toBe(201)
    expect(d.json<Step>()).toMatchObject({ phase: 'Recon', position: 1, body: '' })
    expect((await order(b.id))[1]).toBe('Recon')
  })

  it('rejects a non-integer afterStepId with 400', async () => {
    const b = await mk()
    for (const afterStepId of [{}, '1', 1.5, null])
      expect((await call('POST', `/api/boxes/${b.id}/steps`, { phase: 'Recon', afterStepId })).statusCode).toBe(400)
    expect(await order(b.id)).toHaveLength(5)
  })

  it('PATCH step validates and 404s', async () => {
    const b = await mk()
    expect((await call('PATCH', `/api/steps/${b.steps[0].id}`, { body: 5 })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/steps/${b.steps[0].id}`, { phase: 'Foothold' })).statusCode).toBe(400)
    expect((await call('PATCH', '/api/steps/999', { body: 'x' })).statusCode).toBe(404)
  })

  it('rejects Persistence on non-AD box', async () => {
    const b = await mk()
    expect((await call('POST', `/api/boxes/${b.id}/steps`, { phase: 'Persistence' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/steps/${b.steps[0].id}`, { phase: 'Persistence' })).statusCode).toBe(400)
    expect(await order(b.id)).toHaveLength(5)
  })

  it('reorders and rejects bad sets', async () => {
    const b = await mk()
    const ids = b.steps.map((s) => s.id)
    const r = await call('PUT', `/api/boxes/${b.id}/step-order`, { stepIds: [...ids].reverse() })
    expect(r.json<Step[]>().map((s) => s.id)).toEqual([...ids].reverse())
    const before = await order(b.id)
    expect((await call('PUT', `/api/boxes/${b.id}/step-order`, { stepIds: ids.slice(1) })).statusCode).toBe(400)
    const other = await mk()
    expect((await call('PUT', `/api/boxes/${b.id}/step-order`, { stepIds: [...ids.slice(1), other.steps[0].id] })).statusCode).toBe(400)
    expect((await call('PUT', `/api/boxes/${b.id}/step-order`, { stepIds: [ids[0], ids[0], ...ids.slice(2)] })).statusCode).toBe(400)
    expect(await order(b.id)).toEqual(before)
  })

  it('keeps at least one step', async () => {
    const b = await mk()
    for (const s of b.steps.slice(1)) expect((await call('DELETE', `/api/steps/${s.id}`)).statusCode).toBe(204)
    expect((await call('DELETE', `/api/steps/${b.steps[0].id}`)).statusCode).toBe(400)
  })
})

describe('box list', () => {
  it('serves releaseDate', async () => {
    await mk()
    db.prepare("UPDATE boxes SET release_date = '2024-09-28T19:00:00Z'").run()
    expect((await call('GET', '/api/boxes')).json<{ releaseDate: string }[]>()[0].releaseDate).toBe('2024-09-28T19:00:00Z')
  })
})

describe('report', () => {
  it('serves the report', async () => {
    const b = await mk({ name: 'Lame' })
    await call('PATCH', `/api/steps/${b.steps[0].id}`, { body: 'nmap' })
    const r = await call('GET', `/api/boxes/${b.id}/report`)
    expect(r.statusCode).toBe(200)
    expect(r.json<{ markdown: string }>().markdown.startsWith('# Lame')).toBe(true)
    expect(r.json<{ frontmatter: string }>().frontmatter).toContain('title: "Lame"')
    expect((await call('GET', '/api/boxes/99/report')).statusCode).toBe(404)
    expect((await call('GET', '/api/boxes/abc/report')).statusCode).toBe(404)
  })
})

describe('dns', () => {
  it('stores a DNS name and rejects a bad one', async () => {
    const b = await mk()
    const r = await call('PATCH', `/api/boxes/${b.id}`, { dns: 'example.htb' })
    expect(r.statusCode).toBe(200)
    expect(r.json<BoxDetail>().dns).toBe('example.htb')
    expect((await call('GET', `/api/boxes/${b.id}`)).json<BoxDetail>().dns).toBe('example.htb')
    expect((await call('PATCH', `/api/boxes/${b.id}`, { dns: 'bad host' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { dns: '' })).json<BoxDetail>().dns).toBe('')
  })
})

describe('delete', () => {
  it('removes the box with its steps and answers 404 afterwards', async () => {
    const b = await mk()
    expect((await call('DELETE', `/api/boxes/${b.id}`)).statusCode).toBe(204)
    expect((await call('GET', `/api/boxes/${b.id}`)).statusCode).toBe(404)
    expect((db.prepare('SELECT COUNT(*) AS n FROM steps WHERE box_id = ?').get(b.id) as { n: number }).n).toBe(0)
    expect((await call('DELETE', `/api/boxes/${b.id}`)).statusCode).toBe(404)
  })
})

describe('url', () => {
  it('stores a room link and rejects a bad one', async () => {
    const b = await mk()
    expect((await call('PATCH', `/api/boxes/${b.id}`, { url: 'https://tryhackme.com/room/lame' })).json<BoxDetail>().url).toBe('https://tryhackme.com/room/lame')
    expect((await call('PATCH', `/api/boxes/${b.id}`, { url: 'ftp://x' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { url: 'not a url' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/boxes/${b.id}`, { url: '' })).json<BoxDetail>().url).toBe('')
  })
})

