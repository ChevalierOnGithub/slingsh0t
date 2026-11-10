import type Database from 'better-sqlite3'
import { AD_TAG } from '../../shared/types'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from '../../server/dataDir'
import { openDb } from '../../server/db'
import { nextShortId } from '../../server/ids'
import { markRooted } from '../../server/routes/boxes'
import { fetchChallengeRooms, fetchCompletedRooms, type ThmNetwork, type ThmRoom } from './client'

/**
 * Insert-if-absent by source_id; a hand-made THM box with the same title (no source_id) is adopted instead.
 * On re-runs only a missing os, url or release date is filled in: never the name, difficulty, owner fields or status.
 */
export function importThmCatalog(db: Database.Database, rooms: ThmRoom[]): { inserted: number; updated: number; skipped: number } {
  const stats = { inserted: 0, updated: 0, skipped: 0 }
  type Row = { id: number; name: string; os: string; difficulty: string; source_id: string | null; url: string; release_date: string | null }
  const find = db.prepare('SELECT id, name, os, difficulty, source_id, url, release_date FROM boxes WHERE source_id = ?')
  const manual = db.prepare("SELECT id, name, os, difficulty, source_id, url, release_date FROM boxes WHERE platform = 'THM' AND source_id IS NULL AND norm_name(name) = norm_name(?) ORDER BY id LIMIT 1")
  const insert = db.prepare("INSERT INTO boxes (short_id, platform, name, os, difficulty, source_id, source, url, release_date) VALUES (?, 'THM', ?, ?, ?, ?, 'thm', ?, ?)")
  const update = db.prepare("UPDATE boxes SET os = ?, source_id = ?, source = 'thm', url = CASE WHEN url = '' THEN ? ELSE url END, release_date = ? WHERE id = ?")
  db.transaction(() => {
    for (const room of rooms) {
      const sourceId = `thm:${room.code}`
      const url = `https://tryhackme.com/room/${room.code}`
      const title = room.title.trim()
      const row = (find.get(sourceId) ?? manual.get(title)) as Row | undefined
      if (!row) {
        insert.run(nextShortId(db, 'T'), title, room.os, room.difficulty, sourceId, url, room.releaseDate)
        stats.inserted++
        continue
      }
      const os = row.os || room.os // a non-empty OS is the owner's; THM often has none
      const released = room.releaseDate ?? row.release_date
      if (row.source_id === sourceId && row.os === os && row.url !== '' && row.release_date === released) stats.skipped++
      else { update.run(os, sourceId, url, released, row.id); stats.updated++ }
    }
  })()
  return stats
}

/**
 * Marks THM boxes rooted by room code (preferred) or title (case and whitespace ignored). As with PATCH status=rooted,
 * the status moves to rooted and every step is ticked; no dates are written.
 * Rooted is the top status, so this never lowers one, and a box already rooted is left untouched (no re-ticking). A title shared by several boxes is reported as ambiguous and roots nothing.
 */
export function markThmCompleted(db: Database.Database, codesOrTitles: string[]): { matched: string[]; unmatched: string[]; ambiguous: string[] } {
  const result = { matched: [] as string[], unmatched: [] as string[], ambiguous: [] as string[] }
  const find = db.prepare(`SELECT id, lower(source_id) IS 'thm:' || lower(?) AS byCode FROM boxes
    WHERE platform = 'THM' AND (lower(source_id) = 'thm:' || lower(?) OR norm_name(name) = norm_name(?)) ORDER BY byCode DESC, id`)
  const root = db.prepare("UPDATE boxes SET status = 'rooted' WHERE id = ? AND status <> 'rooted'")
  db.transaction(() => {
    for (const name of codesOrTitles.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      const rows = find.all(name, name, name) as { id: number; byCode: number }[]
      if (!rows.length) result.unmatched.push(name)
      else if (!rows[0].byCode && rows.length > 1) result.ambiguous.push(name)
      else {
        if (root.run(rows[0].id).changes) markRooted(db, { col: 'box_id', id: rows[0].id })
        result.matched.push(name)
      }
    }
  })()
  return result
}

type Fetched = { rooms: ThmRoom[]; completed: string[] | null }
export async function fetchThm(fetchImpl: typeof fetch = fetch, username?: string, wait?: (ms: number) => Promise<unknown>): Promise<Fetched> {
  const rooms = await fetchChallengeRooms(fetchImpl, wait)
  return { rooms, completed: username ? await fetchCompletedRooms(username, fetchImpl, wait) : null }
}
/** One transaction: a failure part-way (catalog or progress) changes nothing. */
export const writeThm = (db: Database.Database, { rooms, completed }: Fetched) => db.transaction(() => ({
  catalog: importThmCatalog(db, rooms),
  progress: completed && markThmCompleted(db, completed),
}))()

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* .env is optional */ }
  const username = process.env.THM_USERNAME?.trim()
  if (!username) console.log('THM_USERNAME is not set in .env: importing the catalog only. Paste completed rooms in the Import screen.')
  try {
    const fetched = await fetchThm(fetch, username) // fetch before opening (and maybe migrating) the database
    const db = openDb(join(dataDir(), 'slingsh0t.db'))
    try { console.log(writeThm(db, fetched)) } finally { db.close() }
  } catch (e) {
    console.error(`THM import failed, nothing changed: ${(e as Error).message}`)
    process.exitCode = 1
  }
}

/**
 * One network per THM network room, keyed by source_id `thm:<code>`. Insert-if-absent; on re-runs only the name,
 * url and notes-less metadata follow THM, never the owner's counts, tags, notes or hosts. The AD tag is set on insert only.
 */
export function importThmNetworks(db: Database.Database, nets: ThmNetwork[]): { inserted: number; updated: number; skipped: number } {
  const stats = { inserted: 0, updated: 0, skipped: 0 }
  const find = db.prepare('SELECT id, name, url FROM networks WHERE source_id = ?')
  const insert = db.prepare("INSERT INTO networks (short_id, platform, name, tags, url, source_id) VALUES (?, 'THM', ?, ?, ?, ?)")
  const update = db.prepare('UPDATE networks SET name = ?, url = ? WHERE id = ?')
  db.transaction(() => {
    for (const n of nets) {
      const sourceId = `thm:${n.code}`
      const url = `https://tryhackme.com/room/${n.code}`
      const row = find.get(sourceId) as { id: number; name: string; url: string } | undefined
      if (!row) {
        insert.run(nextShortId(db, 'N'), n.title, JSON.stringify(n.ad ? [AD_TAG] : []), url, sourceId)
        stats.inserted++
      } else if (row.name === n.title && row.url === url) stats.skipped++
      else { update.run(n.title, url, row.id); stats.updated++ }
    }
  })()
  return stats
}

