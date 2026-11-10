import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { pagesRoutes } from './pages'

let app: FastifyInstance
let db: ReturnType<typeof openDb>
beforeEach(async () => {
  db = openDb(':memory:')
  app = Fastify()
  await app.register(pagesRoutes, { db })
})
const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, payload })

// returns step ids followed by the box id
const box = (name: string, bodies: string[]) => {
  const id = db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES (?, 'HTB', ?, 'Easy') RETURNING id").pluck().get(`H-${name}`, name) as number
  return bodies.map((b, i) => db.prepare("INSERT INTO steps (box_id, phase, position, body) VALUES (?, 'PrivEsc', ?, ?) RETURNING id").pluck().get(id, i, b) as number).concat(id)
}

describe('pages api', () => {
  it('techniques list carries per-phase ordinal of each use', async () => {
    const [, s2, boxId] = box('Alpha', ['a', 'b'])
    db.prepare("INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001', 'Sudo abuse', 'PrivEsc')").run()
    db.prepare('INSERT INTO technique_uses (technique_id, step_id) VALUES (1, ?)').run(s2)
    const list = (await call('GET', '/api/techniques')).json<any[]>()
    expect(list[0].uses).toEqual([{ boxId, hostId: null, ownerName: 'Alpha', stepId: s2, phase: 'PrivEsc', ordinal: 2, dead: false }])
    db.prepare('UPDATE steps SET dead = 1 WHERE id = ?').run(s2)
    expect((await call('GET', '/api/techniques')).json<any[]>()[0].uses[0].dead).toBe(true)
    db.exec(`INSERT INTO networks (short_id, platform, name) VALUES ('N-001', 'HTB', 'Dante');
      INSERT INTO hosts (short_id, network_id, name) VALUES ('HS-001', 1, 'WEB01');
      INSERT INTO steps (host_id, phase, position) VALUES (1, 'PrivEsc', 0);`)
    const hostStep = (db.prepare('SELECT id FROM steps WHERE host_id = 1').pluck().get()) as number
    db.prepare('INSERT INTO technique_uses (technique_id, step_id) VALUES (1, ?)').run(hostStep)
    expect((await call('GET', '/api/techniques')).json<any[]>()[0].uses).toContainEqual(
      { boxId: null, hostId: 1, ownerName: 'WEB01', stepId: hostStep, phase: 'PrivEsc', ordinal: 1, dead: false })
    expect((await call('PATCH', '/api/techniques/1', { phase: 'Nope' })).statusCode).toBe(400)
    expect((await call('PATCH', '/api/techniques/9', { name: 'x' })).statusCode).toBe(404)
    expect((await call('PATCH', '/api/techniques/1', { name: ' Sudo ', phase: 'Root' })).json()).toMatchObject({ name: 'Sudo', phase: 'Root' })
  })

  it('writeups sort newest first across timestamp formats', async () => {
    const aId = box('A', ['x']).pop()!
    const bId = box('B', ['y']).pop()!
    db.prepare("UPDATE boxes SET created_at = '2026-11-01 15:00:00' WHERE id = ?").run(aId)
    db.prepare("UPDATE boxes SET started_at = '2026-11-01T09:00:00.000Z' WHERE id = ?").run(bId)
    expect((await call('GET', '/api/writeups')).json<any[]>().map(w => w.name)).toEqual(['A', 'B'])
  })

  it('exports one markdown file per writeup', async () => {
    const [, boxId] = box('Room', ['did it'])
    db.prepare("UPDATE boxes SET short_id = 'T-0001' WHERE id = ?").run(boxId)
    db.exec("INSERT INTO networks (short_id, platform, name, notes) VALUES ('N-0001', 'HTB', 'Dante Lab', 'notes here')")
    const res = await app.inject({ method: 'GET', url: '/api/export/writeups.zip' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="slingsh0t-writeups-\d{8}\.zip"$/)
    const z = res.rawPayload
    expect(z.readUInt32LE(0)).toBe(0x04034b50)
    const names: string[] = []
    let first = ''
    for (let o = 0; z.readUInt32LE(o) === 0x04034b50; ) {
      const len = z.readUInt16LE(o + 26), size = z.readUInt32LE(o + 18), n = z.toString('utf8', o + 30, o + 30 + len)
      if (!names.length) first = z.toString('utf8', o + 30 + len, o + 30 + len + size)
      names.push(n)
      o += 30 + len + size
    }
    expect(names).toEqual(['boxes/T-0001-room.md', 'networks/N-0001-dante-lab.md'])
    expect(first.startsWith('---\ntitle: "Room"')).toBe(true)
  })

  it('export entry names cannot escape their folder', async () => {
    const [, boxId] = box('Evil', ['did it'])
    db.prepare("UPDATE boxes SET short_id = '../../evil' WHERE id = ?").run(boxId)
    const z = (await call('GET', '/api/export/writeups.zip')).rawPayload
    const len = z.readUInt16LE(26)
    const name = z.toString('utf8', 30, 30 + len)
    expect(name).toBe('boxes/evil-evil.md')
    expect(name.replace('boxes/', '')).not.toMatch(/\.\.|\//)
  })

  it('a technique lists its tool-less commands', async () => {
    db.exec(`INSERT INTO tools (id, short_id, name) VALUES (1, 'TL-001', 'nmap');
      INSERT INTO techniques (id, short_id, name, phase) VALUES (1, 'TQ-001', 'Scan', 'Recon');
      INSERT INTO commands (technique_id, purpose, template) VALUES (1, 'plain', 'echo hi');
      INSERT INTO commands (technique_id, tool_id, purpose, template) VALUES (1, 1, 'tooled', 'nmap x');`)
    const cmds = (await call('GET', '/api/techniques')).json<any[]>()[0].commands
    expect(cmds).toEqual([{ id: 1, purpose: 'plain', template: 'echo hi', procedureKey: null, position: null, intent: '' }])
  })

  it('ordinals stay distinct when two steps share a position', async () => {
    const [a, b] = box('Tie', ['a', 'b'])
    db.prepare('UPDATE steps SET position = 0').run()
    db.prepare("INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001', 'Sudo abuse', 'PrivEsc')").run()
    db.prepare('INSERT INTO technique_uses (technique_id, step_id) VALUES (1, ?), (1, ?)').run(a, b)
    const uses = (await call('GET', '/api/techniques')).json<any[]>()[0].uses
    expect(uses.map((u: any) => [u.stepId, u.ordinal]).sort()).toEqual([[a, 1], [b, 2]])
  })

  it('tools list carries the techniques each tool is linked to', async () => {
    db.exec(`INSERT INTO tools (id, short_id, name) VALUES (1, 'TL-001', 'nmap');
      INSERT INTO techniques (id, short_id, name, phase) VALUES (1, 'TQ-001', 'Port scanning', 'Recon'), (2, 'TQ-002', 'banner grabbing', 'Recon');
      INSERT INTO technique_tools VALUES (1, 1), (2, 1);`)
    expect((await call('GET', '/api/tools')).json<any[]>()[0].techniques).toEqual([{ id: 2, name: 'banner grabbing' }, { id: 1, name: 'Port scanning' }])
  })

  it('tools list with commands; command add/edit/delete', async () => {
    db.exec(`INSERT INTO tools (short_id, name) VALUES ('TL-001', 'Reverse shells');
      INSERT INTO commands (tool_id, purpose, template) VALUES (1,'a','a'),(1,'b','b'),(1,'c','c'),(1,'d','d'),(1,'e','e');`)
    const tools = (await call('GET', '/api/tools')).json<any[]>()
    expect(tools[0].name).toBe('Reverse shells')
    expect(tools[0].commands).toHaveLength(5)
    const c = (await call('POST', `/api/tools/${tools[0].id}/commands`, { purpose: 'p', template: 't {{LHOST}}' })).json<any>()
    expect((await call('POST', '/api/tools/99/commands', { purpose: 'p', template: 't' })).statusCode).toBe(404)
    expect((await call('POST', `/api/tools/${tools[0].id}/commands`, { purpose: 'p' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/commands/${c.id}`, { template: 'new' })).json()).toMatchObject({ purpose: 'p', template: 'new' })
    expect((await call('PATCH', `/api/commands/${c.id}`, { template: '' })).statusCode).toBe(400)
    expect(c.intent).toBe('')
    const e = await call('PATCH', `/api/commands/${c.id}`, { intent: 'enumerate' })
    expect(e.statusCode).toBe(200)
    expect(e.json()).toMatchObject({ template: 'new', intent: 'enumerate' })
    expect((await call('PATCH', `/api/commands/${c.id}`, { intent: 'x' })).statusCode).toBe(400)
    expect((await call('POST', `/api/tools/${tools[0].id}/commands`, { purpose: 'p', template: 't', intent: 'x' })).statusCode).toBe(400)
    expect((await call('DELETE', `/api/commands/${c.id}`)).statusCode).toBe(204)
    expect((await call('PATCH', `/api/commands/${c.id}`, { purpose: 'x' })).statusCode).toBe(404)
    expect((await call('DELETE', `/api/commands/${c.id}`)).statusCode).toBe(404)
  })

  it('writeups count filled steps and skip empty boxes', async () => {
    box('Alpha', ['text', '  ', 'more'])
    box('Empty', ['', ''])
    const w = (await call('GET', '/api/writeups')).json<any[]>()
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ name: 'Alpha', filledSteps: 2, totalSteps: 3, platform: 'HTB', status: 'not_started' })
  })

  it('writeups list networks with a filled host step or notes, after boxes', async () => {
    box('Alpha', ['text'])
    const net = db.prepare("INSERT INTO networks (short_id, platform, name) VALUES ('N-0001', 'HTB', 'Dante')").run().lastInsertRowid
    const h = (name: string, status = 'in_progress') => db.prepare("INSERT INTO hosts (short_id, network_id, name, status) VALUES (?, ?, ?, ?)").run('HS-' + name, net, name, status).lastInsertRowid
    const h1 = h('WEB01', 'rooted'); h('DB01')
    db.prepare("INSERT INTO steps (host_id, phase, position, body) VALUES (?, 'Recon', 0, 'nmap'), (?, 'Root', 1, '')").run(h1, h1)
    const quiet = db.prepare("INSERT INTO networks (short_id, platform, name) VALUES ('N-0002', 'THM', 'Quiet')").run().lastInsertRowid
    db.prepare("INSERT INTO flags (network_id, label, value) VALUES (?, 'expected', '')").run(quiet)
    db.prepare("INSERT INTO networks (short_id, platform, name, notes) VALUES ('N-0003', 'THM', 'Noted', 'x')").run()
    const w = (await call('GET', '/api/writeups')).json<any[]>()
    expect(w.map((x) => [x.kind, x.name])).toEqual([['box', 'Alpha'], ['network', 'Noted'], ['network', 'Dante']])
    expect(w[2]).toMatchObject({ id: net, shortId: 'N-0001', platform: 'HTB', status: '1/2 hosts', filledSteps: 1, totalSteps: 2 })
    expect(typeof w[2].updatedAt).toBe('string')
  })

  it('reference create, PUT then GET, validation, 404', async () => {
    const p = (await call('POST', '/api/reference', { title: 'Ports', body: 'a' })).json<any>()
    expect((await call('PUT', `/api/reference/${p.id}`, { title: 'Ports 2', body: 'b' })).statusCode).toBe(200)
    expect((await call('GET', `/api/reference/${p.id}`)).json()).toEqual({ id: p.id, title: 'Ports 2', body: 'b' })
    expect((await call('GET', '/api/reference')).json<any[]>()).toHaveLength(1)
    expect((await call('PUT', `/api/reference/${p.id}`, { title: '', body: 'b' })).statusCode).toBe(400)
    expect((await call('PUT', '/api/reference/99', { title: 't', body: 'b' })).statusCode).toBe(404)
    expect((await call('GET', '/api/reference/99')).statusCode).toBe(404)
  })

  it('has no unsorted routes', async () => {
    expect((await call('GET', '/api/unsorted')).json().message).toBe('Route GET:/api/unsorted not found')
    expect((await call('DELETE', '/api/unsorted/1')).json().message).toBe('Route DELETE:/api/unsorted/1 not found')
  })
})

describe('technique position and applies', () => {
  const tech = (name: string, phase: string, position: number) =>
    db.prepare("INSERT INTO techniques (short_id, name, phase, position) VALUES (?, ?, ?, ?) RETURNING id").pluck().get(`TQ-${name}`, name, phase, position) as number
  const names = async (phase: string) => (await call('GET', '/api/techniques')).json<any[]>().filter((t) => t.phase === phase).map((t) => t.name)

  it('PATCH applies', async () => {
    const a = tech('a', 'Recon', 1)
    const r = await call('PATCH', `/api/techniques/${a}`, { applies: 'linux' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ id: a, shortId: 'TQ-a', name: 'a', phase: 'Recon', description: '', position: 1, applies: 'linux', service: 'any', needs: [], yields: [] })
    expect((await call('PATCH', `/api/techniques/${a}`, { applies: 'web' })).statusCode).toBe(400)
    expect((await call('GET', '/api/techniques')).json<any[]>()[0]).toMatchObject({ position: 1, applies: 'linux', service: 'any', needs: [], yields: [] })
  })

  it('PATCH service, needs, yields', async () => {
    const a = tech('a', 'Recon', 1)
    const r = await call('PATCH', `/api/techniques/${a}`, { service: 'http', needs: ['web app', 'web app'], yields: ['creds'] })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ service: 'http', needs: ['web app'], yields: ['creds'] })
    expect((await call('GET', '/api/techniques')).json<any[]>()[0]).toMatchObject({ service: 'http', needs: ['web app'], yields: ['creds'] })
    for (const body of [{ service: 'Bad Slug' }, { service: 'HTTP' }, { service: 3 }, { needs: ['laser'] }, { yields: 'creds' }])
      expect((await call('PATCH', `/api/techniques/${a}`, body)).statusCode).toBe(400)
    expect((await call('PATCH', `/api/techniques/${a}`, { service: 'shell' })).json()).toMatchObject({ service: 'shell', needs: ['web app'] })
  })

  it('a phase change re-appends', async () => {
    const a = tech('a', 'Recon', 1)
    const b = tech('b', 'Recon', 2)
    tech('old', 'PrivEsc', 1)
    expect((await call('PATCH', `/api/techniques/${a}`, { phase: 'PrivEsc' })).json()).toMatchObject({ phase: 'PrivEsc', position: 2 })
    expect(await names('PrivEsc')).toEqual(['old', 'a'])
    // the same phase again is no move
    expect((await call('PATCH', `/api/techniques/${a}`, { phase: 'PrivEsc' })).json()).toMatchObject({ position: 2 })
    // the old phase can still be reordered without the moved technique
    const r = await call('PUT', '/api/techniques/order', { ids: [b] })
    expect(r.statusCode).toBe(200)
    expect(r.json<any[]>().map((t) => [t.id, t.position])).toEqual([[b, 1]])
  })

  it('order PUT', async () => {
    const a = tech('a', 'Recon', 1)
    const b = tech('b', 'Recon', 2)
    const p = tech('p', 'PrivEsc', 1)
    const r = await call('PUT', '/api/techniques/order', { ids: [b, a] })
    expect(r.statusCode).toBe(200)
    expect(r.json<any[]>().map((t) => [t.id, t.position])).toEqual([[b, 1], [a, 2]])
    expect(await names('Recon')).toEqual(['b', 'a'])
    for (const ids of [[a], [a, p], [a, 999], [a, a], [], 'x'])
      expect((await call('PUT', '/api/techniques/order', { ids })).statusCode).toBe(400)
  })

  it('adds a tool, a technique command, and links the tool to the technique', async () => {
    const tool = await call('POST', '/api/tools', { name: ' feroxbuster ', description: 'Content discovery' })
    expect(tool.statusCode).toBe(201)
    expect(tool.json()).toEqual({ id: 1, shortId: 'TL-001', name: 'feroxbuster', description: 'Content discovery', commands: [], techniques: [] })
    expect((await call('POST', '/api/tools', { name: 'feroxbuster' })).statusCode).toBe(409)
    expect((await call('POST', '/api/tools', { name: ' ' })).statusCode).toBe(400)

    db.prepare("INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001', 'Content discovery', 'Recon')").run()
    const c = await call('POST', '/api/techniques/1/commands', { purpose: 'Check robots', template: 'curl http://{{TARGET}}/robots.txt', intent: 'enumerate' })
    expect(c.statusCode).toBe(201)
    expect(db.prepare('SELECT tool_id, technique_id FROM commands WHERE id = ?').get(c.json().id)).toEqual({ tool_id: null, technique_id: 1 })
    expect((await call('POST', '/api/techniques/9/commands', { purpose: '', template: 'x' })).statusCode).toBe(404)
    expect((await call('POST', '/api/techniques/1/commands', { purpose: '', template: ' ' })).statusCode).toBe(400)

    expect((await call('PUT', '/api/techniques/1/tools/1')).statusCode).toBe(204)
    expect((await call('PUT', '/api/techniques/1/tools/1')).statusCode).toBe(204) // already linked
    expect((await call('PUT', '/api/techniques/1/tools/9')).statusCode).toBe(404)
    expect((await call('PUT', '/api/techniques/9/tools/1')).statusCode).toBe(404)
    const tq = (await call('GET', '/api/techniques')).json<any[]>()[0]
    expect(tq.tools).toEqual([{ id: 1, name: 'feroxbuster' }])
    expect(tq.commands.map((x: any) => x.template)).toEqual(['curl http://{{TARGET}}/robots.txt'])
    expect((await call('GET', '/api/tools')).json<any[]>()[0].techniques).toEqual([{ id: 1, name: 'Content discovery' }])
    expect((await call('DELETE', '/api/techniques/1/tools/1')).statusCode).toBe(204)
    expect((await call('GET', '/api/techniques')).json<any[]>()[0].tools).toEqual([])
  })
})
