# SlingSh0t

SlingSh0t is a local-only CTF and pentest tracker: boxes, phase-by-phase steps, notes, and a toolbox of techniques and commands with live target substitution. It listens on `127.0.0.1` only and keeps everything in one SQLite file.

## Use

```
npm install
npm run seed:library  # replace the whole technique/tool library with importer/library/data/*.json (backs up first)
npm start             # builds the web app and serves it; open http://127.0.0.1:4317
npm run backup        # consistent copy of the database into data/backups
```

Dev: `npm run dev:server` and `npm run dev:web` (Vite on http://127.0.0.1:5173, proxies `/api`).

Third-party acknowledgements and licences live on the in-app Credits page.
`web/src/shells/` holds plain reverse-shell text, so Windows Defender may flag a clone unless that folder is excluded.

## Docker

```
docker compose up -d --build     # open http://127.0.0.1:4317
docker compose exec slingsh0t npm run seed:library
docker compose exec slingsh0t npm run import:htb
docker compose exec slingsh0t npm run backup
docker compose build --pull && docker compose up -d   # pick up base-image security updates
```

The container runs as a non-root user with a read-only filesystem and no Linux capabilities; only `/app/data` and `/tmp` are writable.

- Published on `127.0.0.1` only, and the host port must stay `4317`: the server rejects any other Host header.
- `HTB_APP_TOKEN` and `THM_USERNAME` from `.env` are passed in at start (nothing else from `.env`); restart the container after editing them.
- Data lives in the named volume `slingsh0t_slingsh0t-data`, not `./data` (SQLite's WAL locking is unreliable on Docker Desktop bind mounts). `docker compose down -v` deletes it.
- Use either Docker or `npm start`, not both: they keep separate databases.

Move an existing `data/slingsh0t.db` into the volume. This replaces the database in the volume; the one it replaces is backed up to `backups/` first:

```
docker compose stop
docker compose run --rm --no-deps -v ./data:/import:ro slingsh0t npm run restore -- /import/slingsh0t.db
docker compose up -d
```

Outside Docker the same works with `npm run restore -- <path>` while the server is stopped.

Copy backups out: `docker compose cp slingsh0t:/app/data/backups ./backups`.

## Data

Everything lives in `data/` (override with `SLINGSH0T_DATA_DIR`): `slingsh0t.db` and `install-token`. The token is generated on first start; the server injects it into the page and requires it on every `/api` call.

Before a schema upgrade, an existing database is copied to `data/backups/pre-migration-v<old version>-<timestamp>.db`.

**Warning: `data/slingsh0t.db` stores credentials and hashes unencrypted. Keep it out of shared folders and backups you don't control.**

## Importing boxes

Use the Import screen in the app, or the commands. Imports only add boxes and update imported fields; they never touch your notes, steps, tags or target IPs, and never lower a box's status.

```
npm run import:htb    # HTB active + retired machines and your progress
npm run import:thm    # TryHackMe challenge rooms (and your completed rooms if THM_USERNAME is set)
```

Copy `.env.example` to `.env` and fill in (read by the server only, never sent to the browser):

```
HTB_APP_TOKEN=...     # HTB profile settings, App Tokens
THM_USERNAME=...      # your public TryHackMe username
```

TryHackMe blocks scripted requests, so a live fetch can fail with a 502 and nothing is written. Fallback: open these URLs in your browser while logged in, save each JSON response, and load it on the Import screen.

- Catalog ("Load catalog JSON"), 50 rooms per page:
  `https://tryhackme.com/api/v2/hacktivities/extended-search?kind=rooms&difficulty=all&order=relevance&roomType=challenge&contentSubType=all&userProgress=all&searchText=&limit=50&page=1`
- Completed rooms ("Load completed-rooms JSON"), 16 rooms per page; put your username in:
  `https://tryhackme.com/api/v2/public-profile/completed-rooms?username=YOUR_USERNAME&limit=16&page=1`

Change `page=1` to 2, 3, … until a page comes back empty. Save each page; loading pages one after another is safe. You can also just paste completed room names.

## Networks

A network (a Pro Lab or THM network) groups hosts, subnets with pivots, and credentials. Create one from a preset (public name and host/flag counts only, each with a source link; a blank count is yours to fill in) or from scratch.

- Hosts: each has one or more IPs and behaves like a box (steps, writeup, technique uses).
- Pivots: record which host reaches which subnet and how. With a host active, the context bar shows `via <method> through <pivot host>` when its IP falls in a pivot's subnet.
- Credentials: kind, secret and a per-host result (`works` / `failed`; no row means untested).

**Secrets (credential secrets, flag values) are stored unencrypted in `data/slingsh0t.db`.** The UI masks them by default with a reveal toggle and a copy button, and the server never logs them.

`LHOST` stays your VPN IP; only `TARGET` changes with the chosen host.
