import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { boxRoutes } from './boxes'
import { libraryRoutes } from './library'
import { networksRoutes } from './networks'
import type { HostDetail, NetworkDetail, NetworkSummary, Step } from '../../shared/types'

let t = 0
let app: FastifyInstance
let db: ReturnType<typeof openDb>

beforeEach(async () => {
  t = 0
  db = openDb(':memory:')
  app = Fastify()
  await app.register(boxRoutes, { db, now: () => t })
  await app.register(networksRoutes, { db, now: () => t })
  await app.register(libraryRoutes, { db })
})

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload })
const net = async (extra: object = {}) =>
  (await call('POST', '/api/networks', { platform: 'HTB', name: 'Dante', ...extra })).json<NetworkDetail>()
const host = async (networkId: number, extra: object = {}) =>
  (await call('POST', `/api/networks/${networkId}/hosts`, { name: 'WEB01', ips: ['10.10.110.5', '172.16.1.5'], ...extra })).json<HostDetail>()
const phases = async (id: number) => (await call('GET', `/api/hosts/${id}`)).json<HostDetail>().steps.map((s) => s.phase)
const count = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n

describe('networks', () => {
  it('delete of a missing network or host answers like a missing box', async () => {
    const gone = await call('DELETE', '/api/boxes/99999')
    for (const url of ['/api/networks/99999', '/api/hosts/99999']) {
      const r = await call('DELETE', url)
      expect([r.statusCode, Object.keys(r.json())]).toEqual([gone.statusCode, Object.keys(gone.json())])
    }
    expect(gone.statusCode).toBe(404)
  })
  it('creates, lists with counts, patches', async () => {
    const r = await call('POST', '/api/networks', { platform: 'Other', name: ' Lab ', hostsInScope: 3, tags: ['Active Directory'] })
    expect(r.statusCode).toBe(201)
    const n = r.json<NetworkDetail>()
    expect(n).toMatchObject({ shortId: 'N-001', platform: 'Other', name: 'Lab', hostsInScope: 3, flagsInScope: null, tags: ['Active Directory'], hosts: [] })
    const h = await host(n.id)
    db.prepare("UPDATE hosts SET status = 'rooted' WHERE id = ?").run(h.id)
    db.prepare("INSERT INTO flags (network_id, value) VALUES (?, 'x')").run(n.id)
    db.prepare("INSERT INTO credentials (network_id, kind, secret) VALUES (?, 'password', 's')").run(n.id)
    expect((await call('GET', '/api/networks')).json<NetworkSummary[]>()).toEqual([{
      id: n.id, shortId: 'N-001', platform: 'Other', name: 'Lab', hostsInScope: 3, flagsInScope: null, url: '',
      hostsFound: 1, hostsOwned: 1, flagsCaptured: 1, credentials: 1,
    }])
    const p = (await call('PATCH', `/api/networks/${n.id}`, { flagsInScope: 7, notes: 'n' })).json<NetworkDetail>()
    expect(p).toMatchObject({ flagsInScope: 7, notes: 'n', hosts: [{ id: h.id, shortId: 'HS-001', status: 'rooted' }] })
    expect(p.hosts[0].ips.map((i) => [i.ip, i.primary])).toEqual([['10.10.110.5', true], ['172.16.1.5', false]])
  })

  it('rejects bad input', async () => {
    expect((await call('POST', '/api/networks', { platform: 'VHL', name: 'x' })).statusCode).toBe(400)
    expect((await call('POST', '/api/networks', { platform: 'HTB', name: ' ' })).statusCode).toBe(400)
    expect((await call('POST', '/api/networks', { platform: 'HTB', name: 'x', hostsInScope: -1 })).statusCode).toBe(400)
    expect((await call('GET', '/api/networks/9')).statusCode).toBe(404)
    expect(count('SELECT count(*) n FROM networks')).toBe(0)
  })

  it('delete network cascades hosts, steps and their search rows', async () => {
    const n = await net()
    const h = await host(n.id)
    expect((await call('DELETE', `/api/networks/${n.id}`)).statusCode).toBe(204)
    expect(count('SELECT count(*) n FROM hosts')).toBe(0)
    expect(count('SELECT count(*) n FROM steps WHERE host_id = ?', h.id)).toBe(0)
    expect(count("SELECT count(*) n FROM search_index WHERE kind IN ('host', 'step')")).toBe(0)
  })
})

