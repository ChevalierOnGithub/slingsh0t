import { describe, expect, it } from 'vitest'
import { openDb } from '../../server/db'
import { nextShortId } from '../../server/ids'
import { fetchChallengeRooms, fetchCompletedRooms, parseCompletedJson, parseRoomsJson, type ThmRoom } from './client'
import catalogFixture from './fixtures/challenge-rooms.json'
import completedFixture from './fixtures/completed-rooms.json'
import { fetchThm, importThmCatalog, markThmCompleted, writeThm } from './import'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const fakeFetch = (async (url: string | URL | Request) =>
  json(String(url).includes('completed-rooms') ? completedFixture : catalogFixture)) as typeof fetch

const counts = (db: ReturnType<typeof openDb>) => ({
  boxes: db.prepare('SELECT count(*) AS n FROM boxes').get(),
  rooted: db.prepare("SELECT count(*) AS n FROM boxes WHERE status = 'rooted'").get(),
  counters: db.prepare('SELECT * FROM id_counters ORDER BY type').all(),
})

describe('thm client', () => {
  it('passes a timeout signal', async () => {
    let signal: unknown
    const f = (async (_u: string, init?: RequestInit) => { signal = init?.signal; return json({ data: { docs: [] } }) }) as unknown as typeof fetch
    await fetchChallengeRooms(f)
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('a prototype key is not a difficulty', () => {
    const docs = [{ code: 'a', title: 'A', difficulty: 'constructor' }, { code: 'b', title: 'B', difficulty: 'easy' }]
    expect(parseRoomsJson({ data: { docs } })).toEqual([{ code: 'b', title: 'B', difficulty: 'Easy', os: '', releaseDate: null }])
  })

  it('maps challenge rooms and skips difficulties the app has no tier for', async () => {
    const rooms = await fetchChallengeRooms(fakeFetch)
    expect(rooms).toEqual([
      { code: 'relevant', title: 'Relevant', difficulty: 'Medium', os: 'Windows', releaseDate: '2020-07-24' },
      { code: 'dailybugle', title: 'Daily Bugle', difficulty: 'Hard', os: 'Linux', releaseDate: null },
      { code: 'rrootme', title: 'RootMe', difficulty: 'Easy', os: 'Linux', releaseDate: null },
      { code: 'fixtureinsane', title: 'Fixture Insane', difficulty: 'Insane', os: '', releaseDate: null },
      { code: 'FixtureMixed', title: 'Fixture Mixed', difficulty: 'Easy', os: 'Linux', releaseDate: null },
    ])
  })

  it('parses JSON saved from the browser with the same mapping, skipping bad items', async () => {
    expect(parseRoomsJson(catalogFixture)).toEqual(await fetchChallengeRooms(fakeFetch))
    expect(parseRoomsJson(catalogFixture.data.docs)).toHaveLength(5) // a bare docs array works too
    expect(parseCompletedJson(completedFixture)).toEqual(['dailybugle', 'tutorial'])
    expect(parseCompletedJson({ data: { docs: [null, 7, { code: 'x' }] } })).toEqual(['x'])
    expect(() => parseRoomsJson({ error: 'nope' })).toThrow(/unexpected shape/)
  })

  it('returns completed room codes for the username', async () => {
    const urls: string[] = []
    const f = (async (url: string) => { urls.push(String(url)); return json(completedFixture) }) as typeof fetch
    expect(await fetchCompletedRooms('some user', f)).toEqual(['dailybugle', 'tutorial'])
    expect(urls[0]).toContain('username=some%20user')
  })

  it('follows pages until totalPages or an empty page, waiting between requests', async () => {
    const docs = catalogFixture.data.docs
    const pages: Record<number, { docs: unknown[]; totalPages?: number }> = { 1: { docs: docs.slice(0, 2), totalPages: 3 }, 2: { docs: docs.slice(2, 4) }, 3: { docs: docs.slice(4) } }
    const urls: string[] = []
    const waits: number[] = []
    const f = (async (url: string) => {
      urls.push(String(url))
      const p = pages[Number(/page=(\d+)/.exec(String(url))![1])]
      return json({ data: { docs: p.docs, totalPages: pages[1].totalPages } })
    }) as typeof fetch
    expect(await fetchChallengeRooms(f, async (ms) => waits.push(ms))).toEqual(parseRoomsJson(catalogFixture))
    expect(urls.map((u) => /page=(\d+)/.exec(u)![1])).toEqual(['1', '2', '3'])
    expect(waits).toEqual([1000, 1000])
    // no totalPages: an empty page ends it
    const g = (async (url: string) => json({ data: { docs: String(url).endsWith('page=1') ? docs : [] } })) as typeof fetch
    expect(await fetchCompletedRooms('u', g, async () => {})).toEqual(parseCompletedJson(catalogFixture))
  })

  it('refuses to return a silently truncated list after 200 pages', async () => {
    let n = 0
    const endless = (async () => { n++; return json({ data: { docs: [{ code: `r${n}` }] } }) }) as typeof fetch
    await expect(fetchCompletedRooms('u', endless, async () => {})).rejects.toThrow(/past 200/)
    expect(n).toBe(200)
  })

  it('names the bot checkpoint when THM answers with HTML', async () => {
    const f = (async () => new Response('<html>Vercel Security Checkpoint</html>', { status: 429, headers: { 'content-type': 'text/html' } })) as typeof fetch
    await expect(fetchChallengeRooms(f)).rejects.toThrow(/429.*paste/s)
  })
})

describe('importThmCatalog', () => {
  it('inserts once, updates only imported fields, never clears owner data', async () => {
    const db = openDb(':memory:')
    const rooms = await fetchChallengeRooms(fakeFetch)
    expect(importThmCatalog(db, rooms)).toEqual({ inserted: 5, updated: 0, skipped: 0 })
    expect(db.prepare("SELECT short_id, platform, name, os, difficulty, source, status, release_date FROM boxes WHERE source_id = 'thm:relevant'").get())
      .toEqual({ short_id: 'T-0001', platform: 'THM', name: 'Relevant', os: 'Windows', difficulty: 'Medium', source: 'thm', status: 'not_started', release_date: '2020-07-24' })

    db.prepare("UPDATE boxes SET os = 'Linux', notes = 'mine', status = 'in_progress' WHERE source_id = 'thm:rrootme'").run()
    const counters = db.prepare('SELECT * FROM id_counters ORDER BY type').all()
    const changed: ThmRoom[] = rooms.map((r) => (r.code === 'relevant' ? { ...r, difficulty: 'Hard' } : r))
    expect(importThmCatalog(db, changed)).toEqual({ inserted: 0, updated: 1, skipped: 4 })
    expect(db.prepare('SELECT * FROM id_counters ORDER BY type').all()).toEqual(counters) // no short ids burned
    expect(db.prepare("SELECT difficulty FROM boxes WHERE source_id = 'thm:relevant'").get()).toEqual({ difficulty: 'Hard' })
    expect(db.prepare("SELECT os, notes, status FROM boxes WHERE source_id = 'thm:rrootme'").get())
      .toEqual({ os: 'Linux', notes: 'mine', status: 'in_progress' })
  })

  it('adopts a hand-made THM box with the same title instead of duplicating it', async () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO boxes (short_id, platform, name, os, difficulty, notes, status) VALUES (?, 'THM', '  daily   BUGLE ', 'Linux', 'Easy', 'mine', 'user_flag')").run(nextShortId(db, 'T'))
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001', 'HTB', 'Relevant', 'Easy')").run()
    expect(importThmCatalog(db, await fetchChallengeRooms(fakeFetch))).toEqual({ inserted: 4, updated: 1, skipped: 0 })
    expect(db.prepare("SELECT short_id, name, difficulty, source, source_id, notes, status FROM boxes WHERE short_id = 'T-0001'").get())
      .toEqual({ short_id: 'T-0001', name: 'Daily Bugle', difficulty: 'Hard', source: 'thm', source_id: 'thm:dailybugle', notes: 'mine', status: 'user_flag' })
    expect(db.prepare("SELECT url FROM boxes WHERE source_id = 'thm:dailybugle'").get()).toEqual({ url: 'https://tryhackme.com/room/dailybugle' })
    expect(db.prepare("SELECT source_id FROM boxes WHERE short_id = 'H-0001'").get()).toEqual({ source_id: null }) // other platforms untouched
  })
})

describe('markThmCompleted', () => {
  it('matches by code or case-insensitive title and roots forward-only', async () => {
    const db = openDb(':memory:')
    importThmCatalog(db, await fetchChallengeRooms(fakeFetch))
    db.prepare("UPDATE boxes SET status = 'rooted', rooted_at = '2024-01-01 00:00:00' WHERE source_id = 'thm:relevant'").run()

    expect(markThmCompleted(db, ['Relevant', ' daily 	 bugle ', '  ', 'nope'])).toEqual({ matched: ['Relevant', 'daily bugle'], unmatched: ['nope'], ambiguous: [] })
    expect(markThmCompleted(db, ['RROOTME']).matched).toEqual(['RROOTME'])
    const rows = db.prepare("SELECT source_id, status, rooted_at FROM boxes WHERE status = 'rooted' ORDER BY source_id").all() as { source_id: string; rooted_at: string }[]
    expect(rows.map((r) => r.source_id)).toEqual(['thm:dailybugle', 'thm:relevant', 'thm:rrootme'])
    expect(rows.find((r) => r.source_id === 'thm:relevant')?.rooted_at).toBe('2024-01-01 00:00:00')
    expect(rows.find((r) => r.source_id === 'thm:dailybugle')?.rooted_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) // ISO, like the server
  })

  it('ticks every step of a box it roots, but leaves an already rooted box alone', async () => {
    const db = openDb(':memory:')
    importThmCatalog(db, await fetchChallengeRooms(fakeFetch))
    const [a, b] = db.prepare("SELECT id FROM boxes WHERE source_id IN ('thm:relevant', 'thm:dailybugle') ORDER BY source_id").pluck().all() as number[]
    for (const id of [a, b]) db.prepare("INSERT INTO steps (box_id, phase, position) VALUES (?, 'Recon', 0)").run(id)
    db.prepare("UPDATE boxes SET status = 'rooted' WHERE id = ?").run(b)
    markThmCompleted(db, ['Relevant', 'daily bugle'])
    const done = (id: number) => db.prepare('SELECT done FROM steps WHERE box_id = ?').pluck().get(id)
    expect([done(a), done(b)]).toEqual([1, 0]) // a = dailybugle (rooted now), b = relevant (was rooted already)
  })

  it('matches a hand-made box whose title has extra inner whitespace', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('T-0007', 'THM', 'Ice  Room', 'Easy')").run()
    expect(markThmCompleted(db, ['ice room']).matched).toEqual(['ice room'])
  })

  it('matches mixed-case codes in any case', async () => {
    const db = openDb(':memory:')
    importThmCatalog(db, await fetchChallengeRooms(fakeFetch))
    expect(markThmCompleted(db, ['fixturemixed']).matched).toEqual(['fixturemixed'])
    expect(db.prepare("SELECT status FROM boxes WHERE source_id = 'thm:FixtureMixed'").get()).toEqual({ status: 'rooted' })
  })

  it('sets started_at like PATCH status=rooted', async () => {
    const db = openDb(':memory:')
    importThmCatalog(db, await fetchChallengeRooms(fakeFetch))
    const box = db.prepare("SELECT id FROM boxes WHERE source_id = 'thm:relevant'").pluck().get() as number
    markThmCompleted(db, ['relevant'])
    expect(db.prepare('SELECT started_at FROM boxes WHERE id = ?').pluck().get(box)).toMatch(/T.*Z$/)
  })

  it('prefers a code match and reports a title shared by several boxes as ambiguous', async () => {
    const db = openDb(':memory:')
    importThmCatalog(db, await fetchChallengeRooms(fakeFetch))
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('T-0090', 'THM', 'relevant', 'Easy'), ('T-0091', 'THM', 'Twin', 'Easy'), ('T-0092', 'THM', 'twin', 'Easy')").run()
    expect(markThmCompleted(db, ['relevant', 'twin'])).toEqual({ matched: ['relevant'], unmatched: [], ambiguous: ['twin'] })
    expect(db.prepare("SELECT short_id FROM boxes WHERE status = 'rooted'").pluck().all()).toEqual(['T-0001'])
  })
})

