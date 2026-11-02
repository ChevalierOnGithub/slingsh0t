import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupDb, openDb } from '../server/db'
import { dataDir } from '../server/dataDir'

export async function backup(dir = dataDir()): Promise<string> {
  const file = join(dir, 'slingsh0t.db')
  // openDb would create an empty database; a backup of nothing hides a wrong data dir.
  if (!existsSync(file)) throw new Error(`No database at ${file}; nothing to back up (check SLINGSH0T_DATA_DIR).`)
  const db = openDb(file)
  try {
    return await backupDb(db, join(dir, 'backups'))
  } finally {
    db.close()
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  backup().then(console.log, (e: Error) => {
    console.error(e.message)
    process.exit(1)
  })
}
