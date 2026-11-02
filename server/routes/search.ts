import type Database from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import type { SearchHit } from '../../shared/types'

export const searchRoutes: FastifyPluginAsync<{ db: Database.Database }> = async (app, { db }) => {
  // shortcut: snippet/joins computed for every match (~50ms at 5k rows on a 1-letter prefix); cap before snippet past ~20k rows
  const stmt = db.prepare(
    // Match markers are STX/ETX, which never occur in typed text, so real brackets can't fake a highlight.
    // A step's own title is just its phase; prefix the box or host name so hits from different owners are told apart.
    `SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY rank, r) AS rn, COUNT(*) OVER (PARTITION BY kind) AS total FROM (SELECT search_index.rowid AS r, search_index.kind, search_index.ref_id, search_index.box_id,
       CASE search_index.kind WHEN 'host' THEN search_index.ref_id ELSE s.host_id END AS host_id,
       c.tool_id AS tool_id,
       COALESCE(b.name || ' · ', h.name || ' · ', '') || search_index.title AS title,
       snippet(search_index, 4, '\u0002', '\u0003', '…', 12) AS snippet,
       bm25(search_index) AS rank
     FROM search_index LEFT JOIN steps s ON search_index.kind = 'step' AND s.id = search_index.ref_id
       LEFT JOIN boxes b ON b.id = s.box_id LEFT JOIN hosts h ON h.id = s.host_id
       LEFT JOIN commands c ON search_index.kind = 'command' AND c.id = search_index.ref_id
     WHERE search_index MATCH ?)) WHERE rn <= ? ORDER BY rank, r`,
  )
  app.get<{ Querystring: { q?: string | string[]; limit?: string } }>('/api/search', async (req) => {
    const terms = (typeof req.query.q === 'string' ? req.query.q : '').replaceAll('\0', '').split(/\s+/).filter(Boolean).slice(0, 32)
    if (!terms.length) return []
    const match = terms.map((t) => `"${t.replaceAll('"', '""')}"*`).join(' ')
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)
    return (stmt.all(match, limit) as any[]).map((r): SearchHit => ({ kind: r.kind, id: r.ref_id, boxId: r.box_id, hostId: r.host_id, toolId: r.tool_id, title: r.title, snippet: r.snippet, total: r.total }))
  })
}
