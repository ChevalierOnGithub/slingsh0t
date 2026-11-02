import type Database from 'better-sqlite3'

const PAD = { H: 4, T: 4, TQ: 3, TL: 3, N: 3, HS: 3 }

// Single atomic UPDATE...RETURNING: safe standalone or inside a caller's transaction.
export function nextShortId(db: Database.Database, type: keyof typeof PAD): string {
  const row = db.prepare('UPDATE id_counters SET next = next + 1 WHERE type = ? RETURNING next - 1 AS n').get(type) as { n: number }
  return `${type}-${String(row.n).padStart(PAD[type], '0')}`
}
