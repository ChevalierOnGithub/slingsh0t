import { describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { buildApp } from '../app'
import { lootRoutes } from './loot'

const setup = () => {
  const db = openDb(':memory:')
  const app = buildApp({ db, token: 't'.repeat(64), plugins: [lootRoutes] })
  const headers = { host: '127.0.0.1:4317', 'x-slingsh0t-token': 't'.repeat(64) }
  const call = async (method: any, url: string, payload?: object) => {
    const r = await app.inject({ method, url, headers, payload })
    return { code: r.statusCode, body: r.json() }
  }
  const net = db.prepare("INSERT INTO networks (short_id, platform, name) VALUES ('N-001','HTB','Lab')").run().lastInsertRowid as number
  const host = (n: string) => db.prepare('INSERT INTO hosts (short_id, network_id, name) VALUES (?, ?, ?)').run('HS-' + n, net, n).lastInsertRowid as number
  const box = db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('a1','HTB','Box','Easy')").run().lastInsertRowid as number
  return { db, call, net, box, h1: host('dc'), h2: host('web') }
}

describe('loot api', () => {
  it('has no /api/loot and no pivot PATCH', async () => {
    const { call } = setup()
    expect((await call('GET', '/api/loot')).body.message).toBe('Route GET:/api/loot not found')
    expect((await call('PATCH', '/api/pivots/1', { note: 'x' })).body.message).toBe('Route PATCH:/api/pivots/1 not found')
  })

  it('creates subnets and pivots, validating input', async () => {
    const { call, net, h1 } = setup()
    expect((await call('POST', `/api/networks/${net}/subnets`, { cidr: '10.0.0.0/33' })).code).toBe(400)
    const s = await call('POST', `/api/networks/${net}/subnets`, { cidr: '10.10.110.0/24' })
    expect(s.code).toBe(201)
    expect((await call('POST', `/api/networks/${net}/subnets`, { cidr: '10.10.110.0/24' })).code).toBe(409)
    const p = await call('POST', '/api/pivots', { fromHostId: h1, subnetId: s.body.id, method: 'ligolo' })
    expect(p.body).toMatchObject({ fromHostId: h1, method: 'ligolo', note: '' })
    expect((await call('DELETE', `/api/pivots/${p.body.id}`)).code).toBe(200)
    expect((await call('DELETE', `/api/pivots/${p.body.id}`)).code).toBe(404)
    expect((await call('DELETE', `/api/subnets/${s.body.id}`)).code).toBe(200)
  })

  it('counts untested hosts and toggles results', async () => {
    const { call, net, h1, h2 } = setup()
    const c = (await call('POST', '/api/credentials', { networkId: net, username: 'svc', kind: 'password', secret: 'pw', foundOnHostId: h1 })).body
    expect(c).toMatchObject({ untested: 2, foundOn: { hostId: h1, name: 'dc' }, results: [] })
    let r = (await call('PUT', `/api/credentials/${c.id}/results/${h1}`, { result: 'works' })).body
    expect(r).toMatchObject({ untested: 1, results: [{ hostId: h1, name: 'dc', result: 'works' }] })
    expect((await call('GET', '/api/credentials?all=1')).body[0].results).toEqual([{ hostId: h1, name: 'dc', result: 'works' }])
    r = (await call('PUT', `/api/credentials/${c.id}/results/${h1}`, { result: 'failed' })).body
    expect(r.results[0].result).toBe('failed')
    r = (await call('PUT', `/api/credentials/${c.id}/results/${h1}`, { result: null })).body
    expect(r).toMatchObject({ untested: 2, results: [] })
    expect((await call('PUT', `/api/credentials/${c.id}/results/${h2}`, { result: 'bogus' })).code).toBe(400)
    expect((await call('GET', `/api/credentials?networkId=${net}`)).body).toHaveLength(1)
  })

  it('rejects both or neither scope and bad kinds', async () => {
    const { call, net, box } = setup()
    const base = { kind: 'password', secret: 'x' }
    expect((await call('POST', '/api/credentials', { ...base, networkId: net, boxId: box })).code).toBe(400)
    expect((await call('POST', '/api/credentials', base)).code).toBe(400)
    expect((await call('POST', '/api/credentials', { ...base, kind: 'nope', boxId: box })).code).toBe(400)
    expect((await call('GET', '/api/credentials')).code).toBe(400)
  })

  it('loot lists both scopes with names; patch and delete work', async () => {
    const { call, net, box } = setup()
    await call('POST', '/api/credentials', { networkId: net, kind: 'ntlm', secret: 'h' })
    const b = (await call('POST', '/api/credentials', { boxId: box, kind: 'ssh_key', secret: 'k', username: 'root' })).body
    expect(b).toMatchObject({ untested: 0, worksOn: [] })
    // Works on: known services only, stored deduped in SERVICES order; omitting it leaves it alone
    expect((await call('PATCH', `/api/credentials/${b.id}`, { worksOn: ['winrm', 'ssh', 'ssh'] })).body.worksOn).toEqual(['ssh', 'winrm'])
    for (const worksOn of ['ssh', ['telnetz'], [1]]) expect((await call('PATCH', `/api/credentials/${b.id}`, { worksOn })).code).toBe(400)
    expect((await call('PATCH', `/api/credentials/${b.id}`, { foundNote: 'x' })).body.worksOn).toEqual(['ssh', 'winrm'])
    const rdp = (await call('POST', '/api/credentials', { boxId: box, kind: 'password', secret: 'p', worksOn: ['rdp'] })).body
    expect(rdp.worksOn).toEqual(['rdp'])
    await call('DELETE', `/api/credentials/${rdp.id}`)
    expect((await call('GET', '/api/credentials?all=1')).body.map((c: any) => c.scopeName)).toEqual(['Lab', 'Box'])
    expect((await call('PATCH', `/api/credentials/${b.id}`, { username: 'bob' })).body.username).toBe('bob')
    expect((await call('PATCH', `/api/credentials/${b.id}`, { secret: '' })).code).toBe(400)
    expect((await call('DELETE', `/api/credentials/${b.id}`)).code).toBe(200)
    expect((await call('GET', '/api/credentials?all=1')).body).toHaveLength(1)
  })

  it('keeps host ids inside the scope network', async () => {
    const { db, call, net, box, h1 } = setup()
    const net2 = db.prepare("INSERT INTO networks (short_id, platform, name) VALUES ('N-002','THM','Other')").run().lastInsertRowid as number
    const far = db.prepare("INSERT INTO hosts (short_id, network_id, name) VALUES ('HS-far', ?, 'far')").run(net2).lastInsertRowid as number
    const base = { kind: 'password', secret: 'x' }
    expect((await call('POST', '/api/credentials', { ...base, networkId: net, foundOnHostId: far })).code).toBe(400)
    expect((await call('POST', '/api/credentials', { ...base, boxId: box, foundOnHostId: h1 })).code).toBe(400)
    const c = (await call('POST', '/api/credentials', { ...base, networkId: net })).body
    expect((await call('PATCH', `/api/credentials/${c.id}`, { foundOnHostId: far })).code).toBe(400)
    expect((await call('PATCH', `/api/credentials/${c.id}`, { foundOnHostId: h1 })).code).toBe(200)
    expect((await call('PUT', `/api/credentials/${c.id}/results/${far}`, { result: 'works' })).code).toBe(400)
    const bc = (await call('POST', '/api/credentials', { ...base, boxId: box })).body
    expect((await call('PUT', `/api/credentials/${bc.id}/results/${h1}`, { result: 'works' })).code).toBe(400)
    expect((await call('PATCH', `/api/credentials/${bc.id}`, { foundOnHostId: h1 })).code).toBe(400)
    expect((await call('POST', '/api/flags', { networkId: net, value: 'f', hostId: far })).code).toBe(400)
    expect((await call('POST', '/api/flags', { boxId: box, value: 'f', hostId: h1 })).code).toBe(400)
    const f = (await call('POST', '/api/flags', { networkId: net, value: 'f' })).body
    expect((await call('PATCH', `/api/flags/${f.id}`, { hostId: far })).code).toBe(400)
    expect((await call('PATCH', `/api/flags/${f.id}`, { hostId: h1 })).body.hostId).toBe(h1)
  })

  it('validates queries, normalises cidrs, 404s unknown ids, rejects cross-network pivots', async () => {
    const { db, call, net, h1 } = setup()
    expect((await call('GET', '/api/credentials?networkId=abc')).code).toBe(400)
    expect((await call('GET', '/api/flags?boxId=1x')).code).toBe(400)
    const s = await call('POST', `/api/networks/${net}/subnets`, { cidr: '10.0.0.5/24' })
    expect(s.body.cidr).toBe('10.0.0.0/24')
    expect((await call('POST', `/api/networks/${net}/subnets`, { cidr: '10.0.0.9/24' })).code).toBe(409)
    expect((await call('PATCH', '/api/credentials/999', { username: 'x' })).code).toBe(404)
    expect((await call('DELETE', '/api/credentials/999')).code).toBe(404)
    const net2 = db.prepare("INSERT INTO networks (short_id, platform, name) VALUES ('N-002','THM','Other')").run().lastInsertRowid as number
    const s2 = await call('POST', `/api/networks/${net2}/subnets`, { cidr: '10.1.0.0/24' })
    expect((await call('POST', '/api/pivots', { fromHostId: h1, subnetId: s2.body.id })).code).toBe(400)
  })

  it('pivot with fromHostId 0 is a 400', async () => {
    const { call, net } = setup()
    const s = await call('POST', `/api/networks/${net}/subnets`, { cidr: '10.2.0.0/24' })
    const r = await call('POST', '/api/pivots', { fromHostId: 0, subnetId: s.body.id })
    expect(r.code).toBe(400)
    expect(r.body.error).toMatch(/positive/)
  })

  it('flags crud', async () => {
    const { call, net, box, h1 } = setup()
    expect((await call('POST', '/api/flags', { networkId: net, boxId: box, value: 'f' })).code).toBe(400)
    expect((await call('POST', '/api/flags', { boxId: box })).code).toBe(400)
    const f = (await call('POST', '/api/flags', { networkId: net, hostId: h1, label: 'user', value: 'HTB{x}' })).body
    expect(f).toMatchObject({ label: 'user', hostId: h1, scope: { networkId: net } })
    expect((await call('GET', `/api/flags?networkId=${net}`)).body).toHaveLength(1)
    expect((await call('GET', `/api/flags?boxId=${box}`)).body).toHaveLength(0)
    expect((await call('PATCH', `/api/flags/${f.id}`, { label: 'root' })).body.label).toBe('root')
    expect((await call('DELETE', `/api/flags/${f.id}`)).code).toBe(200)
    expect((await call('PATCH', `/api/flags/${f.id}`, { label: 'x' })).code).toBe(404)
  })
  it('add flag fills the expected row (trimmed label) instead of duplicating it', async () => {
    const { call, net, h1 } = setup()
    await call('POST', '/api/flags/bulk', { networkId: net, labels: ['user.txt'] })
    const r = await call('POST', '/api/flags', { networkId: net, label: ' user.txt ', value: 'HTB{x}', hostId: h1 })
    expect(r.code).toBe(200)
    const rows = (await call('GET', `/api/flags?networkId=${net}`)).body
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: r.body.id, label: 'user.txt', value: 'HTB{x}', hostId: h1 })
    expect(rows[0].capturedAt).toBeTruthy()
  })
  it('expected flags: empty value in network scope only; filling stamps captured_at once', async () => {
    const { call, db, net, box } = setup()
    expect((await call('POST', '/api/flags', { boxId: box, label: 'user' })).code).toBe(400)
    expect((await call('POST', '/api/flags', { boxId: box, label: 'user', value: '' })).code).toBe(400)
    const boxFlag = (await call('POST', '/api/flags', { boxId: box, label: 'user', value: 'HTB{placeholder}' })).body
    expect((await call('PATCH', `/api/flags/${boxFlag.id}`, { value: '' })).code).toBe(400)
    const f = (await call('POST', '/api/flags', { networkId: net, label: 'DC01 root' })).body
    expect(f.value).toBe('')
    db.prepare("UPDATE flags SET captured_at = '2020-01-01 00:00:00' WHERE id = ?").run(f.id)
    const filled = (await call('PATCH', `/api/flags/${f.id}`, { value: 'HTB{root}' })).body
    expect(filled.capturedAt).not.toBe('2020-01-01 00:00:00')
    const again = (await call('PATCH', `/api/flags/${f.id}`, { value: 'HTB{root2}' })).body
    expect(again.capturedAt).toBe(filled.capturedAt)
    expect((await call('PATCH', `/api/flags/${f.id}`, { value: '' })).body.value).toBe('')
  })
  it('bulk add trims, dedupes, skips existing, caps at 200 and needs a network', async () => {
    const { call, net, box } = setup()
    await call('POST', '/api/flags', { networkId: net, label: 'b' })
    const r = await call('POST', '/api/flags/bulk', { networkId: net, labels: [' a \r', 'a', '', 'b', 'c'] })
    expect(r.code).toBe(201)
    expect(r.body.map((f: any) => [f.label, f.value])).toEqual([['a', ''], ['c', '']])
    expect((await call('GET', `/api/flags?networkId=${net}`)).body).toHaveLength(3)
    expect((await call('POST', '/api/flags/bulk', { networkId: net, labels: Array.from({ length: 201 }, (_, i) => `f${i}`) })).code).toBe(400)
    expect((await call('POST', '/api/flags/bulk', { boxId: box, labels: ['x'] })).code).toBe(400)
    expect((await call('POST', '/api/flags/bulk', { networkId: 999, labels: ['x'] })).code).toBe(400)
    expect((await call('POST', '/api/flags/bulk', { networkId: net, labels: 'x' })).code).toBe(400)
  })
})
