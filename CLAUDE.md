# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SlingSh0t is a local-only, single-user CTF/pentest tracker: a Fastify server owning one SQLite file, serving a React SPA. `PRODUCT.md` is the product truth (users, principles, constraints); `README.md` covers running, Docker, imports and data safety.

## Commands

Node >= 24. TypeScript runs directly through `tsx`; there is no server build step and no lint script.

```
npm install
npm test                                      # vitest run, both projects
npx vitest run server/routes/boxes.test.ts    # one file
npx vitest run server/routes/boxes.test.ts -t "creates HTB AD box"   # one test
npx vitest run --project node                 # server, shared, importer, scripts (node env)
npx vitest run --project web                  # web/** (jsdom env)
npm run typecheck                             # tsc --noEmit over everything
npm run dev:server                            # tsx watch, http://127.0.0.1:4317
npm run dev:web                               # Vite on http://127.0.0.1:5173, proxies /api to 4317
npm start                                     # vite build, then serve dist/web from the server
npm run seed:library                          # REPLACES the whole technique/tool/command library (backs up first)
npm run backup                                # copy of the db into data/backups
npm run restore -- <path>                     # server must be stopped
```

- On this Windows machine, run vitest from PowerShell. From Git Bash the same commands fail with "Vitest failed to find the current suite" (cause not known).
- `better-sqlite3` is pinned to prebuilt binaries (`allowScripts` false in `package.json`); do not enable its install script.
- `dev:web` reads `data/install-token` to inject the API token, so the server must have started once.
- A running Docker container (`docker compose up`) holds port 4317, so `dev:server` cannot bind until it is stopped. Docker and `npm start` keep separate databases.

## Architecture

The code is plain TS imported by relative path (no path aliases, no workspace packages):

- `server/`: Fastify app, SQLite access, route plugins.
- `shared/`: code imported by both server and web. `shared/types.ts` is the API contract; change it first, then both sides.
- `web/`: the React SPA (Vite root is `web/`, build output `dist/web`).
- `importer/`, `scripts/`: CLI entry points (`import:htb`, `import:thm`, `seed:library`, `backup`, `restore`) that open the same db through `server/db.ts`. The import routes call the same importer functions.

A new top-level runtime folder must be added to the `Dockerfile` (it copies folders by name) and to `tsconfig.json` `include`.

### Server

`server/index.ts` `startServer` creates the data dir and install token, opens the db, and passes route plugins to `buildApp` (`server/app.ts`).

- Every request passes a Host/Origin allowlist hard-coded to `127.0.0.1`/`localhost` on ports 4317 and 5173. Changing a port means changing that list.
- `plugins` are registered inside a scope that requires the `x-slingsh0t-token` header. `open` plugins (only the attachment file route) skip the token; anything added there is reachable without it.
- The server injects the token into `index.html` as a `<meta>` tag per request; `web/src/api.ts` reads it.
- Each `server/routes/*.ts` exports a `FastifyPluginAsync<{ db }>` and uses synchronous `better-sqlite3` calls directly; there is no ORM or repository layer. Row-to-type mappers (`toStep`, `toSummary`, ...) sit beside the routes. Validation is hand-written guards in `server/validate.ts`; `fail(msg, status)` throws the HTTP error.
- Routes that need the time take an injectable `now` option. Units differ: boxes and networks use epoch seconds, home uses milliseconds.

### Database

