// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImportPage } from './ImportPage'

const fetchMock = vi.fn()
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: 'x', json: async () => body })
const posts = () => fetchMock.mock.calls.filter(([, i]) => i.method === 'POST')
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

test('pasted names post as {names} and show counts', async () => {
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) =>
    reply(i.method === 'GET' ? [] : { matched: ['a', 'b'], unmatched: [], ambiguous: [] }),
  )
  const stats = vi.fn()
  window.addEventListener('slingsh0t:stats', stats)
  render(<ImportPage />)
  fireEvent.change(screen.getByLabelText('Paste completed room names, one per line'), { target: { value: 'a\nb\n' } })
  fireEvent.click(screen.getByText('Import pasted rooms'))
  await screen.findByText('Matched 2, unmatched 0, ambiguous 0')
  expect(JSON.parse(posts()[0][1].body)).toEqual({ names: ['a', 'b'] })
  expect(stats).toHaveBeenCalled()
})

test('a 400 shows its error verbatim', async () => {
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) =>
    i.method === 'GET' ? reply([]) : reply({ error: 'HTB_APP_TOKEN is not set in .env' }, 400),
  )
  render(<ImportPage />)
  fireEvent.click(screen.getByText('Import from HTB'))
  await screen.findByText('HTB_APP_TOKEN is not set in .env')
})

test('saved JSON file posts as {json}; invalid JSON shows an error without posting', async () => {
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) =>
    reply(i.method === 'GET' ? [] : { inserted: 1, updated: 0, skipped: 0 }),
  )
  render(<ImportPage />)
  const input = screen.getByLabelText('Load catalog JSON')
  fireEvent.change(input, { target: { files: [new File(['not json'], 'a.json')] } })
  await screen.findByText(/not valid JSON/)
  expect(posts()).toHaveLength(0)
  fireEvent.change(input, { target: { files: [new File(['{"rooms":[1]}'], 'a.json')] } })
  await screen.findByText('Inserted 1, updated 0, skipped 0')
  expect(JSON.parse(posts()[0][1].body)).toEqual({ json: { rooms: [1] } })
})

test('unsorted items list and delete', async () => {
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) =>
    i.method === 'GET' ? reply([{ id: 3, sourcePage: 'Misc', content: 'stray note' }]) : reply(null, 204),
  )
  render(<ImportPage />)
  await screen.findByText('stray note')
  fireEvent.click(screen.getByLabelText('Delete Misc'))
  await waitFor(() => expect(screen.queryByText('stray note')).toBeNull())
  expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/unsorted/3' && i.method === 'DELETE')).toBe(true)
})

test('a file over 20 MB is rejected without reading or posting', async () => {
  fetchMock.mockImplementation(async () => reply([]))
  render(<ImportPage />)
  const big = new File(['{}'], 'big.json')
  Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
  fireEvent.change(screen.getByLabelText('Load catalog JSON'), { target: { files: [big] } })
  await screen.findByText(/over 20 MB/)
  expect(posts()).toHaveLength(0)
})

test('a second trigger while one import is pending does not post twice', async () => {
  let release!: () => void
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) => {
    if (i.method === 'GET') return reply([])
    await new Promise<void>((r) => (release = r))
    return reply({ inserted: 0, skipped: 0, unsorted: 0 })
  })
  render(<ImportPage />)
  const btn = screen.getByText('Import HTB Pro Labs')
  fireEvent.click(btn)
  fireEvent.click(btn)
  await waitFor(() => expect(posts()).toHaveLength(1))
  release()
  await screen.findByText('Inserted 0, skipped 0, unsorted 0')
  expect(posts()).toHaveLength(1)
})

test('completed-rooms JSON is counted and confirmed before posting; cancel posts nothing', async () => {
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) =>
    reply(i.method === 'GET' ? [] : { matched: ['a', 'b'], unmatched: [], ambiguous: [] }),
  )
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<ImportPage />)
  const input = screen.getByLabelText('Load completed-rooms JSON')
  const saved = JSON.stringify({ data: { docs: [{ code: 'a' }, { code: 'b' }, { title: 'no code' }] } })
  fireEvent.change(input, { target: { files: [new File([saved], 'p.json')] } })
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('This marks 2 rooms rooted'))
  await waitFor(() => expect(screen.queryByText('Running…')).toBeNull())
  expect(posts()).toHaveLength(0)

  confirm.mockReturnValue(true)
  fireEvent.change(input, { target: { files: [new File([JSON.stringify([{ code: 'a' }])], 'p.json')] } })
  await screen.findByText('Matched 2, unmatched 0, ambiguous 0')
  expect(confirm).toHaveBeenLastCalledWith('This marks 1 rooms rooted')
  expect(JSON.parse(posts()[0][1].body)).toEqual({ json: [{ code: 'a' }] })
})

test('completed-rooms JSON of the wrong shape shows an error without asking or posting', async () => {
  fetchMock.mockImplementation(async () => reply([]))
  const confirm = vi.spyOn(window, 'confirm')
  render(<ImportPage />)
  fireEvent.change(screen.getByLabelText('Load completed-rooms JSON'), { target: { files: [new File(['{"rooms":[]}'], 'p.json')] } })
  await screen.findByText(/not a completed-rooms response/)
  expect(confirm).not.toHaveBeenCalled()
  expect(posts()).toHaveLength(0)
})

test('a THM 400 is announced as an alert in its own panel', async () => {
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) =>
    i.method === 'GET' ? reply([]) : reply({ error: 'TryHackMe JSON has an unexpected shape' }, 400),
  )
  render(<ImportPage />)
  fireEvent.change(screen.getByLabelText('Load catalog JSON'), { target: { files: [new File(['{"x":1}'], 'a.json')] } })
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('TryHackMe JSON has an unexpected shape')
  expect(alert.closest('section')!.getAttribute('aria-label')).toBe('THM catalog')
})

test('result keys read as words', async () => {
  fetchMock.mockImplementation(async (_url: string, i: RequestInit) =>
    reply(i.method === 'GET' ? [] : { inserted: 2, updated: 0, skipped: 1, unknownDifficulty: 3 }),
  )
  render(<ImportPage />)
  fireEvent.click(screen.getByText('Import from HTB'))
  await screen.findByText('Inserted 2, updated 0, skipped 1, unknown difficulty 3')
})
