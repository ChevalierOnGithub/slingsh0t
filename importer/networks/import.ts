import type Database from 'better-sqlite3'
import { nextShortId } from '../../server/ids'
import { PRESETS } from '../../server/presets'
import type { NetworkPreset } from '../../shared/types'

export type NetworkImportStats = { inserted: number; skipped: number }

/**
 * Creates one network per known lab (HTB Pro Labs, THM networks) that is not in the database yet, keyed by
 * source_id = preset id. Re-runs never duplicate or overwrite: counts, tags and notes stay the owner's once created.
 */
export function importNetworkPresets(db: Database.Database, platform?: NetworkPreset['platform'], presets = PRESETS): NetworkImportStats {
  const stats = { inserted: 0, skipped: 0 }
  const exists = db.prepare('SELECT 1 FROM networks WHERE source_id = ?')
  const insert = db.prepare('INSERT INTO networks (short_id, platform, name, hosts_in_scope, flags_in_scope, tags, url, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  db.transaction(() => {
    for (const p of presets.filter((x) => !platform || x.platform === platform)) {
      if (exists.get(p.id)) { stats.skipped++; continue }
      insert.run(nextShortId(db, 'N'), p.platform, p.name, p.hostsInScope, p.flagsInScope, JSON.stringify(p.tags ?? []), p.url, p.id)
      stats.inserted++
    }
  })()
  return stats
}
