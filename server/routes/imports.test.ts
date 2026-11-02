import Fastify from 'fastify'
import { expect, test, vi } from 'vitest'
import { openDb } from '../db'
import { importsRoutes } from './imports'

const setup = async (env: Record<string, string> = {}, fetchImpl?: typeof fetch) => {
  const db = openDb(':memory:')
  const app = Fastify()
  await app.register(importsRoutes, { db, env, fetchImpl })
  const post = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, payload: payload as object })
  return { db, post }
}
const boxes = (db: ReturnType<typeof openDb>) => (db.prepare('SELECT COUNT(*) n FROM boxes').get() as { n: number }).n

test('htb without token: 400, nothing changed, no fetch', async () => {
  const { db, post } = await setup({}, (() => { throw new Error('no fetch') }) as any)
  const res = await post('/api/import/htb')
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'HTB_APP_TOKEN is not set in .env' })
  expect(boxes(db)).toBe(0)
})

test('htb live fetch failure: 502 with message, nothing written', async () => {
  const { db, post } = await setup({ HTB_APP_TOKEN: 'secret' }, (async () => new Response('', { status: 500 })) as any)
  const res = await post('/api/import/htb')
  expect(res.statusCode).toBe(502)
  expect(res.body).not.toContain('secret')
  expect(boxes(db)).toBe(0)
})

test('thm-progress: names, validation, missing username', async () => {
  const { db, post } = await setup()
  db.exec("INSERT INTO boxes (short_id, platform, name, difficulty, source_id) VALUES ('T-0001','THM','Pickle Rick','Easy','thm:picklerick')")
  expect((await post('/api/import/thm-progress', { names: ['nope', 'picklerick'] })).json())
    .toEqual({ matched: ['picklerick'], unmatched: ['nope'], ambiguous: [] })
  expect((await post('/api/import/thm-progress', { names: 'x' })).statusCode).toBe(400)
  expect((await post('/api/import/thm-progress', { names: [1] })).statusCode).toBe(400)
  expect((await post('/api/import/thm-progress', { names: Array(5001).fill('a') })).statusCode).toBe(400)
  const none = await post('/api/import/thm-progress')
  expect(none.statusCode).toBe(400)
  expect(none.json()).toEqual({ error: 'THM_USERNAME is not set in .env' })
})

test('thm-catalog accepts browser JSON; bad JSON is 400', async () => {
  const { db, post } = await setup()
  expect((await post('/api/import/thm-catalog', { json: 42 })).statusCode).toBe(400)
  expect(boxes(db)).toBe(0)
})

test('thm-catalog and thm-progress accept valid browser JSON', async () => {
  const { db, post } = await setup()
  const docs = { data: { docs: [{ code: 'picklerick', title: 'Pickle Rick', difficulty: 'easy', tagDocs: [{ label: 'Linux' }] }] } }
  expect((await post('/api/import/thm-catalog', { json: docs })).json()).toEqual({ inserted: 1, updated: 0, skipped: 0 })
  expect((await post('/api/import/thm-progress', { json: docs })).json()).toEqual({ matched: ['picklerick'], unmatched: [], ambiguous: [] })
  expect(db.prepare("SELECT status FROM boxes WHERE source_id = 'thm:picklerick'").get()).toEqual({ status: 'rooted' })
})

test('unexpected errors are generic', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {}) // the cause is logged; asserted in the next test
  const { db, post } = await setup()
  db.close()
  const res = await post('/api/import/thm-progress', { names: ['a'] })
  log.mockRestore()
  expect(res.statusCode).toBe(500)
  expect(res.json()).toEqual({ error: 'Import failed' })
})

test('logs the real cause of a 500, but not a 400 or 502', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { db, post } = await setup()
  db.close() // the import then fails with a known message
  const res = await post('/api/import/thm-progress', { names: ['a'] })
  expect(res.statusCode).toBe(500)
  expect(res.json()).toEqual({ error: 'Import failed' })
  expect(log).toHaveBeenCalledWith(expect.stringContaining('not open'))
  log.mockClear()
  expect((await post('/api/import/htb')).statusCode).toBe(400) // no token
  const live = await setup({ HTB_APP_TOKEN: 'x' }, (async () => new Response('', { status: 500 })) as any)
  expect((await live.post('/api/import/htb')).statusCode).toBe(502)
  expect(log).not.toHaveBeenCalled()
  log.mockRestore()
})

test('networks: creates the preset labs per platform, rejects a bad platform', async () => {
  const { db, post } = await setup()
  expect((await post('/api/import/networks', { platform: 'HTB' })).json()).toEqual({ inserted: 6, skipped: 0 })
  expect((await post('/api/import/networks', { platform: 'THM' })).statusCode).toBe(400)
  expect((await post('/api/import/networks', {})).json()).toEqual({ inserted: 0, skipped: 6 })
  expect((db.prepare('SELECT COUNT(*) n FROM networks').get() as { n: number }).n).toBe(6)
})

test('thm-networks accepts browser JSON and creates networks with links and the AD tag', async () => {
  const { db, post } = await setup()
  const docs = [
    { code: 'wreath', title: 'Wreath', difficulty: 'easy', type: 'walkthrough', technologyTags: ['Active Directory', 'Linux', 'Web'] },
    { code: 'bandit', title: 'Bandit', difficulty: 'hard', type: 'challenge', technologyTags: ['Linux'] },
    { title: 'no code' },
  ]
  expect((await post('/api/import/thm-networks', { json: { data: { docs } } })).json()).toEqual({ inserted: 2, updated: 0, skipped: 0 })
  expect(db.prepare("SELECT name, tags, url, source_id FROM networks ORDER BY id").all()).toEqual([
    { name: 'Wreath', tags: '["Active Directory"]', url: 'https://tryhackme.com/room/wreath', source_id: 'thm:wreath' },
    { name: 'Bandit', tags: '[]', url: 'https://tryhackme.com/room/bandit', source_id: 'thm:bandit' },
  ])
  expect((await post('/api/import/thm-networks', { json: { data: { docs } } })).json()).toEqual({ inserted: 0, updated: 0, skipped: 2 })
  expect((await post('/api/import/thm-networks', { json: 'nope' })).statusCode).toBe(400)
})

