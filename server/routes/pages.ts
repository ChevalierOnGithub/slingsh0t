import type { FastifyPluginAsync } from 'fastify'
import type Database from 'better-sqlite3'
import { fail, isId, isStr } from '../validate'
import { STEP_FILLED, localDay, networkReportOf, reportOf } from '../report'
import { zipStore } from '../zip'
import { fileSlug } from '../../shared/slug'
import { nextShortId } from '../ids'
import { cmd, shelf, shelfInput } from './library'
import { APPLIES, INTENTS, PHASES } from '../../shared/types'
import type { ReferencePage, TechniqueListItem, ToolListItem, UnsortedItem, WriteupListItem } from '../../shared/types'

const nonEmpty = (v: unknown): v is string => isStr(v) && v.trim() !== ''
const page = (r: any): ReferencePage => ({ id: r.id, title: r.title, body: r.body })
const isIntent = (v: unknown) => v === '' || (INTENTS as readonly unknown[]).includes(v)

// Boxes need a filled step; networks need a filled host step or notes. Boxes carry no updated_at, so latest of rooted/started/created stands in.
const writeupList = (db: Database.Database): WriteupListItem[] => {
  const boxes = db.prepare(`
    SELECT 'box' AS kind, b.id AS id, b.short_id AS shortId, b.name, b.platform, b.status,
      SUM(${STEP_FILLED('s')}) AS filledSteps, COUNT(s.id) AS totalSteps,
      COALESCE(b.rooted_at, b.started_at, b.created_at) AS updatedAt
    FROM boxes b JOIN steps s ON s.box_id = b.id GROUP BY b.id
    HAVING filledSteps > 0 ORDER BY datetime(updatedAt) DESC, b.id DESC`).all() as WriteupListItem[]
  const nets = (db.prepare(`
    SELECT * FROM (
      SELECT 'network' AS kind, n.id, n.short_id AS shortId, n.name, n.platform, n.notes,
        (SELECT COUNT(*) FROM hosts WHERE network_id = n.id) AS hosts,
        (SELECT COUNT(*) FROM hosts WHERE network_id = n.id AND status = 'rooted') AS owned,
        (SELECT COUNT(*) FROM steps s JOIN hosts h ON h.id = s.host_id WHERE h.network_id = n.id AND ${STEP_FILLED('s')}) AS filledSteps,
        (SELECT COUNT(*) FROM steps s JOIN hosts h ON h.id = s.host_id WHERE h.network_id = n.id) AS totalSteps,
        MAX(datetime(n.created_at),
            COALESCE((SELECT MAX(datetime(created_at)) FROM hosts WHERE network_id = n.id), ''),
            COALESCE((SELECT MAX(datetime(captured_at)) FROM flags WHERE network_id = n.id AND value <> ''), '')) AS updatedAt
      FROM networks n)
      WHERE filledSteps > 0 OR trim(notes) <> '' ORDER BY datetime(updatedAt) DESC, id DESC`).all() as any[])
      .map(({ hosts, owned, notes, ...r }): WriteupListItem => ({ ...r, status: `${owned}/${hosts} hosts` }))
  return [...boxes, ...nets]
}

