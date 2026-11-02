import type Database from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import { AD_TAG, PHASES } from '../../shared/types'
import type { BoxDetail, BoxSummary, HostDetail, Phase, Step } from '../../shared/types'
import { updateRow } from '../db'
import { nextShortId } from '../ids'
import { hostIps, localDay, reportOf } from '../report'
import { useOf } from './library'
import { fail, isHaves, isHostOrEmpty, isServices, isStr, isTags, isUrlOrEmpty } from '../validate'
import { uniqServices } from '../../shared/services'

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Insane']
export const STATUSES = ['not_started', 'in_progress', 'user_flag', 'rooted']
const BASE_PHASES = PHASES.slice(0, 5)

const isPhase = (v: unknown): v is Phase => (PHASES as readonly unknown[]).includes(v)

type Row = Record<string, any>
type Db = Database.Database
const toStep = (r: Row): Step => ({ id: r.id, boxId: r.box_id, hostId: r.host_id, phase: r.phase, position: r.position, body: r.body, seconds: r.seconds, timerStartedAt: r.timer_started_at, done: r.done === 1, saw: r.saw, think: r.think, tried: r.tried, got: r.got, dead: r.dead === 1 })
const toSummary = (r: Row): BoxSummary => ({ id: r.id, shortId: r.short_id, platform: r.platform, name: r.name, os: r.os, difficulty: r.difficulty, status: r.status, targetIp: r.target_ip, totalSeconds: r.total_seconds, releaseDate: r.release_date, dns: r.dns, url: r.url })

/** A step belongs to exactly one box or one host. */
export type Owner = { col: 'box_id' | 'host_id'; id: number }
const ownerOf = (s: Row): Owner => (s.box_id !== null ? { col: 'box_id', id: s.box_id } : { col: 'host_id', id: s.host_id })
// A host has no tags of its own: it inherits its network's.
const OWNER_TAGS = {
  box_id: 'SELECT tags FROM boxes WHERE id = ?',
  host_id: 'SELECT n.tags FROM hosts h JOIN networks n ON n.id = h.network_id WHERE h.id = ?',
}
/** Also the owner's existence check (404). */
const ownerTags = (db: Db, o: Owner): string[] =>
  JSON.parse(((db.prepare(OWNER_TAGS[o.col]).get(o.id) as Row) ?? fail(`${o.col === 'box_id' ? 'box' : 'host'} not found`, 404)).tags)
const stepsOf = (db: Db, o: Owner) => (db.prepare(`SELECT * FROM steps WHERE ${o.col} = ? ORDER BY position`).all(o.id) as Row[]).map(toStep)
const usesOf = (db: Db, o: Owner) => (db.prepare(`SELECT u.* FROM technique_uses u JOIN steps s ON s.id = u.step_id WHERE s.${o.col} = ? ORDER BY u.id`).all(o.id) as Row[])
  .map(useOf)
// Inserts at `pos`, shifting later steps down.
const insertStep = (db: Db, o: Owner, phase: Phase, pos: number): Step => {
  db.prepare(`UPDATE steps SET position = position + 1 WHERE ${o.col} = ? AND position >= ?`).run(o.id, pos)
  const { lastInsertRowid } = db.prepare(`INSERT INTO steps (${o.col}, phase, position) VALUES (?, ?, ?)`).run(o.id, phase, pos)
  return toStep(db.prepare('SELECT * FROM steps WHERE id = ?').get(lastInsertRowid) as Row)
}
export const addDefaultSteps = (db: Db, o: Owner, tags: string[]) => (tags.includes(AD_TAG) ? PHASES : BASE_PHASES).forEach((p, i) => insertStep(db, o, p, i))
const STOP_TIMER = 'UPDATE steps SET seconds = seconds + MAX(0, ? - timer_started_at), timer_started_at = NULL WHERE timer_started_at IS NOT NULL AND'
export const stopTimers = (db: Db, o: Owner, at: number, exceptStepId = -1) =>
  db.prepare(`${STOP_TIMER} ${o.col} = ? AND id != ?`).run(at, o.id, exceptStepId)
/** Rooted, however it was set: timers stop and every step is behind you. Box callers also stamp rooted_at/started_at. */
export const markRooted = (db: Db, o: Owner, at: number) => {
  stopTimers(db, o, at)
  db.prepare(`UPDATE steps SET done = 1 WHERE ${o.col} = ?`).run(o.id)
}
/** Dropping the AD tag would strand Persistence steps that the phase check no longer allows. */
export const checkAdRemoval = (db: Db, tags: string[], persistenceSql: string, ownerId: number) => {
  if (!tags.includes(AD_TAG) && db.prepare(persistenceSql).get(ownerId)) fail('delete the Persistence steps before removing the Active Directory tag')
}

