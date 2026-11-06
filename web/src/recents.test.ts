// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { recordRecent } from './recents'

test('posts kind, stringified ref and label', () => {
  const f = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', f)
  recordRecent('box', 7, 'Lame')
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('/api/recents')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body as string)).toEqual({ kind: 'box', ref: '7', label: 'Lame' })
})

test('a rejected fetch neither throws nor leaves an unhandled rejection', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
  const unhandled = vi.fn()
  process.on('unhandledRejection', unhandled)
  expect(() => recordRecent('search', 'smb', 'smb')).not.toThrow()
  await new Promise((r) => setTimeout(r, 20))
  process.off('unhandledRejection', unhandled)
  expect(unhandled).not.toHaveBeenCalled()
})
