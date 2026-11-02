import type Database from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import { STEP_FILLED } from '../report'
import type { Difficulty, Platform, Stats } from '../../shared/types'

const DIFFS: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Insane']
const PLATFORMS: Platform[] = ['HTB', 'THM']

export const statsRoutes: FastifyPluginAsync<{ db: Database.Database }> = async (app, { db }) => {
  const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c
  const grid = (status: string) => {
    const g = Object.fromEntries(PLATFORMS.map((p) => [p, Object.fromEntries(DIFFS.map((d) => [d, 0]))])) as Record<Platform, Record<Difficulty, number>>
    for (const r of db.prepare('SELECT platform, difficulty, count(*) c FROM boxes WHERE status = ? GROUP BY 1, 2').all(status) as any[]) g[r.platform as Platform][r.difficulty as Difficulty] = r.c
    return g
  }
  app.get('/api/stats', async (): Promise<Stats> => {
    const rooted = grid('rooted')
    const total = Object.fromEntries((db.prepare('SELECT platform, count(*) c FROM boxes GROUP BY 1').all() as any[]).map((r) => [r.platform, r.c]))
    return {
      boxes: n('SELECT count(*) c FROM boxes'),
      techniques: n('SELECT count(*) c FROM techniques'),
      tools: n('SELECT count(*) c FROM tools'),
      writeups: n(`SELECT (SELECT count(DISTINCT box_id) FROM steps s WHERE ${STEP_FILLED('s')})
        + (SELECT count(*) FROM networks n WHERE trim(n.notes) <> '' OR EXISTS (SELECT 1 FROM steps s JOIN hosts h ON h.id = s.host_id WHERE h.network_id = n.id AND ${STEP_FILLED('s')})) c`),
      reference: n('SELECT count(*) c FROM reference_pages'),
      networks: n('SELECT count(*) c FROM networks'),
      loot: n('SELECT count(*) c FROM credentials'),
      rooted,
      inProgress: grid('in_progress'),
      totals: Object.fromEntries(PLATFORMS.map((p) => [p, { rooted: Object.values(rooted[p]).reduce((a, b) => a + b, 0), total: total[p] ?? 0 }])) as Stats['totals'],
    }
  })
}