- `server/schema.sql` is the frozen v0 baseline. Never edit it for a schema change; append an entry to `MIGRATIONS` in `server/db.ts`. Entry `i` upgrades `user_version` `i` to `i+1`.
- Shipped history is frozen too: never edit an existing `MIGRATIONS` entry or a tuple it interpolates (`INDEXED`, `STEP`, `HOST`, ...). A changed index definition gets a new tuple and a new migration, as `STEP_V2` did.
- A table rebuild uses the `{ sql, foreignKeysOff: true }` form; the runner checks it introduced no new foreign-key violations.
- `openDb` copies an existing db to `data/backups/pre-migration-v<n>-<stamp>.db` before migrating.
- `server/db.migrate.test.ts` asserts the migration count and checks some entries by array position, so a new migration needs that test updated.
- Search is one FTS5 table, `search_index`, kept current by triggers generated in `db.ts` from `[kind, table, title, body, box_id]` tuples. A new searchable column or table means a migration that drops and regenerates the triggers and backfills. Update triggers are scoped (`AFTER UPDATE OF ...`) so reorders and status changes do not reindex.
- Credential secrets and flag values are stored unencrypted and must never be indexed or logged.
- Lists (tags, services, haves, needs, yields) are JSON in TEXT columns.
- Short ids (`H-0001`, `TQ-001`, ...) come from `nextShortId` in `server/ids.ts`.

### Domain model

- A step belongs to exactly one box or one host (`Owner` in `server/routes/boxes.ts`; CHECK constraint in the db). Box and host pages share the same step, toolbox and report code through the `WorkItem` type; a host inherits its network's tags.
- The six phases live in `PHASES` (`shared/types.ts`). Persistence is offered only when the owner has the `Active Directory` tag. The list is interpolated into CHECK constraints in `schema.sql` and the networks migration, so existing databases keep the old list: changing a phase needs a table-rebuild migration.
- The target context is a single `context` row (`server/routes/context.ts`): active box or host, LHOST, LPORT. `{{TARGET}}`, `{{LHOST}}`, `{{LPORT}}`, `{{DNS}}` are substituted at render time by `shared/placeholders.ts`; stored text always keeps the placeholders.
- Imports add new boxes and fill in a missing OS, link or release date. They never change a box's name, difficulty, notes, steps, tags or target IP, never lower a status, and set no dates.

### Library seed

`importer/library/data/*.json` is the source of truth for techniques, tools and commands; the format and naming rules are in `importer/library/data/README.md`. `validateSeed` in `importer/library/seed.ts` runs in tests and before any write (it rejects unknown service slugs, unknown placeholders and near-duplicate commands), and `coverage.test.ts` pins required content. Service slugs must be in `SERVICES` in `shared/types.ts`.

### Web

- No router library: `web/src/router.ts` parses `location.hash` (`#/boxes/7?tab=Notes`). `Shell.tsx` maps route names to pages and owns the nav rail.
- No state library. `ContextProvider` (`shell/TargetBar.tsx`) holds the target context; everything else is per-page `useState` plus `api()` from `web/src/api.ts`.
- Mutations answer with the fresh item, which replaces local state (`useWorkItem` in `box/WorkItem.tsx`).
- Two window events cross pages: `slingsh0t:stats` makes the rail refetch its counts, and `slingsh0t:lost` (`autosave.ts`) reports an edit that failed to save after its page unmounted. Text fields save through `useAutosave`.
- Styling is plain CSS per feature folder with tokens in `web/src/theme.css`; use the tokens, not new colours.
- The reverse-shell catalog is plain TS under `web/src/shells/`, not in the database. Windows Defender may flag that folder.

## Tests

- Tests sit beside the code as `*.test.ts(x)`. Globals are off: import `test`, `expect`, `vi` from `vitest`.
- Route tests register the one plugin on a bare `Fastify()` with `openDb(':memory:')` and call it with `app.inject` (no token or Host gate in the way). Gate behaviour is tested in `server/app.test.ts` and `server/index.test.ts`.
- Web tests stub `fetch` with `vi.stubGlobal` and render with Testing Library; `web/src/test-setup.ts` runs the cleanup.

## Local-only folders

`docs/`, `wiki-snapshot/`, `data/`, `.superpowers/` and `.claude/` are git-ignored. Design specs and plans live in `docs/superpowers/` on this machine only and are absent from a fresh clone.
