import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fastifyStatic from '@fastify/static'
import type { Database } from 'better-sqlite3'
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { buildApp } from './app'
import { dataDir as defaultDataDir } from './dataDir'
import { openDb } from './db'
import { attachmentRoutes, fileRoutes } from './routes/attachments'
import { backupRoutes } from './routes/backup'
import { boxRoutes } from './routes/boxes'
import { libraryRoutes } from './routes/library'
import { lootRoutes } from './routes/loot'
import { networksRoutes } from './routes/networks'
import { presetsRoutes } from './routes/presets'
import { importsRoutes } from './routes/imports'
import { pagesRoutes } from './routes/pages'
import { homeRoutes } from './routes/home'
import { searchRoutes } from './routes/search'
import { statsRoutes } from './routes/stats'

export async function startServer(opts: { dataDir?: string; port?: number; webDir?: string; env?: Record<string, string | undefined> } = {}): Promise<FastifyInstance> {
  const dataDir = opts.dataDir ?? defaultDataDir()
  const webDir = resolve(opts.webDir ?? 'dist/web')
  mkdirSync(dataDir, { recursive: true })
  const tokenFile = join(dataDir, 'install-token')
  let token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : ''
  // An empty or truncated file must never become the token: '' would match a missing header.
  if (!/^[0-9a-f]{64}$/.test(token)) {
    token = randomBytes(32).toString('hex')
    // Replace, never write through, whatever is there (a planted link would otherwise receive the token).
    rmSync(tokenFile, { force: true })
    writeFileSync(tokenFile, token, { mode: 0o600, flag: 'wx' })
    try { chmodSync(tokenFile, 0o600) } catch { /* best effort on Windows */ }
  }

  // an injected env (tests) means never read the real .env
  if (!opts.env) try { process.loadEnvFile() } catch { /* .env is optional */ }
  const db = openDb(join(dataDir, 'slingsh0t.db'))
  const imports: FastifyPluginAsync<{ db: Database }> = (a, o) => importsRoutes(a, { ...o, env: opts.env ?? process.env })
  const backup: FastifyPluginAsync<{ db: Database }> = (a, o) => backupRoutes(a, { ...o, dir: join(dataDir, 'backups') })
  const app = buildApp({ db, token, plugins: [homeRoutes, boxRoutes, libraryRoutes, searchRoutes, statsRoutes, pagesRoutes, networksRoutes, lootRoutes, presetsRoutes, imports, backup, attachmentRoutes], open: [fileRoutes] })
  await app.register(fastifyStatic, { root: webDir, index: false, allowedPath: (p) => p !== '/index.html' })

  const indexFile = join(webDir, 'index.html')
  const page = (req: FastifyRequest, reply: FastifyReply) => {
    let path = req.url.split('?')[0]
    try { path = decodeURIComponent(path) } catch { /* keep raw */ }
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path === '/api' || path.startsWith('/api/'))
      return reply.code(404).send({ error: 'not found' })
    // Re-read per request so a rebuild is picked up without restart.
    reply.headers({ 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'; img-src 'self' data:" })
    if (!existsSync(indexFile)) return reply.code(503).type('text/plain; charset=utf-8').send('The web app is not built yet: run npm run build.')
    const html = readFileSync(indexFile, 'utf8').replace('</head>', `<meta name="slingsh0t-token" content="${token}"></head>`)
    return reply.type('text/html; charset=utf-8').send(html)
  }
  app.get('/', page) // static answers 403 for a directory with index:false
  app.setNotFoundHandler(page)

  // SLINGSH0T_HOST=0.0.0.0 is only for the container, whose port compose publishes on loopback alone.
  await app.listen({ host: process.env.SLINGSH0T_HOST || '127.0.0.1', port: opts.port ?? 4317 })
  return app
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then((a) => console.log(`SlingSh0t on ${a.listeningOrigin}`), (e: Error) => {
    console.error(`SlingSh0t failed to start: ${e.message}`)
    process.exit(1)
  })
}
