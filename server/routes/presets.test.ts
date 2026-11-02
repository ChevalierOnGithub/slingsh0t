import Fastify from 'fastify'
import { expect, it } from 'vitest'
import { presetsRoutes } from './presets'

it('lists public presets only', async () => {
  const app = Fastify()
  await app.register(presetsRoutes)
  const list = (await app.inject({ url: '/api/network-presets' })).json<Record<string, unknown>[]>()
  expect(list.map((p) => p.name)).toContain('Dante')
  for (const p of list) {
    expect(Object.keys(p).sort().filter((k) => k !== 'tags')).toEqual(['flagsInScope', 'hostsInScope', 'id', 'name', 'platform', 'source', 'url'])
    expect(p.source).toMatch(/^https:\/\//)
    expect(p.url).toMatch(/^https:\/\//)
  }
})