describe('hosts', () => {
  it('gets 5 default steps, 6 on an AD network, as a work item', async () => {
    const h = await host((await net()).id)
    expect(h).toMatchObject({ kind: 'host', shortId: 'HS-001', name: 'WEB01', os: '', status: 'not_started', tags: [], targetIp: '10.10.110.5', uses: [] })
    expect(h.steps.map((s) => s.phase)).toEqual(['Recon', 'Initial Access', 'PrivEsc', 'Lateral Movement', 'Root'])
    expect(h.steps[0]).toMatchObject({ boxId: null, hostId: h.id })
    const ad = await host((await net({ tags: ['Active Directory'] })).id, { name: 'DC01' })
    expect(ad.tags).toEqual(['Active Directory'])
    expect(ad.steps.at(-1)!.phase).toBe('Persistence')
  })

  it('invalid IPs → 400, nothing written', async () => {
    const n = await net()
    for (const ips of [['10.0.0.1; rm'], [''], ['1.1.1.1', '1.1.1.1'], 'x', []])
      expect((await call('POST', `/api/networks/${n.id}/hosts`, { name: 'x', ips })).statusCode).toBe(400)
    expect((await call('POST', '/api/networks/99/hosts', { name: 'x', ips: ['10.0.0.1'] })).statusCode).toBe(404)
    expect(count('SELECT count(*) n FROM hosts')).toBe(0)
    const h = await host(n.id)
    expect((await call('POST', `/api/hosts/${h.id}/ips`, { ip: '' })).statusCode).toBe(400)
    expect((await call('POST', `/api/hosts/${h.id}/ips`, { ip: 'a b' })).statusCode).toBe(400)
  })

  it('adds and removes IPs, keeping one primary and at least one IP', async () => {
    const h = await host((await net()).id, { ips: ['10.0.0.1'] })
    expect(h.targetIp).toBe('10.0.0.1')
    expect((await call('POST', `/api/hosts/${h.id}/ips`, { ip: '10.0.0.1' })).statusCode).toBe(409)
    const b = (await call('POST', `/api/hosts/${h.id}/ips`, { ip: '10.0.0.2', primary: true })).json<HostDetail>()
    expect(b.ips.map((i) => [i.ip, i.primary])).toEqual([['10.0.0.1', false], ['10.0.0.2', true]])
    const c = (await call('DELETE', `/api/hosts/${h.id}/ips/${b.ips[1].id}`)).json<HostDetail>()
    expect(c.targetIp).toBe('10.0.0.1')
    expect((await call('DELETE', `/api/hosts/${h.id}/ips/${b.ips[1].id}`)).statusCode).toBe(404)
    expect((await call('DELETE', `/api/hosts/${h.id}/ips/${b.ips[0].id}`)).statusCode).toBe(400)
    expect((await call('GET', `/api/hosts/${h.id}`)).json<HostDetail>().targetIp).toBe('10.0.0.1')
  })

  it('patches fields', async () => {
    const h = await host((await net()).id)
    const r = (await call('PATCH', `/api/hosts/${h.id}`, { status: 'rooted', os: 'Linux', nextStep: 'n' })).json<HostDetail>()
    expect(r).toMatchObject({ status: 'rooted', os: 'Linux', nextStep: 'n' })
    expect((await call('PATCH', `/api/hosts/${h.id}`, { status: 'pwned' })).statusCode).toBe(400)
  })

  it('patches the summary fields', async () => {
    const h = await host((await net()).id)
    const body = { foothold: 'anon FTP', privesc: 'SUID find', rating: 'easier than rated' }
    const r = await call('PATCH', `/api/hosts/${h.id}`, body)
    expect(r.statusCode).toBe(200)
    expect(r.json<HostDetail>()).toMatchObject(body)
    expect((await call('GET', `/api/hosts/${h.id}`)).json<HostDetail>()).toMatchObject(body)
    expect((await call('PATCH', `/api/hosts/${h.id}`, { rating: 5 })).statusCode).toBe(400)
  })

  it('patches services and haves, deduped and validated', async () => {
    const h = await host((await net()).id)
    expect(h).toMatchObject({ services: [], haves: [] })
    const url = `/api/hosts/${h.id}`
    const r = await call('PATCH', url, { services: [{ name: 'http', port: 80 }, { name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds', 'creds'] })
    expect(r.statusCode).toBe(200)
    expect(r.json<HostDetail>()).toMatchObject({ services: [{ name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds'] })
    for (const p of [{ services: [{ name: 'HTTP', port: 80 }] }, { services: [{ name: 'http', port: 70000 }] }, { haves: ['root'] }])
      expect((await call('PATCH', url, p)).statusCode).toBe(400)
    expect((await call('GET', url)).json<HostDetail>()).toMatchObject({ services: [{ name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds'] })
    // a PATCH without them leaves them alone
    expect((await call('PATCH', url, { notes: 'x' })).statusCode).toBe(200)
    expect((await call('GET', url)).json<HostDetail>()).toMatchObject({ notes: 'x', services: [{ name: 'http', port: 80 }, { name: 'smb', port: null }], haves: ['creds'] })
  })

  it('delete host cascades steps and their search rows', async () => {
    const h = await host((await net()).id)
    expect((await call('DELETE', `/api/hosts/${h.id}`)).statusCode).toBe(204)
    expect(count('SELECT count(*) n FROM steps')).toBe(0)
    expect(count("SELECT count(*) n FROM search_index WHERE kind IN ('host', 'step')")).toBe(0)
    expect((await call('GET', `/api/hosts/${h.id}`)).statusCode).toBe(404)
  })
})

describe('host steps', () => {
  it('duplicates, adds, reorders, keeps one', async () => {
    const h = await host((await net()).id)
    const [A] = h.steps
    expect((await call('POST', `/api/steps/${A.id}/duplicate`)).statusCode).toBe(201)
    expect((await call('POST', `/api/hosts/${h.id}/steps`, { phase: 'Root', afterStepId: A.id })).statusCode).toBe(201)
    expect(await phases(h.id)).toEqual(['Recon', 'Root', 'Recon', 'Initial Access', 'PrivEsc', 'Lateral Movement', 'Root'])
    const ids = (await call('GET', `/api/hosts/${h.id}`)).json<HostDetail>().steps.map((s) => s.id)
    const o = await call('PUT', `/api/hosts/${h.id}/step-order`, { stepIds: [...ids].reverse() })
    expect(o.json<Step[]>().map((s) => s.id)).toEqual([...ids].reverse())
    expect((await call('PUT', `/api/hosts/${h.id}/step-order`, { stepIds: ids.slice(1) })).statusCode).toBe(400)
    for (const id of ids.slice(1)) expect((await call('DELETE', `/api/steps/${id}`)).statusCode).toBe(204)
    expect((await call('DELETE', `/api/steps/${ids[0]}`)).statusCode).toBe(400)
  })

  it('Persistence follows the network AD tag', async () => {
    const h = await host((await net()).id)
    expect((await call('POST', `/api/hosts/${h.id}/steps`, { phase: 'Persistence' })).statusCode).toBe(400)
    expect((await call('PATCH', `/api/steps/${h.steps[0].id}`, { phase: 'Persistence' })).statusCode).toBe(400)
    const ad = await host((await net({ tags: ['Active Directory'] })).id)
    expect((await call('POST', `/api/hosts/${ad.id}/steps`, { phase: 'Persistence' })).statusCode).toBe(201)
    expect((await call('POST', '/api/hosts/99/steps', { phase: 'Recon' })).statusCode).toBe(404)
  })

  it('flipping the network AD tag: on adds Persistence, off is refused while a host has a Persistence step', async () => {
    const n = await net()
    const h = await host(n.id)
    await call('PATCH', `/api/networks/${n.id}`, { tags: ['Active Directory'] })
    expect((await call('POST', `/api/hosts/${h.id}/steps`, { phase: 'Persistence' })).statusCode).toBe(201)
    expect((await app.inject(`/api/toolbox?hostId=${h.id}`)).json().phases.map((p: any) => p.phase)).toContain('Persistence')
    expect((await call('PATCH', `/api/networks/${n.id}`, { tags: [] })).statusCode).toBe(400)
    await call('DELETE', `/api/steps/${(await call('GET', `/api/hosts/${h.id}`)).json<HostDetail>().steps.at(-1)!.id}`)
    expect((await call('PATCH', `/api/networks/${n.id}`, { tags: [] })).json<NetworkDetail>().tags).toEqual([])
    expect((await app.inject(`/api/toolbox?hostId=${h.id}`)).json().phases.map((p: any) => p.phase)).not.toContain('Persistence')
  })

  it('default-steps only on a host with none', async () => {
    const n = await net({ tags: ['Active Directory'] })
    const id = Number(db.prepare("INSERT INTO hosts (short_id, network_id, name) VALUES ('HS-099', ?, 'bare')").run(n.id).lastInsertRowid)
    const r = await call('POST', `/api/hosts/${id}/default-steps`)
    expect(r.statusCode).toBe(201)
    expect(r.json<HostDetail>().steps).toHaveLength(6)
    expect((await call('POST', `/api/hosts/${id}/default-steps`)).statusCode).toBe(409)
  })
})

describe('toolbox by host', () => {
  it('uses the host status, its uses and the network tags', async () => {
    db.exec("INSERT INTO techniques (id, short_id, name, phase) VALUES (1,'TQ-901','Port scanning','Recon')")
    const h = await host((await net({ tags: ['Active Directory'] })).id)
    await call('POST', '/api/technique-uses', { techniqueId: 1, stepId: h.steps[0].id })
    const tb = (await app.inject(`/api/toolbox?hostId=${h.id}`)).json()
    expect(tb.phases.map((p: any) => p.phase)).toContain('Persistence')
    expect(tb.phases[0].techniques[0].uses).toHaveLength(1)
    db.prepare("UPDATE hosts SET status = 'rooted' WHERE id = ?").run(h.id)
    expect((await app.inject(`/api/toolbox?hostId=${h.id}`)).json().phases.map((p: any) => p.phase)).toEqual(['Recon'])
    expect((await app.inject('/api/toolbox?hostId=99')).statusCode).toBe(404)
    expect((await app.inject('/api/toolbox?hostId=x')).statusCode).toBe(400)
    expect((await app.inject(`/api/toolbox?hostId=${h.id}&boxId=1`)).statusCode).toBe(400)
  })
})

describe('host report', () => {
  it('serves a host report', async () => {
    const h = await host((await net()).id)
    const r = await call('GET', `/api/hosts/${h.id}/report`)
    expect(r.statusCode).toBe(200)
    expect(r.json<{ frontmatter: string }>().frontmatter).toContain('network: "Dante"')
  })
  it('entry round-trips and is validated', async () => {
    const n = (await call('POST', '/api/networks', { platform: 'HTB', name: 'Dante', entry: ' 10.10.110.0/24 ' })).json<NetworkDetail>()
    expect(n.entry).toBe(' 10.10.110.0/24 ')
    expect((await call('PATCH', `/api/networks/${n.id}`, { entry: 'VPN' })).json<NetworkDetail>().entry).toBe('VPN')
    expect((await call('PATCH', `/api/networks/${n.id}`, { entry: 5 })).statusCode).toBe(400)
  })
  it('flagsCaptured counts only filled values', async () => {
    const n = (await call('POST', '/api/networks', { platform: 'HTB', name: 'Dante' })).json<NetworkDetail>()
    db.prepare("INSERT INTO flags (network_id, label, value) VALUES (?, 'a', ''), (?, 'b', 'HTB{x}')").run(n.id, n.id)
    expect((await call('GET', `/api/networks/${n.id}`)).json<NetworkDetail>().flagsCaptured).toBe(1)
  })
})

describe('network report', () => {
  it('serves a network report, 404 for unknown', async () => {
    const n = await net()
    await host(n.id)
    const r = await call('GET', `/api/networks/${n.id}/report`)
    expect(r.statusCode).toBe(200)
    const body = r.json<{ frontmatter: string; markdown: string }>()
    expect(body.frontmatter).toContain('exported: "1970-01-01"') // the injected clock, t = 0
    expect(body.markdown).toContain('# Dante')
    expect((await call('GET', '/api/networks/999/report')).statusCode).toBe(404)
  })
})
