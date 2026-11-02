import type Database from 'better-sqlite3'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from '../../server/dataDir'
import { openDb } from '../../server/db'
import { nextShortId } from '../../server/ids'
import { markRooted } from '../../server/routes/boxes'
import type { BoxStatus } from '../../shared/types'
import { fetchMachines } from './client'
import type { HtbMachine } from './map'

const RANK: BoxStatus[] = ['not_started', 'in_progress', 'user_flag', 'rooted']

type Stats = { inserted: number; updated: number; skipped: number; unknownDifficulty: number }

/**
 * Upsert by source_id, adopting a manual HTB box of the same name before inserting.
 * Touches only imported fields; status only ever moves forward.
 */
export function importHtb(db: Database.Database, machines: HtbMachine[] & { unknownDifficulty?: number }): Stats {
  const stats = { inserted: 0, updated: 0, skipped: 0, unknownDifficulty: machines.unknownDifficulty ?? 0 }
  const now = new Date().toISOString()
  const find = db.prepare('SELECT id, status FROM boxes WHERE source_id = ?')
  const findManual = db.prepare(`SELECT id, status FROM boxes
    WHERE platform = 'HTB' AND source_id IS NULL AND norm_name(name) = norm_name(?) ORDER BY id LIMIT 1`)
  const insert = db.prepare(`INSERT INTO boxes (short_id, platform, name, os, difficulty, release_date, status, started_at, rooted_at, source, source_id, url)
    VALUES (@shortId, 'HTB', @name, @os, @difficulty, @releaseDate, @status, @startedAt, @rootedAt, 'htb', @sourceId, @url)`)
  // The IS NOT guard makes `changes` 0 when nothing differs, so a no-op re-import counts as skipped.
  const update = db.prepare(`UPDATE boxes SET source_id = @sourceId, source = 'htb', name = @name, os = COALESCE(NULLIF(@os, ''), os), difficulty = @difficulty,
      release_date = COALESCE(@releaseDate, release_date), status = @status, started_at = COALESCE(started_at, @startedAt), rooted_at = COALESCE(rooted_at, @rootedAt),
      url = CASE WHEN url = '' THEN @url ELSE url END
    WHERE id = @id AND (source_id IS NOT @sourceId OR source IS NOT 'htb' OR name IS NOT @name OR os IS NOT COALESCE(NULLIF(@os, ''), os)
      OR difficulty IS NOT @difficulty OR release_date IS NOT COALESCE(@releaseDate, release_date) OR status IS NOT @status OR url = '')`)
  const secs = Math.floor(Date.parse(now) / 1000)

  db.transaction(() => {
    for (const { id: htbId, name, os, difficulty, releaseDate, userOwned, rootOwned } of machines) {
      const sourceId = `htb:${htbId}`
      const url = `https://app.hackthebox.com/machines/${htbId}`
      const owned: BoxStatus = rootOwned ? 'rooted' : userOwned ? 'user_flag' : 'not_started'
      const row = (find.get(sourceId) ?? findManual.get(name)) as { id: number; status: BoxStatus } | undefined
      const status = row && RANK.indexOf(row.status) >= RANK.indexOf(owned) ? row.status : owned
      const moved = status !== (row?.status ?? 'not_started') // only a real status change stamps the timestamps
      const values = { sourceId, url, name, os, difficulty, releaseDate, status, startedAt: moved ? now : null, rootedAt: moved && status === 'rooted' ? now : null }
      if (!row) {
        insert.run({ ...values, shortId: nextShortId(db, 'H') })
        stats.inserted++
      } else if (update.run({ ...values, id: row.id }).changes) {
        if (moved && status === 'rooted') markRooted(db, { col: 'box_id', id: row.id }, secs) // same as PATCH status=rooted
        stats.updated++
      } else stats.skipped++
    }
  })()
  return stats
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* no .env: handled by the token check below */ }
  const token = process.env.HTB_APP_TOKEN
  if (!token) {
    console.error('HTB_APP_TOKEN is not set in .env')
    process.exit(1)
  }
  const machines = await fetchMachines(token)
  const db = openDb(join(dataDir(), 'slingsh0t.db'))
  console.log(importHtb(db, machines))
  db.close()
}
