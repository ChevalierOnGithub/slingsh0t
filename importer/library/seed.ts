import type Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from '../../server/dataDir'
import { backupDb, openDb } from '../../server/db'
import { nextShortId } from '../../server/ids'
import { APPLIES, HAVES, INTENTS, PHASES, SERVICES, type Applies, type Have, type Intent, type Phase } from '../../shared/types'

export type SeedCommand = { purpose: string; template: string; intent: Intent }
export type SeedTool = { name: string; description?: string; commands?: SeedCommand[] }
export type SeedTechnique = {
  name: string; phase: Phase; service?: string; applies?: Applies; needs?: Have[]; yields?: Have[]
  when?: string; tools?: string[]; commands?: SeedCommand[]
}
export type SeedFile = { tools?: SeedTool[]; techniques?: SeedTechnique[] }

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data')
const SLUG = /^[a-z][a-z0-9-]{0,23}$/
const PLACEHOLDER = /\{\{(\w+)\}\}/g
const KNOWN = new Set(['TARGET', 'LHOST', 'LPORT', 'DNS'])

/** Reads every *.json seed file in name order. */
export const readSeed = (dir = DATA): { file: string; data: SeedFile }[] =>
  readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => ({ file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')) as SeedFile }))

const BLANK = /<[a-z][\w./ -]*>/g // `<user>`, `<path/lib.so>`; never XML like `<!ENTITY …>` or `<?xml …>`
/** A template with case, quotes around a blank, `""` vs `''`, blank names (`<user>` = `<pass>`), spacing and the netexec spelling ironed out. */
export const normalTemplate = (t: string): string =>
  t.toLowerCase().replace(/(["'])(<[a-z][\w./ -]*>)\1/g, '$2').replace(/""/g, "''").replace(BLANK, '<>')
    .replace(/\bnetexec\b/g, 'nxc').replace(/\s+/g, ' ').trim()

/** Every problem across the files; empty means loadable. Checked by seed.test.ts and before any write. */
export function validateSeed(files: { file: string; data: SeedFile }[]): string[] {
  const errors: string[] = []
  const toolNames = new Set<string>()
  const techNames = new Set<string>()
  // A list shows each command once: the same command written twice in different words is a mistake.
  // Identical templates are fine, the loader keeps one.
  const nearDup = (seen: Map<string, string>, where: string, template: string) => {
    if (typeof template !== 'string') return
    const n = normalTemplate(template)
    const other = seen.get(n)
    if (other !== undefined && other !== template) errors.push(`${where}: near-duplicate of "${other}"`)
    else if (other === undefined) seen.set(n, template)
  }
  const toolSeen = new Map<string, Map<string, string>>() // per merged (lowercase) tool name
  const cmd = (where: string, c: SeedCommand) => {
    if (typeof c.template !== 'string' || !c.template.trim()) errors.push(`${where}: empty template`)
    if (typeof c.purpose !== 'string') errors.push(`${where}: purpose must be a string`)
    if (c.intent !== '' && !INTENTS.includes(c.intent as Exclude<Intent, ''>)) errors.push(`${where}: bad intent "${c.intent}"`)
    for (const m of (c.template ?? '').matchAll(PLACEHOLDER)) if (!KNOWN.has(m[1])) errors.push(`${where}: unknown placeholder {{${m[1]}}}`)
  }
  for (const { file, data } of files) {
    for (const t of data.tools ?? []) {
      if (!t.name?.trim()) errors.push(`${file}: tool without a name`)
      const key = t.name?.toLowerCase()
      if (!toolSeen.has(key)) toolSeen.set(key, new Map())
      ;(t.commands ?? []).forEach((c, i) => { cmd(`${file} tool ${t.name} #${i + 1}`, c); nearDup(toolSeen.get(key)!, `${file} tool ${t.name} #${i + 1}`, c.template) })
      toolNames.add(key)
    }
  }
  for (const { file, data } of files) {
    for (const t of data.techniques ?? []) {
      const where = `${file} technique "${t.name}"`
      if (!t.name?.trim()) errors.push(`${file}: technique without a name`)
      if (techNames.has(t.name?.toLowerCase())) errors.push(`${where}: duplicate name`)
      techNames.add(t.name?.toLowerCase())
      if (!PHASES.includes(t.phase)) errors.push(`${where}: bad phase "${t.phase}"`)
      const service = t.service ?? 'any'
      if (service !== 'any' && service !== 'shell' && !SLUG.test(service)) errors.push(`${where}: bad service "${service}"`)
      // a shelf only lights up for a slug servicesInText can find in a Saw line
      else if (service !== 'any' && service !== 'shell' && !(SERVICES as readonly string[]).includes(service)) errors.push(`${where}: service "${service}" is not any, shell or a SERVICES slug`)
      if (t.applies !== undefined && !APPLIES.includes(t.applies)) errors.push(`${where}: bad applies "${t.applies}"`)
      for (const h of [...(t.needs ?? []), ...(t.yields ?? [])]) if (!HAVES.includes(h)) errors.push(`${where}: bad have "${h}"`)
      for (const name of t.tools ?? []) if (!toolNames.has(name.toLowerCase())) errors.push(`${where}: unknown tool "${name}"`)
      const seen = new Map<string, string>()
      ;(t.commands ?? []).forEach((c, i) => { cmd(`${where} #${i + 1}`, c); nearDup(seen, `${where} #${i + 1}`, c.template) })
    }
  }
  return errors
}

/** Replaces the whole library (techniques, tools, commands, and so technique uses) with the seed files. */
export function loadSeed(db: Database.Database, files = readSeed()): { techniques: number; tools: number; commands: number } {
  const errors = validateSeed(files)
  if (errors.length) throw new Error(`seed invalid:\n${errors.join('\n')}`)
  const stats = { techniques: 0, tools: 0, commands: 0 }
  const insTool = db.prepare('INSERT INTO tools (short_id, name, description) VALUES (?, ?, ?)')
  const insTech = db.prepare(`INSERT INTO techniques (short_id, name, phase, description, position, applies, service, needs, yields)
    VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM techniques WHERE phase = ?), ?, ?, ?, ?)`)
  const insCmd = db.prepare('INSERT INTO commands (tool_id, technique_id, purpose, template, intent) VALUES (?, ?, ?, ?, ?)')
  const link = db.prepare('INSERT INTO technique_tools (technique_id, tool_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
  db.transaction(() => {
    // Uses cascade from techniques; the search index follows through its triggers.
    db.exec('DELETE FROM commands; DELETE FROM technique_tools; DELETE FROM techniques; DELETE FROM tools;')
    const toolIds = new Map<string, number>()
    const seenTemplates = new Map<number, Set<string>>() // the same command listed under a tool twice loads once
    for (const { data } of files) {
      for (const t of data.tools ?? []) {
        const key = t.name.toLowerCase()
        let id = toolIds.get(key)
        if (id === undefined) {
          id = Number(insTool.run(nextShortId(db, 'TL'), t.name, t.description ?? '').lastInsertRowid)
          toolIds.set(key, id)
          seenTemplates.set(id, new Set())
          stats.tools++
        }
        for (const c of t.commands ?? []) {
          if (seenTemplates.get(id)!.has(c.template)) continue
          seenTemplates.get(id)!.add(c.template)
          insCmd.run(id, null, c.purpose, c.template, c.intent)
          stats.commands++
        }
      }
    }
    for (const { data } of files) {
      for (const t of data.techniques ?? []) {
        const id = Number(insTech.run(nextShortId(db, 'TQ'), t.name, t.phase, t.when ?? '', t.phase, t.applies ?? 'any', t.service ?? 'any',
          JSON.stringify([...new Set(t.needs ?? [])]), JSON.stringify([...new Set(t.yields ?? [])])).lastInsertRowid)
        stats.techniques++
        for (const name of t.tools ?? []) link.run(id, toolIds.get(name.toLowerCase())!)
        for (const c of t.commands ?? []) { insCmd.run(null, id, c.purpose, c.template, c.intent); stats.commands++ }
      }
    }
  })()
  return stats
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const dir = dataDir()
  const db = openDb(join(dir, 'slingsh0t.db'))
  backupDb(db, join(dir, 'backups')).then((file) => {
    console.log(`backup: ${file}`)
    console.log(loadSeed(db))
    db.close()
  }, (e: Error) => { console.error(e.message); process.exit(1) })
}
