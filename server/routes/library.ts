import type { FastifyPluginAsync } from 'fastify'
import type Database from 'better-sqlite3'
import { nextShortId } from '../ids'
import { fail, isHaves, isId, isSlug } from '../validate'
import { AD_TAG, PHASES } from '../../shared/types'
import type { Command, Have, Phase, TechniqueNode, TechniqueUse, Toolbox } from '../../shared/types'

export const cmd = (r: any): Command => ({ id: r.id, purpose: r.purpose, template: r.template, procedureKey: r.procedure_key, position: r.position, intent: r.intent })
/** A technique row's shelf fields; every technique mapper spreads this. */
export const shelf = (r: any) => ({ service: r.service as string, needs: JSON.parse(r.needs) as Have[], yields: JSON.parse(r.yields) as Have[] })
/** Validates a body's service/needs/yields (each optional); returns the column values to write, deduped. */
export const shelfInput = (b: any) => {
  if (b.service !== undefined && !isSlug(b.service)) fail('service must be a lowercase slug')
  if (b.needs !== undefined && !isHaves(b.needs)) fail('invalid needs')
  if (b.yields !== undefined && !isHaves(b.yields)) fail('invalid yields')
  const json = (v: Have[] | undefined) => (v === undefined ? null : JSON.stringify([...new Set(v)]))
  return { service: (b.service as string | undefined) ?? null, needs: json(b.needs), yields: json(b.yields) }
}
export const useOf = (r: any): TechniqueUse => ({ id: r.id, techniqueId: r.technique_id, stepId: r.step_id, toolIds: r.tool_ids ? JSON.parse(r.tool_ids) : null })