describe('fetchThm + writeThm', () => {
  it('imports the catalog and the profile progress together', async () => {
    const db = openDb(':memory:')
    const r = writeThm(db, await fetchThm(fakeFetch, 'owner'))
    expect(r.catalog.inserted).toBe(5)
    expect(r.progress).toEqual({ matched: ['dailybugle'], unmatched: ['tutorial'], ambiguous: [] })
    expect(writeThm(db, await fetchThm(fakeFetch)).progress).toBeNull()
  })

  it('changes nothing when a write fails part-way (catalog written, progress fails)', async () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('T-0099', 'THM', 'Manual', 'Easy')").run()
    const before = counts(db)
    db.exec("CREATE TRIGGER boom BEFORE UPDATE OF status ON boxes BEGIN SELECT RAISE(ABORT, 'disk full'); END")
    await expect(fetchThm(fakeFetch, 'owner').then((f) => writeThm(db, f))).rejects.toThrow('disk full')
    expect(counts(db)).toEqual(before)
  })

  it('changes nothing when any fetch fails', async () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('T-0099', 'THM', 'Manual', 'Easy')").run()
    const before = counts(db)
    const failing = (async (url: string) => {
      if (String(url).includes('completed-rooms')) throw new Error('network down')
      return json(catalogFixture)
    }) as typeof fetch
    await expect(fetchThm(failing, 'owner').then((f) => writeThm(db, f))).rejects.toThrow('network down')
    expect(counts(db)).toEqual(before)
  })
})
