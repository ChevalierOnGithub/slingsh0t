import type Database from 'better-sqlite3'
import type { FastifyPluginAsync } from 'fastify'
import { fetchMachines } from '../../importer/htb/client'
import { importHtb } from '../../importer/htb/import'
import { fetchChallengeRooms, fetchCompletedRooms, fetchNetworks, parseCompletedJson, parseNetworksJson, parseRoomsJson } from '../../importer/thm/client'
import { importThmCatalog, importThmNetworks, markThmCompleted } from '../../importer/thm/import'
import { importNetworkPresets } from '../../importer/networks/import'

type Opts = { db: Database.Database; env: Record<string, string | undefined>; fetchImpl?: typeof fetch }
const LIMIT = { bodyLimit: 25 * 1024 * 1024 } // browser-saved THM JSON can be large; default stays 1 MB elsewhere
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 })

export const importsRoutes: FastifyPluginAsync<Opts> = async (app, { db, env, fetchImpl = fetch }) => {
  // The UI reads `{ error }`; also covers Fastify's own 413/400 for these routes.
  app.setErrorHandler((e: Error & { statusCode?: number }, _req, reply) => {
    const code = e.statusCode ?? 500
    if (code >= 500 && code !== 502) console.error(`import failed: ${e.message}`)
    return reply.code(code).send({ error: code >= 500 && code !== 502 ? 'Import failed' : e.message })
  })
  // Live fetches finish before any write; a failure becomes 502 with nothing written. Messages never include tokens.
  const live = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f() } catch (e) { throw Object.assign(new Error((e as Error).message), { statusCode: 502 }) }
  }
  const parse = <T>(f: () => T): T => {
    try { return f() } catch (e) { throw bad((e as Error).message) }
  }

  // Known HTB Pro Labs and THM networks from the preset list; no platform call needed.
  app.post<{ Body: { platform?: unknown } | null }>('/api/import/networks', LIMIT, async (req) => {
    const platform = req.body?.platform
    if (platform !== undefined && platform !== 'HTB') throw bad('platform must be HTB')
    return importNetworkPresets(db, platform)
  })

  app.post('/api/import/htb', LIMIT, async () => {
    const token = env.HTB_APP_TOKEN?.trim()
    if (!token) throw bad('HTB_APP_TOKEN is not set in .env')
    return importHtb(db, await live(() => fetchMachines(token, fetchImpl)))
  })

  app.post<{ Body: { json?: unknown } | null }>('/api/import/thm-catalog', LIMIT, async (req) => {
    const json = req.body?.json
    const rooms = json !== undefined ? parse(() => parseRoomsJson(json)) : await live(() => fetchChallengeRooms(fetchImpl))
    return importThmCatalog(db, rooms)
  })

  app.post<{ Body: { json?: unknown } | null }>('/api/import/thm-networks', LIMIT, async (req) => {
    const json = req.body?.json
    const nets = json !== undefined ? parse(() => parseNetworksJson(json)) : await live(() => fetchNetworks(fetchImpl))
    return importThmNetworks(db, nets)
  })

  app.post<{ Body: { names?: unknown; json?: unknown } | null }>('/api/import/thm-progress', LIMIT, async (req) => {
    const { names, json } = req.body ?? {}
    let list: string[]
    if (names !== undefined) {
      if (!Array.isArray(names) || names.length > 5000 || !names.every((n) => typeof n === 'string')) throw bad('names must be an array of at most 5000 strings')
      list = names
    } else if (json !== undefined) {
      list = parse(() => parseCompletedJson(json))
    } else {
      const user = env.THM_USERNAME?.trim()
      if (!user) throw bad('THM_USERNAME is not set in .env')
      list = await live(() => fetchCompletedRooms(user, fetchImpl))
    }
    return markThmCompleted(db, list)
  })
}
