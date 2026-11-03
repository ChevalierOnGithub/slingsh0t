// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { api, upload } from './api'

test('sends content-type only when there is a body', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api('DELETE', '/api/steps/1')
  await api('PATCH', '/api/steps/1', { body: 'x' })
  const headers = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
  expect(headers[0]['content-type']).toBeUndefined()
  expect(headers[1]['content-type']).toBe('application/json')
})

test('shows the server message for a fail() error, not the generic status text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ statusCode: 404, error: 'Not Found', message: 'network not found' }, { status: 404 })))
  await expect(api('GET', '/api/networks/9')).rejects.toThrow('network not found')
})

test('upload posts raw bytes with the type, name and token headers', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ key: 'k' }, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  const blob = new Blob(['x'], { type: 'image/png' })
  await upload('/api/steps/1/attachments', blob, 'a b.png')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/steps/1/attachments')
  expect(init).toMatchObject({ method: 'POST', body: blob, headers: { 'content-type': 'image/png', 'x-file-name': 'a%20b.png' } })
})
