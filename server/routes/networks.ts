import type Database from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import type { NetworkDetail, NetworkSummary } from '../../shared/types'
import { updateRow } from '../db'
import { nextShortId } from '../ids'
import { PRESETS } from '../presets'
import { hostIps, localDay, networkReportOf } from '../report'
import { fail, isHostOrEmpty, isStr, isTags, isUrlOrEmpty } from '../validate'
import { addDefaultSteps, checkAdRemoval, hostDetail, markRooted, ownerSet } from './boxes'

type Row = Record<string, any>
const PLATFORMS = ['HTB', 'THM', 'Other']
const isCount = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0)
const isIp = (v: unknown): v is string => isStr(v) && v !== '' && isHostOrEmpty(v)

const SUMMARY = `SELECT n.*,
  (SELECT COUNT(*) FROM hosts WHERE network_id = n.id) AS hosts_found,
  (SELECT COUNT(*) FROM hosts WHERE network_id = n.id AND status = 'rooted') AS hosts_owned,
  (SELECT COUNT(*) FROM flags WHERE network_id = n.id AND value <> '') AS flags_captured,
  (SELECT COUNT(*) FROM credentials WHERE network_id = n.id) AS credentials
  FROM networks n`
const toSummary = (r: Row): NetworkSummary => ({
  id: r.id, shortId: r.short_id, platform: r.platform, name: r.name, hostsInScope: r.hosts_in_scope, flagsInScope: r.flags_in_scope, url: r.url,
  hostsFound: r.hosts_found, hostsOwned: r.hosts_owned, flagsCaptured: r.flags_captured, credentials: r.credentials,
})

