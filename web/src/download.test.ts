// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { apiDownload } from './download'

const fetchMock = vi.fn()
beforeEach(() => {
  document.head.innerHTML = '<meta name="slingsh0t-token" content="tok">'
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

test('saves the response under the disposition filename, sending the token', async () => {
  fetchMock.mockResolvedValue(new Response('db', { headers: { 'content-disposition': 'attachment; filename="x.db"' } }))
  let name = ''
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download })
  await apiDownload('POST', '/api/backup')
  expect(name).toBe('x.db')
  expect(click).toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledWith('/api/backup', expect.objectContaining({ method: 'POST', headers: { 'x-slingsh0t-token': 'tok' } }))
})

test('a failed response rejects with its error message', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'disk full' }), { status: 500 }))
  await expect(apiDownload('POST', '/api/backup')).rejects.toThrow('disk full')
})
