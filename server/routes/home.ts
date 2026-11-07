import type Database from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import { currentStepId } from '../../shared/steps'
import type { Difficulty, Home, HomeUnfinished, HomeWork, Phase, Platform, Recent, RecentKind, Step } from '../../shared/types'
import { fail, isStr } from '../validate'

type Row = Record<string, any>
const T: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Insane']
const KINDS: RecentKind[] = ['box', 'host', 'network', 'writeup', 'network-writeup', 'reference', 'search']
const DAY = 86_400_000

export function gapTier(r: Record<Difficulty, number>): { difficulty: Difficulty; reason: string } {
  if (r.Easy < 10) return { difficulty: 'Easy', reason: `${r.Easy} Easy rooted so far` }
  const i = T.findIndex((d, k) => k > 0 && r[d] < r[T[k - 1]] / 2)
  const k = i === -1 ? 3 : i
  return { difficulty: T[k], reason: `${r[T[k]]} ${T[k]} rooted against ${r[T[k - 1]]} ${T[k - 1]}` }
}

// `now` is in milliseconds (not seconds like sibling routes): recents need sub-second ordering.
export const homeRoutes: FastifyPluginAsync<{ db: Database.Database; now?: () => number }> = async (app, { db, now = Date.now }) => {
  const iso = (offsetMs = 0) => new Date(now() + offsetMs).toISOString()
  const all = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Row[]
  const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as Row | undefined
  const byRecent = (a: { lastWorked: string | null }, b: { lastWorked: string | null }) =>
    a.lastWorked === b.lastWorked ? 0 : a.lastWorked === null ? 1 : b.lastWorked === null ? -1 : a.lastWorked < b.lastWorked ? 1 : -1

  // Steps of a box or host: the current one, its 1-based number, and when work last happened.
  const progress = (col: 'box_id' | 'host_id', id: number) => {
    const steps = all(`SELECT * FROM steps WHERE ${col} = ? ORDER BY position, id`, id)
    const cur = currentStepId(steps as unknown as Step[])
    const idx = steps.findIndex((s) => s.id === cur)
    return {
      cur: idx < 0 ? null : steps[idx],
      stepNumber: idx < 0 ? null : idx + 1,
      persistence: steps.some((s) => s.phase === 'Persistence'),
      seconds: steps.reduce((a, s) => a + s.seconds, 0),
      updated: steps.reduce<string | null>((m, s) => (s.updated_at && (!m || s.updated_at > m) ? s.updated_at : m), null),
    }
  }
  const workOf = (kind: 'box' | 'host', r: Row): HomeWork => {
    const p = progress(kind === 'box' ? 'box_id' : 'host_id', r.id)
    return {
      kind, id: r.id, name: r.name, status: r.status, platform: r.platform, difficulty: r.difficulty ?? null, os: r.os,
      network: r.network ?? null, totalSeconds: p.seconds, lastWorked: p.updated ?? r.started_at ?? null,
      currentPhase: (p.cur?.phase as Phase) ?? null, persistence: p.persistence, stepNumber: p.stepNumber,
      step: p.cur ? { saw: p.cur.saw, think: p.cur.think, tried: p.cur.tried, got: p.cur.got } : null,
      openThreads: r.next_step,
    }
  }

  const hostTotals = `(SELECT COUNT(*) FROM hosts WHERE network_id = n.id AND status <> 'not_started') AS started,
    (SELECT COUNT(*) FROM hosts WHERE network_id = n.id AND status = 'rooted') AS rooted,
    n.hosts_in_scope AS scope,
    COALESCE(n.hosts_in_scope, (SELECT COUNT(*) FROM hosts WHERE network_id = n.id)) AS total`
  const finished = (n: Row) => n.scope !== null && n.rooted >= n.scope

  app.get('/api/home', async (): Promise<Home> => {
    const ctx = one('SELECT active_box_id, active_host_id FROM context WHERE id = 1')
    let working: HomeWork | null = null
    const box = ctx?.active_box_id ? one(`SELECT * FROM boxes WHERE id = ? AND status <> 'rooted'`, ctx.active_box_id) : undefined
    if (box) working = workOf('box', box)
    else if (ctx?.active_host_id) {
      const h = one(`SELECT h.*, n.name AS network, n.platform FROM hosts h JOIN networks n ON n.id = h.network_id WHERE h.id = ? AND h.status <> 'rooted'`, ctx.active_host_id)
      if (h) working = workOf('host', h)
    }

    const unfinished: HomeUnfinished[] = [
      ...all(`SELECT * FROM boxes WHERE status IN ('in_progress','user_flag')`).filter((b) => !(working?.kind === 'box' && working.id === b.id)).map((b): HomeUnfinished => {
        const w = workOf('box', b)
        return { kind: 'box', id: b.id, name: b.name, platform: b.platform, difficulty: b.difficulty, status: b.status, currentPhase: w.currentPhase, persistence: w.persistence, hosts: null, lastWorked: w.lastWorked }
      }),
      ...all(`SELECT n.*, ${hostTotals}, (SELECT MAX(s.updated_at) FROM steps s JOIN hosts h ON h.id = s.host_id WHERE h.network_id = n.id) AS last
        FROM networks n`).filter((n) => n.started > 0 && !finished(n)).map((n): HomeUnfinished => ({
        kind: 'network', id: n.id, name: n.name, platform: n.platform, difficulty: null, status: null, currentPhase: null, persistence: false,
        hosts: { rooted: n.rooted, total: n.total }, lastWorked: n.last,
      })),
    ].sort(byRecent).slice(0, 5)

    const rooted = Object.fromEntries(T.map((d) => [d, 0])) as Record<Difficulty, number>
    for (const r of all(`SELECT difficulty, COUNT(*) c FROM boxes WHERE status = 'rooted' GROUP BY 1`)) rooted[r.difficulty as Difficulty] = r.c
    const tier = gapTier(rooted)
    const next = {
      ...tier,
      boxes: all(`SELECT id, name, platform, os FROM boxes WHERE status = 'not_started' AND difficulty = ?
        ORDER BY release_date IS NULL, release_date DESC, id DESC LIMIT 3`, tier.difficulty) as { id: number; name: string; platform: Platform; os: string }[],
    }

    const nets = all(`SELECT n.id, n.name, ${hostTotals}, (SELECT COUNT(*) FROM flags WHERE network_id = n.id AND value <> '') AS flags FROM networks n ORDER BY n.id`)
    const started = nets.filter((n) => n.started > 0 && !finished(n))

    const since = iso(-30 * DAY)
    const techniques = all(`SELECT t.id, t.name, COUNT(DISTINCT COALESCE('b' || s.box_id, 'h' || s.host_id)) AS count
      FROM technique_uses u JOIN steps s ON s.id = u.step_id JOIN techniques t ON t.id = u.technique_id
      WHERE s.updated_at >= ? GROUP BY t.id ORDER BY count DESC, t.name LIMIT 5`, since) as Home['techniques']
    const deadEnds = all(`SELECT s.id, s.box_id, s.host_id, s.tried, s.saw, s.body, COALESCE(b.name, h.name) AS owner
      FROM steps s LEFT JOIN boxes b ON b.id = s.box_id LEFT JOIN hosts h ON h.id = s.host_id
      WHERE s.dead = 1 AND s.updated_at >= ? ORDER BY s.updated_at DESC, s.id DESC`, since).map((r) => ({
      stepId: r.id, kind: r.box_id ? 'box' as const : 'host' as const, ownerId: r.box_id ?? r.host_id, owner: r.owner,
      text: ([r.tried, r.saw, r.body].map((t: string) => t.trim()).find(Boolean) ?? '').split('\n')[0].trim().slice(0, 120),
    })).filter((d) => d.text).slice(0, 5)
    const wu = all(`SELECT id, name FROM boxes WHERE status = 'rooted' AND no_writeup = 0 AND (trim(foothold, ' ' || char(9, 10, 11, 12, 13, 160)) = '' OR trim(privesc, ' ' || char(9, 10, 11, 12, 13, 160)) = '') ORDER BY rooted_at DESC, id DESC`)

    return {
      working, unfinished,
      rootedThisWeek: one('SELECT COUNT(*) c FROM boxes WHERE rooted_at >= ?', iso(-7 * DAY))!.c,
      next,
      networks: started.map((n) => ({ id: n.id, name: n.name, hostsRooted: n.rooted, hostsTotal: n.total, flags: n.flags })),
      networksNotStarted: nets.length - started.length,
      techniques, deadEnds,
      writeups: { items: wu.slice(0, 3) as { id: number; name: string }[], more: Math.max(0, wu.length - 3) },
      recents: all(`SELECT kind, ref, label, opened_at AS openedAt FROM recents r WHERE kind <> 'search' AND EXISTS (
        SELECT 1 FROM (
          SELECT 'box' k, id FROM boxes UNION ALL SELECT 'writeup', id FROM boxes UNION ALL SELECT 'host', id FROM hosts
          UNION ALL SELECT 'network', id FROM networks UNION ALL SELECT 'network-writeup', id FROM networks
          UNION ALL SELECT 'reference', id FROM reference_pages) t WHERE t.k = r.kind AND t.id = CAST(r.ref AS INTEGER))
      ORDER BY opened_at DESC, id DESC LIMIT 8`) as Recent[],
      searches: all(`SELECT ref FROM recents WHERE kind = 'search' ORDER BY opened_at DESC, id DESC LIMIT 4`).map((r) => r.ref),
    }
  })

  app.post('/api/recents', async (req, reply) => {
    const b = (req.body ?? {}) as Row
    const kind = KINDS.find((k) => k === b.kind) ?? fail('invalid kind')
    const label = isStr(b.label) ? b.label.trim().slice(0, 200) : ''
    if (!label) fail('invalid label')
    const ref = isStr(b.ref) ? (kind === 'search' ? b.ref.trim() : b.ref) : ''
    if (kind === 'search' ? ref.length < 1 || ref.length > 200 : !/^[1-9]\d{0,11}$/.test(ref)) fail('invalid ref')
    db.transaction(() => {
      db.prepare(`INSERT INTO recents (kind, ref, label, opened_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(kind, ref) DO UPDATE SET label = excluded.label, opened_at = excluded.opened_at`).run(kind, ref, label, iso())
      db.prepare('DELETE FROM recents WHERE id NOT IN (SELECT id FROM recents ORDER BY opened_at DESC, id DESC LIMIT 50)').run()
    })()
    return reply.code(204).send()
  })
}