export const networksRoutes: FastifyPluginAsync<{ db: Database.Database; now?: () => number }> = async (app, { db, now = () => (Date.now() / 1000) | 0 }) => {
  const tx = <T>(f: () => T): T => db.transaction(f)()
  const id = (p: unknown, k = 'id') => Number((p as Row)[k])

  const detail = (nid: number): NetworkDetail => {
    const r = (db.prepare(`${SUMMARY} WHERE n.id = ?`).get(nid) as Row) ?? fail('network not found', 404)
    const hosts = (db.prepare('SELECT * FROM hosts WHERE network_id = ? ORDER BY id').all(nid) as Row[]).map((h) => ({
      id: h.id, shortId: h.short_id, name: h.name, os: h.os, status: h.status, ips: hostIps(db, h.id),
    }))
    const subnets = db.prepare('SELECT id, cidr FROM subnets WHERE network_id = ? ORDER BY id').all(nid) as NetworkDetail['subnets']
    const pivots = db.prepare(`SELECT p.id, p.from_host_id AS fromHostId, p.subnet_id AS subnetId, p.method, p.note
      FROM pivots p JOIN subnets s ON s.id = p.subnet_id WHERE s.network_id = ? ORDER BY p.id`).all(nid) as NetworkDetail['pivots']
    return { ...toSummary(r), tags: JSON.parse(r.tags), notes: r.notes, entry: r.entry, hosts, subnets, pivots }
  }

  // Shared by POST and PATCH; `partial` skips the required-field checks.
  const networkFields = (b: Row, partial: boolean) => {
    const set: Record<string, unknown> = {}
    if (b.name !== undefined || !partial) {
      const name = isStr(b.name) ? b.name.trim() : ''
      set.name = name || fail('name required')
    }
    if (b.platform !== undefined || !partial) set.platform = PLATFORMS.includes(b.platform) ? b.platform : fail('invalid platform')
    if (b.hostsInScope !== undefined) set.hosts_in_scope = isCount(b.hostsInScope) ? b.hostsInScope : fail('invalid hostsInScope')
    if (b.flagsInScope !== undefined) set.flags_in_scope = isCount(b.flagsInScope) ? b.flagsInScope : fail('invalid flagsInScope')
    if (b.tags !== undefined) set.tags = isTags(b.tags) ? JSON.stringify(b.tags) : fail('invalid tags')
    if (b.notes !== undefined) set.notes = isStr(b.notes) ? b.notes : fail('invalid notes')
    if (b.entry !== undefined) set.entry = isStr(b.entry) ? b.entry : fail('invalid entry')
    if (b.url !== undefined) set.url = isUrlOrEmpty(b.url) ? b.url : fail('invalid url')
    return set
  }

  app.get('/api/networks', async () => (db.prepare(`${SUMMARY} ORDER BY n.created_at DESC, n.id DESC`).all() as Row[]).map(toSummary))

  app.post('/api/networks', async (req, reply) => {
    const b = (req.body ?? {}) as Row
    const set = networkFields(b, false)
    // A preset-made network carries the preset id as source_id, so the import recognises it.
    const preset = b.presetId === undefined ? undefined : PRESETS.find((p) => p.id === b.presetId) ?? fail('unknown preset')
    if (preset) set.url ??= preset.url
    const nid = tx(() => {
      if (preset && db.prepare('SELECT 1 FROM networks WHERE source_id = ?').get(preset.id)) fail('this lab is already in your networks', 409)
      const row = { ...set, ...(preset && { source_id: preset.id }), short_id: nextShortId(db, 'N') }
      const cols = Object.keys(row)
      return Number(db.prepare(`INSERT INTO networks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(row)).lastInsertRowid)
    })
    return reply.code(201).send(detail(nid))
  })

  app.get('/api/networks/:id', async (req) => detail(id(req.params)))

  app.get('/api/networks/:id/report', async (req) => networkReportOf(db, id(req.params), localDay(new Date(now() * 1000))))

  app.patch('/api/networks/:id', async (req) => {
    const nid = id(req.params)
    const set = networkFields((req.body ?? {}) as Row, true)
    return tx(() => {
      detail(nid)
      if (set.tags !== undefined) checkAdRemoval(db, JSON.parse(set.tags as string),
        "SELECT 1 FROM steps s JOIN hosts h ON h.id = s.host_id WHERE h.network_id = ? AND s.phase = 'Persistence'", nid)
      updateRow(db, 'networks', nid, set)
      return detail(nid)
    })
  })

  app.delete('/api/networks/:id', async (req, reply) => {
    if (!db.prepare('DELETE FROM networks WHERE id = ?').run(id(req.params)).changes) fail('network not found', 404)
    return reply.code(204).send()
  })

  app.post('/api/networks/:id/hosts', async (req, reply) => {
    const nid = id(req.params)
    const b = (req.body ?? {}) as Row
    const name = isStr(b.name) ? b.name.trim() : ''
    if (!name) fail('name required')
    if (b.os !== undefined && !isStr(b.os)) fail('invalid os')
    if (!Array.isArray(b.ips) || !b.ips.length || !b.ips.every(isIp)) fail('ips must be a non-empty array of IPs or hostnames')
    if (new Set(b.ips).size !== b.ips.length) fail('duplicate ip')
    const hid = tx(() => {
      const net = (db.prepare('SELECT tags FROM networks WHERE id = ?').get(nid) as Row) ?? fail('network not found', 404)
      const hid = Number(db.prepare('INSERT INTO hosts (short_id, network_id, name, os) VALUES (?, ?, ?, ?)')
        .run(nextShortId(db, 'HS'), nid, name, b.os ?? '').lastInsertRowid)
      const ins = db.prepare('INSERT INTO host_ips (host_id, ip, is_primary) VALUES (?, ?, ?)')
      b.ips.forEach((ip: string, i: number) => ins.run(hid, ip, i === 0 ? 1 : 0))
      addDefaultSteps(db, { col: 'host_id', id: hid }, JSON.parse(net.tags), now())
      return hid
    })
    return reply.code(201).send(hostDetail(db, hid))
  })

  app.get('/api/hosts/:id', async (req) => hostDetail(db, id(req.params)))

  app.patch('/api/hosts/:id', async (req) => {
    const hid = id(req.params)
    const b = (req.body ?? {}) as Row
    const set = ownerSet(b)
    return tx(() => {
      hostDetail(db, hid)
      if (b.status === 'rooted') markRooted(db, { col: 'host_id', id: hid })
      updateRow(db, 'hosts', hid, set)
      return hostDetail(db, hid)
    })
  })

  app.delete('/api/hosts/:id', async (req, reply) => {
    if (!db.prepare('DELETE FROM hosts WHERE id = ?').run(id(req.params)).changes) fail('host not found', 404)
    return reply.code(204).send()
  })

  app.post('/api/hosts/:id/ips', async (req, reply) => {
    const hid = id(req.params)
    const { ip, primary } = (req.body ?? {}) as Row
    if (!isIp(ip)) fail('invalid ip')
    if (primary !== undefined && typeof primary !== 'boolean') fail('invalid primary')
    return reply.code(201).send(tx(() => {
      const h = hostDetail(db, hid)
      if (h.ips.some((i) => i.ip === ip)) fail('ip already on host', 409)
      const makePrimary = primary === true || !h.ips.length
      if (makePrimary) db.prepare('UPDATE host_ips SET is_primary = 0 WHERE host_id = ?').run(hid)
      db.prepare('INSERT INTO host_ips (host_id, ip, is_primary) VALUES (?, ?, ?)').run(hid, ip, makePrimary ? 1 : 0)
      return hostDetail(db, hid)
    }))
  })

  app.delete('/api/hosts/:id/ips/:ipId', async (req) => {
    const hid = id(req.params)
    return tx(() => {
      const row = (db.prepare('SELECT * FROM host_ips WHERE id = ? AND host_id = ?').get(id(req.params, 'ipId'), hid) as Row) ?? fail('ip not found', 404)
      // Spec: a host has one or more IPs; add the new one before removing the last.
      if ((db.prepare('SELECT COUNT(*) AS n FROM host_ips WHERE host_id = ?').get(hid) as Row).n <= 1) fail('a host keeps at least one IP')
      db.prepare('DELETE FROM host_ips WHERE id = ?').run(row.id)
      // Keep a primary while any IP remains: promote the oldest.
      if (row.is_primary) db.prepare('UPDATE host_ips SET is_primary = 1 WHERE id = (SELECT MIN(id) FROM host_ips WHERE host_id = ?)').run(hid)
      return hostDetail(db, hid)
    })
  })
}
