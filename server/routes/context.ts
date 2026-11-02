import type { FastifyPluginAsync } from 'fastify'
import type { Database } from 'better-sqlite3'
import type { Context } from '../../shared/types'
import { cidrContains } from '../../shared/cidr'
import { isHostOrEmpty, isPortOrEmpty } from '../validate'

type Body = Partial<{
  target: string; lhost: string; lport: string; activeBoxId: number | null; activeHostId: number | null
}>

export const contextRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const primaryIp = (hostId: number) =>
    (db.prepare('SELECT ip FROM host_ips WHERE host_id = ? ORDER BY is_primary DESC, id LIMIT 1').get(hostId) as
      | { ip: string }
      | undefined)?.ip ?? null

  const read = (): Context => {
    const r = db
      .prepare(
        `SELECT c.lhost, c.lport, c.active_box_id AS activeBoxId, c.active_host_id AS activeHostId,
                c.active_host_ip AS hostIp, b.target_ip AS target
         FROM context c LEFT JOIN boxes b ON b.id = c.active_box_id WHERE c.id = 1`,
      )
      .get() as {
      lhost: string; lport: string; activeBoxId: number | null; activeHostId: number | null
      hostIp: string | null; target: string | null
    }
    const stale =
      r.activeHostId !== null &&
      !db.prepare('SELECT 1 FROM host_ips WHERE host_id = ? AND ip = ?').get(r.activeHostId, r.hostIp)
    const target = (r.activeHostId === null ? r.target : stale ? primaryIp(r.activeHostId) : r.hostIp) ?? ''
    let via: string | null = null
    if (r.activeHostId !== null && target) {
      const pivots = db
        .prepare(
          `SELECT p.method, h.name, s.cidr FROM pivots p JOIN subnets s ON s.id = p.subnet_id
           JOIN hosts h ON h.id = p.from_host_id
           WHERE s.network_id = (SELECT network_id FROM hosts WHERE id = ?) AND p.from_host_id <> ? ORDER BY p.id`,
        )
        .all(r.activeHostId, r.activeHostId) as { method: string; name: string; cidr: string }[]
      // Most specific subnet wins (longest prefix); the stable sort keeps the lowest pivot id among equals.
      const prefix = (cidr: string) => Number(cidr.split('/')[1])
      const hit = pivots.filter((p) => cidrContains(p.cidr, target)).sort((a, b) => prefix(b.cidr) - prefix(a.cidr))[0]
      if (hit) via = `via ${hit.method} through ${hit.name}`
    }
    return { target, lhost: r.lhost, lport: r.lport, activeBoxId: r.activeBoxId, activeHostId: r.activeHostId, via }
  }

  app.get('/api/context', async () => read())

  app.put<{ Body: Body }>('/api/context', async (req, reply) => {
    const b = req.body ?? {}
    const bad = (error: string) => reply.code(400).send({ error })
    if (b.target !== undefined && !isHostOrEmpty(b.target)) return bad('invalid target')
    if (b.lhost !== undefined && !isHostOrEmpty(b.lhost)) return bad('invalid lhost')
    if (b.lport !== undefined && !isPortOrEmpty(b.lport)) return bad('LPORT must be 1-65535')
    if (b.activeBoxId !== undefined && b.activeBoxId !== null) {
      if (!Number.isInteger(b.activeBoxId) || !db.prepare('SELECT 1 FROM boxes WHERE id = ?').get(b.activeBoxId))
        return bad('unknown box')
    }
    if (b.activeHostId !== undefined && b.activeHostId !== null) {
      if (!Number.isInteger(b.activeHostId) || !db.prepare('SELECT 1 FROM hosts WHERE id = ?').get(b.activeHostId))
        return bad('unknown host')
      if (b.activeBoxId) return bad('pick a box or a host, not both')
    }
    const cur = read()
    // picking one clears the other
    const activeHostId = b.activeHostId !== undefined ? b.activeHostId : b.activeBoxId ? null : cur.activeHostId
    const activeBoxId = b.activeBoxId !== undefined ? b.activeBoxId : b.activeHostId ? null : cur.activeBoxId
    let hostIp: string | null = null
    if (activeHostId !== null) {
      // Clearing TARGET on a host means "back to its primary IP", the host-mode analogue of clearing a box's IP.
      if (b.target === '') hostIp = primaryIp(activeHostId)
      else if (b.target !== undefined) {
        if (!db.prepare('SELECT 1 FROM host_ips WHERE host_id = ? AND ip = ?').get(activeHostId, b.target))
          return bad('target is not an IP of this host')
        hostIp = b.target
      } else hostIp = activeHostId === cur.activeHostId ? cur.target || primaryIp(activeHostId) : primaryIp(activeHostId)
    } else if (b.target !== undefined && activeBoxId === null) return bad('no active box')
    db.transaction(() => {
      if (b.activeBoxId !== undefined || b.activeHostId !== undefined)
        db.prepare('UPDATE context SET active_box_id = ?, active_host_id = ? WHERE id = 1').run(activeBoxId, activeHostId)
      db.prepare('UPDATE context SET active_host_ip = ? WHERE id = 1').run(hostIp)
      if (b.lhost !== undefined) db.prepare('UPDATE context SET lhost = ? WHERE id = 1').run(b.lhost)
      if (b.lport !== undefined) db.prepare('UPDATE context SET lport = ? WHERE id = 1').run(b.lport)
      if (b.target !== undefined && activeHostId === null)
        db.prepare('UPDATE boxes SET target_ip = ? WHERE id = ?').run(b.target || null, activeBoxId)
    })()
    return read()
  })
}