export const pagesRoutes: FastifyPluginAsync<{ db: Database.Database }> = async (app, { db }) => {
  const idOf = (req: any) => Number(req.params.id)
  const bad = (reply: any, error: string) => reply.code(400).send({ error })
  const gone = (reply: any, what: string) => reply.code(404).send({ error: `${what} not found` })

  const techniqueItems = (where = '', ...params: unknown[]) => {
    // ordinal = 1-based position among the owner's (box or host) steps of the same phase; id breaks a position tie
    const uses = db.prepare(`
      SELECT u.technique_id, s.box_id, s.host_id, COALESCE(b.name, h.name) AS owner_name, s.id AS step_id, s.phase, s.dead,
        (SELECT COUNT(*) FROM steps s2 WHERE (s2.box_id = s.box_id OR s2.host_id = s.host_id) AND s2.phase = s.phase
          AND (s2.position < s.position OR (s2.position = s.position AND s2.id <= s.id))) AS ordinal
      FROM technique_uses u JOIN steps s ON s.id = u.step_id LEFT JOIN boxes b ON b.id = s.box_id LEFT JOIN hosts h ON h.id = s.host_id
      ORDER BY owner_name, s.position`).all() as any[]
    const cmds = db.prepare('SELECT * FROM commands WHERE technique_id = ? AND tool_id IS NULL ORDER BY position IS NULL, position, id')
    const tools = db.prepare('SELECT t.id, t.name FROM technique_tools tt JOIN tools t ON t.id = tt.tool_id WHERE tt.technique_id = ? ORDER BY t.name COLLATE NOCASE')
    return (db.prepare(`SELECT * FROM techniques ${where} ORDER BY phase, position, name COLLATE NOCASE`).all(...params) as any[]).map((t): TechniqueListItem => ({
      id: t.id, shortId: t.short_id, name: t.name, phase: t.phase, description: t.description, position: t.position, applies: t.applies, ...shelf(t),
      commands: cmds.all(t.id).map(cmd), tools: tools.all(t.id) as { id: number; name: string }[],
      uses: uses.filter(u => u.technique_id === t.id)
        .map(u => ({ boxId: u.box_id, hostId: u.host_id, ownerName: u.owner_name, stepId: u.step_id, phase: u.phase, ordinal: u.ordinal, dead: !!u.dead })),
    }))
  }
  app.get('/api/techniques', async () => techniqueItems())

  app.patch('/api/techniques/:id', async (req, reply) => {
    const id = idOf(req)
    const { name, description, phase, applies } = (req.body ?? {}) as any
    if (!isId(id)) return bad(reply, 'invalid id')
    if (name !== undefined && !nonEmpty(name)) return bad(reply, 'name must be a non-empty string')
    if (description !== undefined && !isStr(description)) return bad(reply, 'description must be a string')
    if (phase !== undefined && !PHASES.includes(phase)) return bad(reply, 'invalid phase')
    if (applies !== undefined && !APPLIES.includes(applies)) return bad(reply, 'invalid applies')
    const s = shelfInput(req.body ?? {})
    const r = db.transaction(() => {
      const cur = db.prepare('SELECT phase FROM techniques WHERE id = ?').get(id) as any
      if (!cur) return undefined
      // a phase change appends it to the new phase; the old phase keeps its gap
      const position = phase !== undefined && phase !== cur.phase
        ? (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM techniques WHERE phase = ?').get(phase) as any).n : null
      return db.prepare(`UPDATE techniques SET name = COALESCE(?, name), description = COALESCE(?, description), phase = COALESCE(?, phase), applies = COALESCE(?, applies), position = COALESCE(?, position),
        service = COALESCE(?, service), needs = COALESCE(?, needs), yields = COALESCE(?, yields) WHERE id = ? RETURNING *`)
        .get(name?.trim() ?? null, description ?? null, phase ?? null, applies ?? null, position, s.service, s.needs, s.yields, id) as any
    })()
    return r ? { id: r.id, shortId: r.short_id, name: r.name, phase: r.phase, description: r.description, position: r.position, applies: r.applies, ...shelf(r) } : gone(reply, 'technique')
  })

  // ids must be exactly one phase's techniques; they become positions 1..n in list order
  app.put('/api/techniques/order', async (req, reply) => {
    const { ids } = (req.body ?? {}) as any
    if (!Array.isArray(ids) || !ids.length || !ids.every(isId)) return bad(reply, 'ids must be a non-empty array of technique ids')
    return db.transaction(() => {
      const rows = db.prepare(`SELECT phase FROM techniques WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as any[]
      const phase = rows[0]?.phase ?? null
      // a duplicate or unknown id shortens rows; a partial list fails the phase count
      if (rows.length !== ids.length || rows.some(r => r.phase !== phase)
        || (db.prepare('SELECT COUNT(*) AS n FROM techniques WHERE phase = ?').get(phase) as any).n !== ids.length)
        fail('ids must be exactly the techniques of one phase')
      const up = db.prepare('UPDATE techniques SET position = ? WHERE id = ?')
      ids.forEach((tid: number, i: number) => up.run(i + 1, tid))
      return techniqueItems('WHERE phase = ?', phase)
    })()
  })

  app.get('/api/tools', async () => {
    const cmds = db.prepare('SELECT * FROM commands WHERE tool_id IS NOT NULL ORDER BY position, id').all() as any[]
    const techs = db.prepare('SELECT tt.tool_id, t.id, t.name FROM technique_tools tt JOIN techniques t ON t.id = tt.technique_id ORDER BY t.name COLLATE NOCASE').all() as any[]
    return (db.prepare('SELECT * FROM tools ORDER BY name COLLATE NOCASE').all() as any[]).map((t): ToolListItem => ({
      id: t.id, shortId: t.short_id, name: t.name, description: t.description,
      commands: cmds.filter(c => c.tool_id === t.id).map(cmd),
      techniques: techs.filter(x => x.tool_id === t.id).map(x => ({ id: x.id, name: x.name })),
    }))
  })

  app.post('/api/tools', async (req, reply) => {
    const { name, description } = (req.body ?? {}) as any
    if (!nonEmpty(name)) return bad(reply, 'name required')
    if (description !== undefined && !isStr(description)) return bad(reply, 'description must be a string')
    if (db.prepare('SELECT 1 FROM tools WHERE name = ?').get(name.trim())) return reply.code(409).send({ error: `a tool named ${name.trim()} already exists` })
    const r = db.prepare('INSERT INTO tools (short_id, name, description) VALUES (?, ?, ?) RETURNING *').get(nextShortId(db, 'TL'), name.trim(), description?.trim() ?? '') as any
    const tool: ToolListItem = { id: r.id, shortId: r.short_id, name: r.name, description: r.description, commands: [], techniques: [] }
    return reply.code(201).send(tool)
  })

  // A tool's commands, or a technique's own (tool-less) commands.
  for (const [owner, col] of [['tool', 'tool_id'], ['technique', 'technique_id']] as const)
    app.post(`/api/${owner}s/:id/commands`, async (req, reply) => {
      const id = idOf(req)
      const { purpose, template, intent } = (req.body ?? {}) as any
      if (!isId(id)) return bad(reply, 'invalid id')
      if (!isStr(purpose) || !nonEmpty(template)) return bad(reply, 'purpose and template required')
      if (intent !== undefined && !isIntent(intent)) return bad(reply, 'invalid intent')
      if (!db.prepare(`SELECT 1 FROM ${owner}s WHERE id = ?`).get(id)) return gone(reply, owner)
      return reply.code(201).send(cmd(db.prepare(`INSERT INTO commands (${col}, purpose, template, intent) VALUES (?, ?, ?, ?) RETURNING *`).get(id, purpose, template, intent ?? '')))
    })

  // Linking a tool puts its commands under the technique in every box's toolbox.
  app.put('/api/techniques/:id/tools/:toolId', async (req, reply) => {
    const id = idOf(req), toolId = Number((req.params as any).toolId)
    if (!isId(id) || !isId(toolId)) return bad(reply, 'invalid id')
    if (!db.prepare('SELECT 1 FROM techniques WHERE id = ?').get(id)) return gone(reply, 'technique')
    if (!db.prepare('SELECT 1 FROM tools WHERE id = ?').get(toolId)) return gone(reply, 'tool')
    db.prepare('INSERT INTO technique_tools (technique_id, tool_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(id, toolId)
    return reply.code(204).send()
  })
  app.delete('/api/techniques/:id/tools/:toolId', async (req, reply) => {
    const id = idOf(req), toolId = Number((req.params as any).toolId)
    if (!isId(id) || !isId(toolId)) return bad(reply, 'invalid id')
    db.prepare('DELETE FROM technique_tools WHERE technique_id = ? AND tool_id = ?').run(id, toolId)
    return reply.code(204).send()
  })

  app.patch('/api/commands/:id', async (req, reply) => {
    const id = idOf(req)
    const { purpose, template, intent } = (req.body ?? {}) as any
    if (!isId(id)) return bad(reply, 'invalid id')
    if (purpose !== undefined && !isStr(purpose)) return bad(reply, 'purpose must be a string')
    if (template !== undefined && !nonEmpty(template)) return bad(reply, 'template must be a non-empty string')
    if (intent !== undefined && !isIntent(intent)) return bad(reply, 'invalid intent')
    const r = db.prepare('UPDATE commands SET purpose = COALESCE(?, purpose), template = COALESCE(?, template), intent = COALESCE(?, intent) WHERE id = ? RETURNING *')
      .get(purpose ?? null, template ?? null, intent ?? null, id)
    return r ? cmd(r) : gone(reply, 'command')
  })

  app.delete('/api/commands/:id', async (req, reply) => {
    const id = idOf(req)
    if (!isId(id)) return bad(reply, 'invalid id')
    const deleted = db.prepare('DELETE FROM commands WHERE id = ?').run(id).changes
    if (!deleted) return gone(reply, 'command')
    return reply.code(204).send()
  })

  app.get('/api/writeups', async () => writeupList(db))

  app.get('/api/export/writeups.zip', async (_req, reply) => {
    const today = localDay(new Date())
    const files = writeupList(db).map((w) => {
      const doc = w.kind === 'box' ? reportOf(db, { col: 'box_id', id: w.id }, today) : networkReportOf(db, w.id, today)
      return { name: `${w.kind === 'box' ? 'boxes' : 'networks'}/${w.shortId}-${fileSlug(w.name)}.md`, data: `---\n${doc.frontmatter}\n---\n\n${doc.markdown}` }
    })
    return reply.type('application/zip').header('content-disposition', `attachment; filename="slingsh0t-writeups-${today.replaceAll('-', '')}.zip"`).send(zipStore(files))
  })

  app.get('/api/reference', async () => (db.prepare('SELECT * FROM reference_pages ORDER BY title COLLATE NOCASE').all() as any[]).map(page))

  app.get('/api/reference/:id', async (req, reply) => {
    const id = idOf(req)
    if (!isId(id)) return bad(reply, 'invalid id')
    const r = db.prepare('SELECT * FROM reference_pages WHERE id = ?').get(id)
    return r ? page(r) : gone(reply, 'reference page')
  })

  app.post('/api/reference', async (req, reply) => {
    const { title, body } = (req.body ?? {}) as any
    if (!nonEmpty(title) || !isStr(body)) return bad(reply, 'title and body required')
    return reply.code(201).send(page(db.prepare('INSERT INTO reference_pages (title, body) VALUES (?, ?) RETURNING *').get(title.trim(), body)))
  })

  app.put('/api/reference/:id', async (req, reply) => {
    const id = idOf(req)
    const { title, body } = (req.body ?? {}) as any
    if (!isId(id)) return bad(reply, 'invalid id')
    if (!nonEmpty(title) || !isStr(body)) return bad(reply, 'title and body required')
    const r = db.prepare('UPDATE reference_pages SET title = ?, body = ? WHERE id = ? RETURNING *').get(title.trim(), body, id)
    return r ? page(r) : gone(reply, 'reference page')
  })

  app.get('/api/unsorted', async () => (db.prepare('SELECT * FROM unsorted ORDER BY id').all() as any[])
    .map((r): UnsortedItem => ({ id: r.id, sourcePage: r.source_page, content: r.content })))

  app.delete('/api/unsorted/:id', async (req, reply) => {
    const id = idOf(req)
    if (!isId(id)) return bad(reply, 'invalid id')
    const deleted = db.prepare('DELETE FROM unsorted WHERE id = ?').run(id).changes
    if (!deleted) return gone(reply, 'unsorted item')
    return reply.code(204).send()
  })
}