export const libraryRoutes: FastifyPluginAsync<{ db: Database.Database }> = async (app, { db }) => {
  const ORDER = 'ORDER BY procedure_key, position, id'

  app.get('/api/toolbox', async (req, reply) => {
    const q = req.query as any
    if (q.hostId !== undefined && q.boxId !== undefined) return reply.code(400).send({ error: 'pass boxId or hostId, not both' })
    // A host has no tags of its own: it uses its network's.
    const [col, sql] = q.hostId !== undefined
      ? ['host_id', 'SELECT h.status, n.tags FROM hosts h JOIN networks n ON n.id = h.network_id WHERE h.id = ?']
      : ['box_id', 'SELECT status, tags FROM boxes WHERE id = ?']
    const ownerId = Number(q.hostId ?? q.boxId)
    if (!isId(ownerId)) return reply.code(400).send({ error: 'boxId or hostId must be a positive integer' })
    const owner = db.prepare(sql).get(ownerId) as { status: string; tags: string } | undefined
    if (!owner) return reply.code(404).send({ error: `${col === 'box_id' ? 'box' : 'host'} not found` })
    const rooted = owner.status === 'rooted'
    const isAd = (JSON.parse(owner.tags) as string[]).includes(AD_TAG)

    const uses = db.prepare(`SELECT u.* FROM technique_uses u JOIN steps s ON s.id = u.step_id WHERE s.${col} = ? ORDER BY u.id`).all(ownerId).map(useOf)
    const techs = db.prepare('SELECT * FROM techniques ORDER BY phase, position, name COLLATE NOCASE').all() as any[]
    const toolsOf = db.prepare('SELECT t.* FROM technique_tools tt JOIN tools t ON t.id = tt.tool_id WHERE tt.technique_id = ? ORDER BY t.name COLLATE NOCASE')
    const techCmds = db.prepare(`SELECT * FROM commands WHERE technique_id = ? AND tool_id IS NULL ${ORDER}`)
    const toolCmds = db.prepare(`SELECT * FROM commands WHERE tool_id = ? AND (technique_id = ? OR technique_id IS NULL) ${ORDER}`)

    const nodes: TechniqueNode[] = []
    for (const t of techs) {
      const tUses = uses.filter(u => u.techniqueId === t.id)
      if (rooted && !tUses.length) continue
      // A use with no tool list means "all tools"; otherwise a rooted box keeps the union of the tools its uses name.
      const allowed = !rooted || tUses.some(u => !u.toolIds) ? null : tUses.flatMap(u => u.toolIds!)
      nodes.push({
        id: t.id, shortId: t.short_id, name: t.name, phase: t.phase, description: t.description, position: t.position, applies: t.applies, ...shelf(t),
        commands: techCmds.all(t.id).map(cmd),
        tools: (toolsOf.all(t.id) as any[])
          .filter(tl => !allowed || allowed.includes(tl.id))
          .map(tl => ({ id: tl.id, shortId: tl.short_id, name: tl.name, commands: toolCmds.all(tl.id, t.id).map(cmd) })),
        uses: tUses,
      })
    }
    const body: Toolbox = {
      phases: PHASES.filter(p => isAd || p !== 'Persistence')
        .map(phase => ({ phase, techniques: nodes.filter(n => n.phase === phase) }))
        .filter(p => !rooted || p.techniques.length),
    }
    return body
  })

  app.post('/api/technique-uses', async (req, reply) => {
    const { techniqueId, stepId, toolIds } = (req.body ?? {}) as any
    if (!isId(techniqueId) || !isId(stepId) || (toolIds !== undefined && !(Array.isArray(toolIds) && toolIds.every(isId))))
      return reply.code(400).send({ error: 'techniqueId, stepId must be positive integers; toolIds an array of them' })
    if (!db.prepare('SELECT 1 FROM techniques WHERE id = ?').get(techniqueId)) return reply.code(404).send({ error: 'technique not found' })
    if (!db.prepare('SELECT 1 FROM steps WHERE id = ?').get(stepId)) return reply.code(404).send({ error: 'step not found' })
    const linked = db.prepare('SELECT 1 FROM technique_tools WHERE technique_id = ? AND tool_id = ?')
    if (toolIds?.some((t: number) => !linked.get(techniqueId, t))) return reply.code(400).send({ error: 'toolIds must be tools of this technique' })
    if (db.prepare('SELECT 1 FROM technique_uses WHERE technique_id = ? AND step_id = ?').get(techniqueId, stepId))
      return reply.code(409).send({ error: 'technique already used on this step' })
    const row = db.prepare('INSERT INTO technique_uses (technique_id, step_id, tool_ids) VALUES (?, ?, ?) RETURNING *')
      .get(techniqueId, stepId, toolIds ? JSON.stringify(toolIds) : null)
    return reply.code(201).send(useOf(row))
  })

  app.delete('/api/technique-uses/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!isId(id)) return reply.code(400).send({ error: 'invalid id' })
    if (!db.prepare('DELETE FROM technique_uses WHERE id = ?').run(id).changes) fail('technique use not found', 404)
    return reply.code(204).send()
  })

  app.post('/api/techniques', async (req, reply) => {
    const { name, phase, description } = (req.body ?? {}) as any
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name required' })
    if (!PHASES.includes(phase)) return reply.code(400).send({ error: 'invalid phase' })
    if (description !== undefined && typeof description !== 'string') return reply.code(400).send({ error: 'description must be a string' })
    const s = shelfInput(req.body ?? {})
    // appended to its phase
    const r = db.prepare("INSERT INTO techniques (short_id, name, phase, description, service, needs, yields, position) VALUES (?, ?, ?, ?, COALESCE(?, 'any'), COALESCE(?, '[]'), COALESCE(?, '[]'), (SELECT COALESCE(MAX(position), 0) + 1 FROM techniques WHERE phase = ?)) RETURNING *")
      .get(nextShortId(db, 'TQ'), name.trim(), phase, description ?? '', s.service, s.needs, s.yields, phase) as any
    const node: TechniqueNode = { id: r.id, shortId: r.short_id, name: r.name, phase: r.phase as Phase, description: r.description, position: r.position, applies: r.applies, ...shelf(r), commands: [], tools: [], uses: [] }
    return reply.code(201).send(node)
  })
}
