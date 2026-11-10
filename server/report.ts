import type Database from 'better-sqlite3'
import { substitute } from '../shared/placeholders'
import { STATUS_LABEL } from '../shared/status'
import { slugger } from '../shared/slug'
import type { BoxStatus } from '../shared/types'
import type { Owner } from './routes/boxes'
import { fail } from './validate'

// SQL twin of the report's "filled step" test (body or any loop line non-blank). Columns are NOT NULL; trims what JS trim() does for ASCII.
export const STEP_FILLED = (s: string) => `trim(${s}.body || ${s}.saw || ${s}.think || ${s}.tried || ${s}.got, ' ' || char(9, 10, 11, 12, 13)) <> ''`

type Row = Record<string, any>

/** Local calendar day of the server process; SQLite's CURRENT_TIMESTAMP strings are UTC without a Z. */
export const localDay = (d: Date) => d.toLocaleDateString('sv')
const day = (s?: string | null) => (s ? localDay(new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`)) : null)
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => '---'), ...rows].map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')
/** An inline code span that shows `s` exactly: a fence one longer than its longest backtick run, padded when it starts or ends with a backtick. */
const code = (s: string) => {
  const fence = '`'.repeat(Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length)) + 1)
  const pad = /^`|`$/.test(s) ? ' ' : ''
  return `${fence}${pad}${s}${pad}${fence}`
}
/** Replaces every flag value of 6+ characters (trimmed) in a text. */
const redactor = (values: string[]) => {
  const secrets = values.map((v) => v.trim()).filter((v) => v.length >= 6)
  return (t: string) => secrets.reduce((acc, v) => acc.split(v).join('[flag redacted]'), t)
}
/** CommonMark fences: the marker still open after line `l`, given the one open before it (null outside a fence).
 * Opens on ``` (no backtick in the info string) or ~~~; closes on the same character, at least as long, nothing after. */
const fenceAfter = (open: string | null, l: string): string | null => {
  if (open) return new RegExp(`^ {0,3}${open[0]}{${open.length},}\\s*$`).test(l) ? null : open
  return /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(l)?.[1] ?? null
}
/** Appends the closing fence when `text` leaves one open, so it cannot swallow the rest of the document. */
const closeFence = (text: string) => {
  const open = text.split('\n').reduce<string | null>(fenceAfter, null)
  return open ? `${text}\n${open}` : text
}
/** Maps every ATX heading line (levels 1-5) outside fences through `f`. */
const eachHeading = (md: string, f: (hashes: string, text: string) => string) => {
  let open: string | null = null
  return md.split('\n').map((l) => {
    const m = open ? null : /^(#{1,5}) (.*)$/.exec(l)
    open = fenceAfter(open, l)
    return m ? f(m[1], m[2]) : l
  }).join('\n')
}

export const hostIps = (db: Database.Database, hostId: number) =>
  (db.prepare('SELECT * FROM host_ips WHERE host_id = ? ORDER BY id').all(hostId) as Row[]).map((i) => ({ id: i.id as number, ip: i.ip as string, primary: !!i.is_primary }))
/** The writeup of one box or host, composed from its stored data on every call. Flag values are read only for redaction, never printed.
 * `chapter` drops the facts table and Loot, for use inside the network report. */
export const reportOf = (db: Database.Database, o: Owner, today: string, { chapter = false } = {}): { frontmatter: string; markdown: string } => {
  const isBox = o.col === 'box_id'
  const r = (isBox
    ? db.prepare('SELECT * FROM boxes WHERE id = ?').get(o.id)
    : db.prepare('SELECT h.*, n.name AS network, n.tags FROM hosts h JOIN networks n ON n.id = h.network_id WHERE h.id = ?').get(o.id)) as Row
    ?? fail(`${isBox ? 'box' : 'host'} not found`, 404)
  const tags: string[] = JSON.parse(r.tags) // a host's tags are its network's
  const ips = isBox ? [] : hostIps(db, o.id)
  const target: string | null = isBox ? r.target_ip : ips.find((i) => i.primary)?.ip ?? null
  const targets: string | null = (isBox ? r.target_ip : ips.map((i) => i.ip).join(', ')) || null
  const ctx = db.prepare('SELECT lhost, lport FROM context WHERE id = 1').get() as Row
  const vars = { TARGET: target ?? undefined, LHOST: ctx.lhost, LPORT: ctx.lport, DNS: isBox ? r.dns : undefined }
  const steps = db.prepare(`SELECT * FROM steps WHERE ${o.col} = ? ORDER BY position, id`).all(o.id) as Row[]
  const redact = redactor((db.prepare(`SELECT value FROM flags WHERE ${isBox ? 'box_id' : 'network_id'} = ?`).all(isBox ? o.id : r.network_id) as Row[])
    .map((f) => String(f.value)))

  const fm = ([['title', r.name], ['id', r.short_id], isBox ? ['platform', r.platform] : ['network', r.network], ['os', r.os],
    ['difficulty', isBox ? r.difficulty : null], ['status', STATUS_LABEL[r.status as BoxStatus]], ['target', targets],
    ['started', day(r.started_at)], ['rooted', day(r.rooted_at)]] as [string, string | null][])
    .filter(([, v]) => v != null).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  if (tags.length) fm.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`)
  fm.push(`exported: ${JSON.stringify(today)}`)

  const facts = ([['ID', r.short_id], isBox ? ['Platform', r.platform] : ['Network', r.network], ['OS', r.os || 'not set'],
    ['Difficulty', isBox ? r.difficulty : null], ['Status', STATUS_LABEL[r.status as BoxStatus]], ['Target', targets ?? 'not set'],
    ['Started', day(r.started_at)], ['Rooted', day(r.rooted_at)]] as [string, string | null][])
    .filter((f): f is [string, string] => f[1] != null)
  const out = chapter ? [`# ${r.name}`] : [`# ${r.name}`, table(['Field', 'Value'], facts)]

  const summary = [['Foothold', r.foothold], ['Privilege escalation', r.privesc], ['Perceived difficulty', r.rating]] as [string, string][]
  if (summary.some(([, v]) => v.trim())) out.push('## Summary', summary.map(([k, v]) => `**${k}:** ${redact(v.trim()) || 'not recorded'}`).join('\n\n'))

  const usesOf = db.prepare('SELECT u.tool_ids, t.name FROM technique_uses u JOIN techniques t ON t.id = u.technique_id WHERE u.step_id = ? ORDER BY u.id')
  const toolsOf = (json: string | null): string[] => {
    const ids: number[] = JSON.parse(json ?? '[]')
    if (!ids.length) return []
    const names = new Map((db.prepare(`SELECT id, name FROM tools WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Row[]).map((t) => [t.id, t.name as string]))
    return ids.flatMap((id) => names.get(id) ?? [])
  }
  // One section per filled step in position order, as the box page shows them; the ordinal appears only when a phase repeats.
  const perPhase: Record<string, number> = {}
  for (const s of steps) perPhase[s.phase] = (perPhase[s.phase] ?? 0) + 1
  const seen: Record<string, number> = {}
  const dead: string[] = []
  for (const s of steps) {
    const n = (seen[s.phase] = (seen[s.phase] ?? 0) + 1)
    const parts = ([['Saw', s.saw], ['Think', s.think], ['Tried', s.tried], ['Got', s.got]] as [string, string][]).filter(([, v]) => v.trim())
    const label = `${s.phase}${perPhase[s.phase] > 1 ? ` ${n}` : ''}`
    if (s.dead) dead.push(`- **${label}** — ${parts.map(([k, v]) => `${k}: ${redact(substitute(v, vars))}`).join(' · ') || 'no notes'}`)
    if (!(s.body.trim() || parts.length)) continue
    const uses = (usesOf.all(s.id) as Row[]).map((u) => { const t = toolsOf(u.tool_ids); return t.length ? `${u.name} (${t.join(', ')})` : u.name })
    out.push(`## ${label}${s.dead ? ' (dead end)' : ''}`, ...parts.map(([k, v]) => `**${k}:** ${redact(substitute(v, vars))}`), ...(s.body.trim() ? [closeFence(redact(substitute(s.body, vars)))] : []), ...(uses.length ? [`_Techniques: ${uses.join('; ')}_`] : []))
  }

  // A host's loot is its network's rows tied to this host; a chapter leaves loot to the network's tables. Expected (empty) flags are not loot.
  if (!chapter) {
    const [args, credWhere, flagWhere] = isBox ? [[o.id], 'box_id = ?', 'f.box_id = ?']
      : [[r.network_id, o.id], 'network_id = ? AND found_on_host_id = ?', 'f.network_id = ? AND f.host_id = ?']
    const creds = db.prepare(`SELECT username, kind, secret, found_note FROM credentials WHERE ${credWhere} ORDER BY id`).all(...args) as Row[]
    const flags = db.prepare(`SELECT f.label, f.captured_at, h.name AS host FROM flags f LEFT JOIN hosts h ON h.id = f.host_id WHERE ${flagWhere} AND f.value <> '' ORDER BY f.id`).all(...args) as Row[]
    if (creds.length || flags.length) out.push('## Loot')
    if (creds.length) out.push('### Credentials', table(['User', 'Kind', 'Secret', 'Note'], creds.map((c) => [c.username, c.kind, code(c.secret), redact(c.found_note)])))
    if (flags.length) out.push('### Flags', table(['Flag', 'Host', 'Captured'], flags.map((f) => [`${f.label || 'flag'} (value redacted)`, f.host ?? '', day(f.captured_at)!])))
  }

  if (dead.length) out.push("## What didn't work", dead.join('\n')) // one bullet per line, no blank lines between
  if (r.notes.trim()) out.push('## Notes', closeFence(redact(substitute(r.notes, vars))))
  return { frontmatter: fm.join('\n'), markdown: out.join('\n\n') + '\n' }
}

/** One document per network: facts, flags checklist, machines, a chapter per host, credentials, notes. Flag values are never printed. */
export const networkReportOf = (db: Database.Database, nid: number, today: string): { frontmatter: string; markdown: string } => {
  const n = (db.prepare('SELECT * FROM networks WHERE id = ?').get(nid) as Row) ?? fail('network not found', 404)
  const hosts = db.prepare(`SELECT h.id, h.name, h.os, h.status, (SELECT ip FROM host_ips WHERE host_id = h.id AND is_primary = 1) AS ip
    FROM hosts h WHERE h.network_id = ? ORDER BY h.id`).all(nid) as Row[]
  const flags = db.prepare('SELECT label, value FROM flags WHERE network_id = ? ORDER BY id').all(nid) as Row[]
  const worksOn = db.prepare("SELECT h.name FROM credential_results x JOIN hosts h ON h.id = x.host_id WHERE x.credential_id = ? AND x.result = 'works' ORDER BY h.id")
  const creds = db.prepare('SELECT id, username, kind, secret FROM credentials WHERE network_id = ? ORDER BY id').all(nid) as Row[]
  const tags: string[] = JSON.parse(n.tags)
  const entry: string = n.entry.trim()
  const machines: number = n.hosts_in_scope ?? hosts.length
  const flagCount: number = n.flags_in_scope ?? flags.length
  const owned = hosts.filter((h) => h.status === 'rooted').length
  const captured = flags.filter((f) => f.value !== '').length

  const fm = ([['title', n.name], ['id', n.short_id], ['platform', n.platform], ['machines', machines], ['flags', flagCount], ['entry', entry || null]] as [string, unknown][])
    .filter(([, v]) => v != null).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  if (tags.length) fm.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`)
  fm.push(`exported: ${JSON.stringify(today)}`)

  // Chapters: host reports with every heading one level down. Anchors come from one slug counter over the headings in document order.
  const chapters = hosts.map((h) => eachHeading(reportOf(db, { col: 'host_id', id: h.id }, today, { chapter: true }).markdown.trimEnd(), (hs, t) => `#${hs} ${t}`))
  const slug = slugger()
  slug(n.name)
  if (flags.length) slug('Flags')
  const machinesSlug = slug('Machines')
  const anchors = chapters.map((c) => { const ids: string[] = []; eachHeading(c, (_, t) => { ids.push(slug(t)); return '' }); return ids[0] })

  const facts = [['Platform', n.url ? `[${n.platform}](${n.url})` : n.platform], ['Machines', `${owned} of ${machines}`], ['Flags', `${captured} of ${flagCount}`],
    ...(entry ? [['Entry point', entry]] : []), ...(n.hosts_in_scope !== null && hosts.length !== n.hosts_in_scope ? [['Hosts found', String(hosts.length)]] : [])]
  const out = [`# ${n.name}`, table(['Field', 'Value'], facts)]
  if (flags.length) out.push('## Flags', table(['#', 'Flag', 'Owned'], flags.map((f, i) => [String(i + 1), f.label || 'flag', f.value !== '' ? 'X' : ''])))
  if (hosts.length) out.push('## Machines', table(['Machine', 'OS', 'IP', 'Owned'], hosts.map((h, i) => [`[${h.name}](#${anchors[i]})`, h.os, h.ip ?? '', h.status === 'rooted' ? 'Yes' : ''])))
  out.push(...chapters.map((c) => `${c}\n\n[Back to Machines](#${machinesSlug})\n\n---`))
  if (creds.length) out.push('## Credentials', table(['User', 'Kind', 'Secret', 'Works on'],
    creds.map((c) => [c.username, c.kind, code(c.secret), (worksOn.all(c.id) as Row[]).map((h) => h.name).join(', ')])))
  // Network notes have no single TARGET, so placeholders stay as typed.
  if (n.notes.trim()) out.push('## Notes', closeFence(redactor(flags.map((f) => String(f.value)))(n.notes)))
  return { frontmatter: fm.join('\n'), markdown: out.join('\n\n') + '\n' }
}
