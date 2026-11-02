import { describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { buildApp } from '../app'

const setup = () => {
  const db = openDb(':memory:')
  const app = buildApp({ db, token: 't'.repeat(64) })
  const headers = { host: '127.0.0.1:4317', 'x-slingsh0t-token': 't'.repeat(64) }
  const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/context', headers, payload })
  const get = async () => (await app.inject({ method: 'GET', url: '/api/context', headers })).json()
  return { db, put, get }
}

describe('context api', () => {
  it('stores lhost/lport', async () => {
    const { put, get } = setup()
    expect((await put({ lhost: '10.10.14.7', lport: '4444' })).statusCode).toBe(200)
    expect(await get()).toMatchObject({ lhost: '10.10.14.7', lport: '4444', target: '' })
  })
  it('rejects invalid values', async () => {
    const { put } = setup()
    for (const p of [{ lport: '70000' }, { lport: 'abc' }, { lport: '00080' }, { lport: '0' }, { lhost: '10.10.14.7; rm -rf /' }, { lhost: '-oX' }])
      expect((await put(p)).statusCode).toBe(400)
  })
  it('writes target to the active box', async () => {
    const { db, put, get } = setup()
    const id = db
      .prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('a1','HTB','Box','Easy')")
      .run().lastInsertRowid as number
    expect((await put({ activeBoxId: id, target: '10.10.11.35' })).statusCode).toBe(200)
    expect((await get()).target).toBe('10.10.11.35')
    expect(db.prepare('SELECT target_ip FROM boxes WHERE id = ?').get(id)).toEqual({ target_ip: '10.10.11.35' })
    expect((await put({ target: '' })).statusCode).toBe(200)
    expect((await get()).target).toBe('')
    expect(db.prepare('SELECT target_ip FROM boxes WHERE id = ?').get(id)).toEqual({ target_ip: null })
  })
  it('rejects target without active box and unknown box', async () => {
    const { put } = setup()
    expect((await put({ target: '1.2.3.4' })).statusCode).toBe(400)
    expect((await put({ activeBoxId: 999 })).statusCode).toBe(400)
  })
  describe('network hosts', () => {
    const seed = (db: ReturnType<typeof openDb>) => {
      db.exec(`INSERT INTO networks (id, short_id, platform, name) VALUES (1,'N-001','HTB','Lab');
        INSERT INTO hosts (id, short_id, network_id, name) VALUES (1,'HS-001',1,'dmz'),(2,'HS-002',1,'inner');
        INSERT INTO host_ips (host_id, ip, is_primary) VALUES (1,'10.0.0.5',1),(1,'172.16.1.5',0),(2,'172.16.2.9',1);
        INSERT INTO subnets (id, network_id, cidr) VALUES (1,1,'172.16.0.0/16');
        INSERT INTO pivots (from_host_id, subnet_id, method) VALUES (1,1,'ligolo');
        INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('a1','HTB','Box','Easy')`)
    }
    it('defaults to primary, switches to secondary, rejects foreign IP', async () => {
      const { db, put, get } = setup()
      seed(db)
      await put({ activeHostId: 1 })
      expect(await get()).toMatchObject({ activeHostId: 1, target: '10.0.0.5', via: null })
      await put({ target: '172.16.1.5' })
      expect((await get()).target).toBe('172.16.1.5')
      expect((await put({ target: '8.8.8.8' })).statusCode).toBe(400)
      expect((await put({ activeHostId: 99 })).statusCode).toBe(400)
      expect((await get()).target).toBe('172.16.1.5')
      expect((await put({ target: '' })).statusCode).toBe(200)
      expect((await get()).target).toBe('10.0.0.5')
    })
    it('derives via text from the pivot CIDR', async () => {
      const { db, put, get } = setup()
      seed(db)
      await put({ activeHostId: 2 })
      expect((await get()).via).toBe('via ligolo through dmz')
    })
    it('picking a box clears the host and vice versa', async () => {
      const { db, put, get } = setup()
      seed(db)
      await put({ activeHostId: 1 })
      await put({ activeBoxId: 1, target: '10.10.11.1' })
      expect(await get()).toMatchObject({ activeHostId: null, activeBoxId: 1, target: '10.10.11.1', via: null })
      await put({ activeHostId: 1 })
      expect(await get()).toMatchObject({ activeHostId: 1, activeBoxId: null, target: '10.0.0.5' })
    })
    it('scopes via to the host network and ignores its own pivots', async () => {
      const { db, put, get } = setup()
      seed(db)
      db.exec(`INSERT INTO networks (id, short_id, platform, name) VALUES (2,'N-002','HTB','Other');
        INSERT INTO hosts (id, short_id, network_id, name) VALUES (3,'HS-003',2,'edge'),(4,'HS-004',2,'core');
        INSERT INTO host_ips (host_id, ip, is_primary) VALUES (3,'10.9.0.1',1),(4,'172.16.7.7',1);
        INSERT INTO subnets (id, network_id, cidr) VALUES (2,2,'172.16.0.0/16'),(3,1,'10.0.0.0/8');
        INSERT INTO pivots (from_host_id, subnet_id, method) VALUES (3,2,'chisel'),(1,3,'ssh')`)
      await put({ activeHostId: 4 })
      expect((await get()).via).toBe('via chisel through edge')
      await put({ activeHostId: 1 }) // 10.0.0.5 is in 10/8, but that pivot starts at host 1 itself
      expect((await get()).via).toBeNull()
    })
    it('nested pivot subnets: the longest prefix wins, then the lowest pivot id', async () => {
      const { db, put, get } = setup()
      seed(db) // pivot 1: dmz -> 172.16.0.0/16 (ligolo)
      db.exec(`INSERT INTO hosts (id, short_id, network_id, name) VALUES (3,'HS-003',1,'web'),(4,'HS-004',1,'jump');
        INSERT INTO subnets (id, network_id, cidr) VALUES (2,1,'172.16.2.0/24');
        INSERT INTO pivots (id, from_host_id, subnet_id, method) VALUES (2,3,2,'chisel'),(3,4,2,'ssh')`)
      await put({ activeHostId: 2 }) // 172.16.2.9 is in both the /16 and the /24
      expect((await get()).via).toBe('via chisel through web')
      db.exec('DELETE FROM pivots WHERE id = 2')
      expect((await get()).via).toBe('via ssh through jump')
      db.exec('DELETE FROM subnets WHERE id = 2')
      expect((await get()).via).toBe('via ligolo through dmz')
    })
    it('falls back to primary when the chosen IP is gone; lhost-only keeps it', async () => {
      const { db, put, get } = setup()
      seed(db)
      await put({ activeHostId: 1, target: '172.16.1.5' })
      await put({ lhost: '10.10.14.7' })
      expect((await get()).target).toBe('172.16.1.5')
      db.exec("DELETE FROM host_ips WHERE ip = '172.16.1.5'")
      expect((await get()).target).toBe('10.0.0.5')
    })
    it('rejects host+box together and re-pick resets to primary', async () => {
      const { db, put, get } = setup()
      seed(db)
      expect((await put({ activeHostId: 1, activeBoxId: 1 })).statusCode).toBe(400)
      await put({ activeHostId: 1, target: '172.16.1.5' })
      await put({ activeHostId: 2 })
      expect((await get()).target).toBe('172.16.2.9')
    })
  })
})
