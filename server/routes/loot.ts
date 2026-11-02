import type { FastifyPluginAsync } from 'fastify'
import type { Database } from 'better-sqlite3'
import { SERVICES, type Credential, type Flag, type LootItem, type Pivot, type Subnet } from '../../shared/types'
import { isCidr } from '../../shared/cidr'
import { updateRow } from '../db'
import { isId, isStr } from '../validate'

const KINDS = ['password', 'ntlm', 'kerberos', 'ssh_key', 'other']

type Row = Record<string, any>
// Secrets (credential secret, flag value) must never be logged: no log calls in this file.
export const lootRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const exists = (table: string, v: unknown) => isId(v) && !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(v)
  type Sc = { col: string; v: number }
  // A host id is valid for a scope only if it lives in that scope's network (box scope has no hosts).
  const hostOk = (hid: unknown, sc: Sc) =>
    sc.col === 'network_id' && isId(hid) && (db.prepare('SELECT network_id FROM hosts WHERE id = ?').get(hid) as Row | undefined)?.network_id === sc.v
  const toScope = (sc: Row): Sc => ('networkId' in sc ? { col: 'network_id', v: sc.networkId } : { col: 'box_id', v: sc.boxId })
  const badQuery = (...q: (string | undefined)[]) => q.some((x) => x !== undefined && !/^\d+$/.test(x))
  // Zero the host bits so 10.0.0.5/24 is stored (and de-duplicated) as 10.0.0.0/24. Input is already isCidr-valid.
  const normCidr = (c: string) => {
    const [base, bits] = c.split('/')
    const size = 2 ** (32 - +bits)
    const n = Math.floor(base.split('.').reduce((a, x) => a * 256 + +x, 0) / size) * size
    return [24, 16, 8, 0].map((sh) => Math.floor(n / 2 ** sh) % 256).join('.') + '/' + bits
  }
  const scopeOf = (r: Row) => (r.network_id !== null ? { networkId: r.network_id } : { boxId: r.box_id })

  const resultsOf = db.prepare('SELECT x.host_id AS hostId, h.name, x.result FROM credential_results x JOIN hosts h ON h.id = x.host_id WHERE x.credential_id = ? ORDER BY x.host_id')
  const untestedOf = db.prepare(`SELECT COUNT(*) AS n FROM hosts h WHERE h.network_id = ?
    AND NOT EXISTS (SELECT 1 FROM credential_results x WHERE x.credential_id = ? AND x.host_id = h.id)`)
  // shortcut: two small queries per credential (N+1); 50 credentials x 30 hosts list in ~0.6 ms (measured), so batch only if listings grow to thousands.
  const credentials = (where: string, args: unknown[]): LootItem[] =>
    (db
      .prepare(
        `SELECT c.*, h.name AS found_name, COALESCE(n.name, b.name) AS scope_name, COALESCE(n.short_id, b.short_id) AS scope_short
         FROM credentials c LEFT JOIN hosts h ON h.id = c.found_on_host_id
         LEFT JOIN networks n ON n.id = c.network_id LEFT JOIN boxes b ON b.id = c.box_id
         ${where} ORDER BY c.id`,
      )
      .all(...args) as Row[]).map((r) => ({
      id: r.id, username: r.username, kind: r.kind, secret: r.secret,
      foundOn: r.found_on_host_id === null ? null : { hostId: r.found_on_host_id, name: r.found_name },
      foundNote: r.found_note, scope: scopeOf(r),
      results: resultsOf.all(r.id) as Credential['results'],
      untested: r.network_id === null ? 0 : (untestedOf.get(r.network_id, r.id) as { n: number }).n,
      worksOn: JSON.parse(r.works_on),
      scopeName: r.scope_name, scopeShortId: r.scope_short,
    }))
  const credential = (cid: number) => credentials('WHERE c.id = ?', [cid])[0]
  const flagOf = (r: Row): Flag => ({ id: r.id, label: r.label, value: r.value, hostId: r.host_id, capturedAt: r.captured_at, scope: scopeOf(r) })
  const flag = (fid: number): Flag => flagOf(db.prepare('SELECT * FROM flags WHERE id = ?').get(fid) as Row)

  // Shared by credential/flag create: exactly one of networkId/boxId, and it must exist.
  const scopeFrom = (b: Row): { col: 'network_id' | 'box_id'; v: number } | string => {
    if ((b.networkId == null) === (b.boxId == null)) return 'exactly one of networkId or boxId'
    return b.networkId != null
      ? (exists('networks', b.networkId) ? { col: 'network_id', v: b.networkId } : 'unknown network')
      : (exists('boxes', b.boxId) ? { col: 'box_id', v: b.boxId } : 'unknown box')
  }
  const patch = (table: string, rid: number, cols: Record<string, unknown>) =>
    updateRow(db, table, rid, Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined)))
  const del = (table: string) => async (req: any, reply: any) =>
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id)).changes ? { ok: true } : reply.code(404).send({ error: 'not found' })

  // --- subnets / pivots ---
  app.post<{ Params: { id: string }; Body: Row }>('/api/networks/:id/subnets', async (req, reply) => {
    const nid = Number(req.params.id)
    if (!exists('networks', nid)) return reply.code(404).send({ error: 'unknown network' })
    const raw = req.body?.cidr
    if (!isStr(raw) || !isCidr(raw)) return reply.code(400).send({ error: 'invalid cidr' })
    const cidr = normCidr(raw)
    if (db.prepare('SELECT 1 FROM subnets WHERE network_id = ? AND cidr = ?').get(nid, cidr)) return reply.code(409).send({ error: 'duplicate cidr' })
    const sid = db.prepare('INSERT INTO subnets (network_id, cidr) VALUES (?, ?)').run(nid, cidr).lastInsertRowid as number
    return reply.code(201).send({ id: sid, networkId: nid, cidr } satisfies Subnet)
  })
  app.delete('/api/subnets/:id', del('subnets'))

  const pivot = (pid: number) => db.prepare('SELECT id, from_host_id AS fromHostId, subnet_id AS subnetId, method, note FROM pivots WHERE id = ?').get(pid) as Pivot | undefined
  app.post<{ Body: Row }>('/api/pivots', async (req, reply) => {
    const b = req.body ?? {}
    const bad = (error: string, code = 400) => reply.code(code).send({ error })
    const host = isId(b.fromHostId) ? (db.prepare('SELECT network_id FROM hosts WHERE id = ?').get(b.fromHostId) as Row | undefined) : undefined
    const sub = isId(b.subnetId) ? (db.prepare('SELECT network_id FROM subnets WHERE id = ?').get(b.subnetId) as Row | undefined) : undefined
    if (!isId(b.fromHostId) || !isId(b.subnetId)) return bad('fromHostId and subnetId must be positive integers')
    if (!host) return bad('unknown host')
    if (!sub) return bad('unknown subnet')
    if (host.network_id !== sub.network_id) return bad('host and subnet are in different networks')
    if ((b.method !== undefined && !isStr(b.method)) || (b.note !== undefined && !isStr(b.note))) return bad('invalid method or note')
    if (db.prepare('SELECT 1 FROM pivots WHERE from_host_id = ? AND subnet_id = ?').get(b.fromHostId, b.subnetId)) return bad('duplicate pivot', 409)
    const pid = db.prepare('INSERT INTO pivots (from_host_id, subnet_id, method, note) VALUES (?, ?, ?, ?)').run(b.fromHostId, b.subnetId, b.method ?? '', b.note ?? '').lastInsertRowid as number
    return reply.code(201).send(pivot(pid))
  })
  app.patch<{ Params: { id: string }; Body: Row }>('/api/pivots/:id', async (req, reply) => {
    const pid = Number(req.params.id)
    if (!pivot(pid)) return reply.code(404).send({ error: 'not found' })
    const { method, note } = req.body ?? {}
    if ((method !== undefined && !isStr(method)) || (note !== undefined && !isStr(note))) return reply.code(400).send({ error: 'invalid method or note' })
    patch('pivots', pid, { method, note })
    return pivot(pid)
  })
  app.delete('/api/pivots/:id', del('pivots'))

  // --- credentials ---
  // Stored deduped in SERVICES order, so the chips read the same however they were picked.
  const worksOnJson = (list?: string[]) => list && JSON.stringify(SERVICES.filter((s) => list.includes(s)))
  const checkCred = (b: Row, partial: boolean, sc: Sc): string | null => {
    if (b.username !== undefined && !isStr(b.username)) return 'invalid username'
    if (b.foundNote !== undefined && !isStr(b.foundNote)) return 'invalid foundNote'
    if (b.kind !== undefined ? !KINDS.includes(b.kind) : !partial) return 'invalid kind'
    if (b.secret !== undefined ? !isStr(b.secret) || !b.secret : !partial) return 'secret required'
    if (b.foundOnHostId != null && !hostOk(b.foundOnHostId, sc)) return 'foundOnHostId must be a host in the credential network'
    if (b.worksOn !== undefined && (!Array.isArray(b.worksOn) || !b.worksOn.every((s: unknown) => (SERVICES as readonly unknown[]).includes(s)))) return 'worksOn must list known services'
    return null
  }
  app.get<{ Querystring: Record<string, string> }>('/api/credentials', async (req, reply) => {
    const { networkId, boxId, all } = req.query
    if (all === '1') return credentials('', [])
    if (badQuery(networkId, boxId)) return reply.code(400).send({ error: 'invalid id' })
    if ((networkId === undefined) === (boxId === undefined)) return reply.code(400).send({ error: 'networkId, boxId or all=1 required' })
    return networkId !== undefined ? credentials('WHERE c.network_id = ?', [Number(networkId)]) : credentials('WHERE c.box_id = ?', [Number(boxId)])
  })
  app.post<{ Body: Row }>('/api/credentials', async (req, reply) => {
    const b = req.body ?? {}
    const s = scopeFrom(b)
    if (typeof s === 'string') return reply.code(400).send({ error: s })
    const err = checkCred(b, false, s)
    if (err) return reply.code(400).send({ error: err })
    const cid = db
      .prepare(`INSERT INTO credentials (${s.col}, username, kind, secret, found_on_host_id, found_note, works_on) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(s.v, b.username ?? '', b.kind, b.secret, b.foundOnHostId ?? null, b.foundNote ?? '', worksOnJson(b.worksOn) ?? '[]').lastInsertRowid as number
    return reply.code(201).send(credential(cid))
  })
  app.patch<{ Params: { id: string }; Body: Row }>('/api/credentials/:id', async (req, reply) => {
    const cid = Number(req.params.id)
    const cur = credential(cid)
    if (!cur) return reply.code(404).send({ error: 'not found' })
    const b = req.body ?? {}
    const err = checkCred(b, true, toScope(cur.scope))
    if (err) return reply.code(400).send({ error: err })
    patch('credentials', cid, { username: b.username, kind: b.kind, secret: b.secret, found_on_host_id: b.foundOnHostId, found_note: b.foundNote, works_on: worksOnJson(b.worksOn) })
    return credential(cid)
  })
  app.delete('/api/credentials/:id', del('credentials'))
  app.put<{ Params: { id: string; hostId: string }; Body: Row }>('/api/credentials/:id/results/:hostId', async (req, reply) => {
    const cid = Number(req.params.id), hid = Number(req.params.hostId)
    const cur = credential(cid)
    if (!cur) return reply.code(404).send({ error: 'not found' })
    if (!hostOk(hid, toScope(cur.scope))) return reply.code(400).send({ error: 'credential must be network-scoped and host in that network' })
    const result = req.body?.result
    if (result !== null && result !== 'works' && result !== 'failed') return reply.code(400).send({ error: 'result must be works, failed or null' })
    if (result === null) db.prepare('DELETE FROM credential_results WHERE credential_id = ? AND host_id = ?').run(cid, hid)
    else db.prepare('INSERT INTO credential_results (credential_id, host_id, result) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET result = excluded.result').run(cid, hid, result)
    return credential(cid)
  })

  // --- flags ---
  const checkFlag = (b: Row, partial: boolean, sc: Sc): string | null => {
    if (b.label !== undefined && !isStr(b.label)) return 'invalid label'
    if (b.value !== undefined && !isStr(b.value)) return 'invalid value'
    if (sc.col !== 'network_id' && (b.value === undefined ? !partial : !b.value)) return 'value required'
    if (b.hostId != null && !hostOk(b.hostId, sc)) return 'hostId must be a host in the flag network'
    return null
  }
  app.get<{ Querystring: Record<string, string> }>('/api/flags', async (req, reply) => {
    const { networkId, boxId } = req.query
    if ((networkId === undefined) === (boxId === undefined) || badQuery(networkId, boxId)) return reply.code(400).send({ error: 'networkId or boxId required' })
    const rows = db.prepare(`SELECT * FROM flags WHERE ${networkId !== undefined ? 'network_id' : 'box_id'} = ? ORDER BY id`).all(Number(networkId ?? boxId)) as Row[]
    return rows.map(flagOf)
  })
  app.post<{ Body: Row }>('/api/flags', async (req, reply) => {
    const b = req.body ?? {}
    const s = scopeFrom(b)
    if (typeof s === 'string') return reply.code(400).send({ error: s })
    const err = checkFlag(b, false, s)
    if (err) return reply.code(400).send({ error: err })
    const label = (b.label ?? '').trim()
    // An expected flag is a network row with an empty value: capture fills it rather than adding a duplicate.
    const expected = s.col === 'network_id' && b.value
      ? db.prepare("SELECT id FROM flags WHERE network_id = ? AND label = ? AND value = '' ORDER BY id LIMIT 1").get(s.v, label) as { id: number } | undefined
      : undefined
    if (expected) {
      db.prepare("UPDATE flags SET value = ?, host_id = ?, captured_at = datetime('now') WHERE id = ?").run(b.value, b.hostId ?? null, expected.id)
      return reply.code(200).send(flag(expected.id))
    }
    const fid = db.prepare(`INSERT INTO flags (${s.col}, host_id, label, value) VALUES (?, ?, ?, ?)`).run(s.v, b.hostId ?? null, label, b.value ?? '').lastInsertRowid as number
    return reply.code(201).send(flag(fid))
  })
  app.patch<{ Params: { id: string }; Body: Row }>('/api/flags/:id', async (req, reply) => {
    const fid = Number(req.params.id)
    if (!db.prepare('SELECT 1 FROM flags WHERE id = ?').get(fid)) return reply.code(404).send({ error: 'not found' })
    const b = req.body ?? {}
    const err = checkFlag(b, true, toScope(flag(fid).scope))
    if (err) return reply.code(400).send({ error: err })
    const was = (db.prepare('SELECT value FROM flags WHERE id = ?').get(fid) as { value: string }).value
    patch('flags', fid, { label: b.label, value: b.value, host_id: b.hostId })
    if (was === '' && isStr(b.value) && b.value) db.prepare("UPDATE flags SET captured_at = datetime('now') WHERE id = ?").run(fid)
    return flag(fid)
  })
  app.post<{ Body: Row }>('/api/flags/bulk', async (req, reply) => {
    const b = req.body ?? {}
    if (!exists('networks', b.networkId)) return reply.code(400).send({ error: 'networkId required' })
    if (!Array.isArray(b.labels) || !b.labels.every(isStr)) return reply.code(400).send({ error: 'labels must be an array of strings' })
    const have = new Set((db.prepare('SELECT label FROM flags WHERE network_id = ?').all(b.networkId) as { label: string }[]).map((r) => r.label))
    const labels = [...new Set(b.labels.map((l: string) => l.trim()).filter(Boolean))].filter((l) => !have.has(l as string)) as string[]
    if (labels.length > 200) return reply.code(400).send({ error: 'at most 200 labels' })
    const ins = db.prepare("INSERT INTO flags (network_id, host_id, label, value) VALUES (?, NULL, ?, '')")
    const ids = db.transaction(() => labels.map((l) => ins.run(b.networkId, l).lastInsertRowid as number))()
    return reply.code(201).send(ids.map(flag))
  })
  app.delete('/api/flags/:id', del('flags'))

  app.get('/api/loot', async () => credentials('', []))
}