/** Box and host PATCH: validates `services` and `haves` into `set`, deduped. */
export const setShelf = (b: Row, set: Record<string, unknown>) => {
  if (b.services !== undefined) isServices(b.services) ? (set.services = JSON.stringify(uniqServices(b.services))) : fail('invalid services')
  if (b.haves !== undefined) isHaves(b.haves) ? (set.haves = JSON.stringify([...new Set(b.haves)])) : fail('invalid haves')
}
/** Box and host PATCH: the fields both share (text, name, status, shelf), validated into a column map. */
export const ownerSet = (b: Row): Record<string, unknown> => {
  const set: Record<string, unknown> = {}
  for (const [k, col] of [['name', 'name'], ['os', 'os'], ['nextStep', 'next_step'], ['notes', 'notes'], ['foothold', 'foothold'], ['privesc', 'privesc'], ['rating', 'rating']]) {
    if (b[k] === undefined) continue
    if (!isStr(b[k])) fail(`invalid ${k}`)
    set[col] = k === 'name' ? b[k].trim() : b[k]
  }
  if (set.name === '') fail('name required')
  if (b.status !== undefined) STATUSES.includes(b.status) ? (set.status = b.status) : fail('invalid status')
  setShelf(b, set)
  return set
}
const shelfOf = (r: Row) => ({ services: JSON.parse(r.services), haves: JSON.parse(r.haves) })

export const hostDetail = (db: Db, id: number): HostDetail => {
  const r = (db.prepare('SELECT h.*, n.tags FROM hosts h JOIN networks n ON n.id = h.network_id WHERE h.id = ?').get(id) as Row) ?? fail('host not found', 404)
  const ips = hostIps(db, id)
  const o: Owner = { col: 'host_id', id }
  return {
    id, kind: 'host', shortId: r.short_id, networkId: r.network_id, name: r.name, os: r.os, status: r.status, tags: JSON.parse(r.tags), dns: '',
    nextStep: r.next_step, notes: r.notes, foothold: r.foothold, privesc: r.privesc, rating: r.rating, targetIp: ips.find((i) => i.primary)?.ip ?? null, ips, steps: stepsOf(db, o), uses: usesOf(db, o), ...shelfOf(r),
  }
}

