// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { api } from './api'

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
