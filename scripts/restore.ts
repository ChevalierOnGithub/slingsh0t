import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { dataDir } from '../server/dataDir'
import { backup } from './backup'

const PROBE_URL = 'http://127.0.0.1:4317/'
const fetchProbe = (url: string) => fetch(url, { signal: AbortSignal.timeout(500) })

/** Replace the database in `dir` with `src`; refuses while a server answers on 4317. The current one is backed up before. */
export async function restore(src: string, dir = dataDir(), { probe = fetchProbe } = {}): Promise<string> {
  // Any response counts (403 and 503 included), and so does a timeout: a server busy in a long request is still running.
  if (await probe(PROBE_URL).then(() => true, (e: Error) => e.name === 'TimeoutError')) throw new Error('SlingSh0t is running on 127.0.0.1:4317; stop it before restoring.')
  if (!existsSync(src)) throw new Error(`No database at ${src}; nothing to restore.`)
  const dest = join(dir, 'slingsh0t.db')
  if (existsSync(dest)) {
    try { await backup(dir, Infinity) } catch (e) { // an unreadable current db must not block restoring over it: keep its bytes
      const backups = join(dir, 'backups')
      mkdirSync(backups, { recursive: true })
      const kept = join(backups, `pre-restore-${Date.now()}.db`)
      copyFileSync(dest, kept)
      if (existsSync(`${dest}-wal`)) copyFileSync(`${dest}-wal`, `${kept}-wal`) // committed rows may live only here
      console.error(`Could not back up the current database (${(e as Error).message}); kept its raw files as ${kept}`)
      // SQLite can't back up over a file that isn't a database, and a stale WAL must not meet the restored one
      for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) rmSync(f, { force: true })
    }
  }
  // Work on a copy with its WAL, so a read-only source or one with unflushed writes still restores whole.
  const tmp = mkdtempSync(join(tmpdir(), 'sl-restore-'))
  try {
    copyFileSync(src, join(tmp, 'in.db'))
    if (existsSync(`${src}-wal`)) copyFileSync(`${src}-wal`, join(tmp, 'in.db-wal'))
    const db = new Database(join(tmp, 'in.db'))
    try {
      // SQLite's backup writes through the destination's own journal, so a stale -wal there can't resurface.
      await db.backup(dest)
    } finally {
      db.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return dest
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const src = process.argv[2]
  if (!src) {
    console.error('Usage: npm run restore -- <path to slingsh0t.db>')
    process.exit(1)
  }
  restore(src).then((f) => console.log(`Restored into ${f}; start the server to upgrade it.`), (e: Error) => {
    console.error(e.message)
    process.exit(1)
  })
}