export const boxRoutes: FastifyPluginAsync<{ db: Database.Database; now?: () => number }> = async (app, { db, now = () => (Date.now() / 1000) | 0 }) => {
  const tx = <T>(f: () => T): T => db.transaction(f)()
  const SUMMARY = 'SELECT b.*, COALESCE((SELECT SUM(seconds) FROM steps WHERE box_id = b.id), 0) AS total_seconds FROM boxes b'

  const boxRow = (id: number): Row => (db.prepare(`${SUMMARY} WHERE b.id = ?`).get(id) as Row) ?? fail('box not found', 404)
  const stepRow = (id: number): Row => (db.prepare('SELECT * FROM steps WHERE id = ?').get(id) as Row) ?? fail('step not found', 404)
  const box = (id: number): Owner => ({ col: 'box_id', id })

  const detail = (id: number): BoxDetail => {
    const r = boxRow(id)
    return { ...toSummary(r), kind: 'box', tags: JSON.parse(r.tags), nextStep: r.next_step, notes: r.notes, foothold: r.foothold, privesc: r.privesc, rating: r.rating, startedAt: r.started_at, rootedAt: r.rooted_at, steps: stepsOf(db, box(id)), uses: usesOf(db, box(id)), ...shelfOf(r) }
  }
  const ownerDetail = (o: Owner) => (o.col === 'box_id' ? detail(o.id) : hostDetail(db, o.id))

  const iso = () => new Date(now() * 1000).toISOString()
  const checkPhase = (o: Owner, phase: unknown): Phase => {
    if (!isPhase(phase)) return fail('invalid phase')
    if (phase === 'Persistence' && !ownerTags(db, o).includes(AD_TAG)) fail('Persistence requires the Active Directory tag')
    return phase
  }
  const id = (p: unknown) => Number((p as { id: string }).id)

  app.get('/api/boxes', async () => (db.prepare(`${SUMMARY} ORDER BY b.created_at DESC, b.id DESC`).all() as Row[]).map(toSummary))

  app.post('/api/boxes', async (req, reply) => {
    const b = (req.body ?? {}) as Row
    const name = isStr(b.name) ? b.name.trim() : ''
    if (!name) fail('name required')
    if (b.platform !== 'HTB' && b.platform !== 'THM') fail('invalid platform')
    if (!DIFFICULTIES.includes(b.difficulty)) fail('invalid difficulty')
    if (b.os !== undefined && !isStr(b.os)) fail('invalid os')
    if (b.tags !== undefined && !isTags(b.tags)) fail('invalid tags')
    const tags: string[] = b.tags ?? []
    const newId = tx(() => {
      const { lastInsertRowid } = db.prepare('INSERT INTO boxes (short_id, platform, name, os, difficulty, tags) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nextShortId(db, b.platform === 'HTB' ? 'H' : 'T'), b.platform, name, b.os ?? '', b.difficulty, JSON.stringify(tags))
      addDefaultSteps(db, box(Number(lastInsertRowid)), tags)
      return Number(lastInsertRowid)
    })
    return reply.code(201).send(detail(newId))
  })

  app.get('/api/boxes/:id', async (req) => detail(id(req.params)))

  // Steps, uses, credentials and flags cascade; the context's active box is set null by its FK.
  app.delete('/api/boxes/:id', async (req, reply) => {
    if (!db.prepare('DELETE FROM boxes WHERE id = ?').run(id(req.params)).changes) fail('box not found', 404)
    return reply.code(204).send()
  })

  app.patch('/api/boxes/:id', async (req) => {
    const boxId = id(req.params)
    const b = (req.body ?? {}) as Row
    const set = ownerSet(b)
    if (b.difficulty !== undefined) DIFFICULTIES.includes(b.difficulty) ? (set.difficulty = b.difficulty) : fail('invalid difficulty')
    if (b.tags !== undefined) isTags(b.tags) ? (set.tags = JSON.stringify(b.tags)) : fail('invalid tags')
    if (b.targetIp !== undefined) isHostOrEmpty(b.targetIp) ? (set.target_ip = b.targetIp || null) : fail('invalid targetIp')
    if (b.dns !== undefined) isHostOrEmpty(b.dns) ? (set.dns = b.dns) : fail('invalid dns')
    if (b.url !== undefined) isUrlOrEmpty(b.url) ? (set.url = b.url) : fail('invalid url')
    return tx(() => {
      const cur = boxRow(boxId)
      if (b.tags !== undefined) checkAdRemoval(db, b.tags, "SELECT 1 FROM steps WHERE box_id = ? AND phase = 'Persistence'", boxId)
      if (b.status === 'rooted') {
        set.rooted_at = cur.rooted_at ?? iso()
        set.started_at = cur.started_at ?? iso()
        markRooted(db, box(boxId), now())
      } else if (b.status !== undefined) set.rooted_at = null
      updateRow(db, 'boxes', boxId, set)
      return detail(boxId)
    })
  })

  // Box and host step lists share these routes; `col` is a fixed literal, never user input.
  for (const [path, col] of [['boxes', 'box_id'], ['hosts', 'host_id']] as const) {
    const owner = (p: unknown): Owner => ({ col, id: id(p) })

    app.get(`/api/${path}/:id/report`, async (req) => reportOf(db, owner(req.params), localDay(new Date(now() * 1000))))

    // Imported boxes start with no steps; this gives them the same defaults a new box gets.
    app.post(`/api/${path}/:id/default-steps`, async (req, reply) => {
      const o = owner(req.params)
      return reply.code(201).send(tx(() => {
        const tags = ownerTags(db, o)
        if (stepsOf(db, o).length) fail('already has steps', 409)
        addDefaultSteps(db, o, tags)
        return ownerDetail(o)
      }))
    })

    app.post(`/api/${path}/:id/steps`, async (req, reply) => {
      const o = owner(req.params)
      const { phase, afterStepId } = (req.body ?? {}) as Row
      if (afterStepId !== undefined && !Number.isInteger(afterStepId)) fail('invalid afterStepId')
      return reply.code(201).send(tx(() => {
        ownerTags(db, o)
        const p = checkPhase(o, phase)
        let pos: number
        if (afterStepId === undefined) pos = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM steps WHERE ${col} = ?`).get(o.id) as Row).n
        else {
          const a = db.prepare(`SELECT position FROM steps WHERE id = ? AND ${col} = ?`).get(afterStepId, o.id) as Row | undefined
          pos = (a ?? fail('afterStepId not in this step list')).position + 1
        }
        return insertStep(db, o, p, pos)
      }))
    })

    app.put(`/api/${path}/:id/step-order`, async (req) => {
      const o = owner(req.params)
      const { stepIds } = (req.body ?? {}) as Row
      return tx(() => {
        ownerTags(db, o)
        const have = stepsOf(db, o).map((s) => s.id)
        if (!Array.isArray(stepIds) || stepIds.length !== have.length || !have.every((i) => stepIds.includes(i))) fail('stepIds must match the steps exactly')
        const up = db.prepare('UPDATE steps SET position = ? WHERE id = ?')
        stepIds.forEach((sid: number, i: number) => up.run(i, sid))
        return stepsOf(db, o)
      })
    })
  }

  app.post('/api/steps/:id/duplicate', async (req, reply) => reply.code(201).send(tx(() => {
    const s = stepRow(id(req.params))
    return insertStep(db, ownerOf(s), s.phase, s.position + 1)
  })))

  app.patch('/api/steps/:id', async (req) => {
    const b = (req.body ?? {}) as Row
    if (b.body !== undefined && !isStr(b.body)) fail('invalid body')
    if (b.done !== undefined && typeof b.done !== 'boolean') fail('invalid done')
    if (b.dead !== undefined && typeof b.dead !== 'boolean') fail('invalid dead')
    const LOOP = ['saw', 'think', 'tried', 'got'] as const
    for (const k of LOOP) if (b[k] !== undefined && !isStr(b[k])) fail(`invalid ${k}`)
    // the loop fields are one line each
    const line = (k: (typeof LOOP)[number], old: string) => b[k] === undefined ? old : (b[k] as string).replace(/[\r\n]+/g, ' ')
    return tx(() => {
      const s = stepRow(id(req.params))
      const phase = b.phase === undefined ? s.phase : checkPhase(ownerOf(s), b.phase)
      db.prepare('UPDATE steps SET phase = ?, body = ?, done = ?, saw = ?, think = ?, tried = ?, got = ?, dead = ? WHERE id = ?').run(
        phase, b.body ?? s.body, b.done === undefined ? s.done : Number(b.done),
        ...LOOP.map((k) => line(k, s[k])), b.dead === undefined ? s.dead : Number(b.dead), s.id)
      return toStep(stepRow(s.id))
    })
  })

  // Mark used appends here, on the server, so it never races the step section's own blur flush of the Tried line.
  app.post('/api/steps/:id/tried', async (req) => {
    const { name } = (req.body ?? {}) as Row
    const n = isStr(name) ? name.replace(/[\r\n]+/g, ' ').trim() : ''
    if (!n) fail('name must be a non-empty string')
    return tx(() => {
      const s = stepRow(id(req.params))
      // A whole-word match: `nc` is new beside `ncat`, `nmap` is already in `nmap -sV`.
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`, 'i').test(s.tried)) {
        const kept = s.tried.replace(/[\s,]+$/, '')
        db.prepare('UPDATE steps SET tried = ? WHERE id = ?').run(kept ? `${kept}, ${n}` : n, s.id)
      }
      return toStep(stepRow(s.id))
    })
  })

  app.delete('/api/steps/:id', async (req, reply) => {
    tx(() => {
      const s = stepRow(id(req.params))
      const o = ownerOf(s)
      if ((db.prepare(`SELECT COUNT(*) AS n FROM steps WHERE ${o.col} = ?`).get(o.id) as Row).n <= 1) fail('at least one step is required')
      db.prepare('DELETE FROM steps WHERE id = ?').run(s.id)
      db.prepare(`UPDATE steps SET position = position - 1 WHERE ${o.col} = ? AND position > ?`).run(o.id, s.position)
    })
    return reply.code(204).send()
  })

  app.post('/api/steps/:id/timer', async (req) => {
    const { action } = (req.body ?? {}) as Row
    if (action !== 'start' && action !== 'stop') fail('invalid action')
    return tx(() => {
      const s = stepRow(id(req.params))
      const o = ownerOf(s)
      if (action === 'stop') db.prepare(`${STOP_TIMER} id = ?`).run(now(), s.id)
      else {
        stopTimers(db, o, now(), s.id)
        db.prepare('UPDATE steps SET timer_started_at = COALESCE(timer_started_at, ?) WHERE id = ?').run(now(), s.id)
        // Hosts have no started_at column.
        if (o.col === 'box_id') db.prepare("UPDATE boxes SET status = 'in_progress', started_at = ? WHERE id = ? AND status = 'not_started'").run(iso(), o.id)
        else db.prepare("UPDATE hosts SET status = 'in_progress' WHERE id = ? AND status = 'not_started'").run(o.id)
      }
      return ownerDetail(o)
    })
  })
}
