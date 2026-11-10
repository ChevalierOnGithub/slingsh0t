// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReferencePage } from './ReferencePage'
import { LOST_EVENT } from '../autosave'

vi.mock('../box/Editor', () => ({
  Editor: (p: { value: string; onChange(v: string): void; label: string }) => (
    <textarea aria-label={p.label} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  ),
}))
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const pages = [{ id: 2, title: 'Kerberos', body: '## Tickets\n\nTGT <b>x</b>' }]
const orig = pages[0].body
let fetchMock: ReturnType<typeof vi.fn>
const lost = vi.fn()
beforeEach(() => {
  pages[0] = { ...pages[0], body: orig }
  lost.mockClear()
  addEventListener(LOST_EVENT, lost)
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return json(200, { id: 2, ...JSON.parse(init.body as string) })
    return json(200, url === '/api/reference' ? pages : pages[0])
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { removeEventListener(LOST_EVENT, lost) })

test('lists pages and renders the open one as markdown with html off', async () => {
  render(<ReferencePage id={2} />)
  expect(await screen.findByRole('heading', { name: 'Tickets', level: 2 })).toBeTruthy()
  expect(screen.getByText('TGT <b>x</b>')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Kerberos' }).getAttribute('href')).toBe('#/reference/2')
})

test('edit then Save puts title and body', async () => {
  const user = userEvent.setup()
  render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.type(screen.getByLabelText('Kerberos markdown'), '\nMore')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => {
    const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/reference/2' && i?.method === 'PUT')!
    expect(JSON.parse(put[1].body)).toEqual({ title: 'Kerberos', body: '## Tickets\n\nTGT <b>x</b>\nMore' })
  })
  expect(document.activeElement).toBe(await screen.findByRole('button', { name: 'Edit' }))
})

test('unsaved edits are saved once when the page unmounts', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.type(screen.getByLabelText('Kerberos markdown'), '!')
  unmount()
  await waitFor(() => {
    const puts = fetchMock.mock.calls.filter(([u, i]) => u === '/api/reference/2' && i?.method === 'PUT')
    expect(puts.map(([, i]) => JSON.parse(i.body))).toEqual([{ title: 'Kerberos', body: `${pages[0].body}!` }])
  })
})

test('a blank title at unmount saves the body under the last saved title', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Kerberos markdown'), '!')
  unmount()
  await waitFor(() => {
    const puts = fetchMock.mock.calls.filter(([u, i]) => u === '/api/reference/2' && i?.method === 'PUT')
    expect(puts.map(([, i]) => JSON.parse(i.body))).toEqual([{ title: 'Kerberos', body: `${pages[0].body}!` }])
  })
})

test('a Save still in flight at unmount is not sent twice', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { await new Promise<void>((r) => { finish = r }); return json(200, { id: 2, ...JSON.parse(init.body as string) }) }
    return json(200, url === '/api/reference' ? pages : pages[0])
  })
  const { unmount } = render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.type(screen.getByLabelText('Kerberos markdown'), '!')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  unmount()
  finish()
  await new Promise((r) => setTimeout(r, 20))
  expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT')).toHaveLength(1)
})

test('an in-flight Save that fails after unmount is reported once, without a second PUT', async () => {
  const user = userEvent.setup()
  const two = [...pages, { id: 3, title: 'NTLM', body: 'x' }]
  let fail!: () => void
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { await new Promise<void>((r) => { fail = r }); return json(500, { error: 'disk full' }) }
    return json(200, url === '/api/reference' ? two : two[0])
  })
  const { rerender } = render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.type(screen.getByLabelText('Kerberos markdown'), '!')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  rerender(<ReferencePage id={3} />)
  fail()
  await waitFor(() => expect(lost).toHaveBeenCalledTimes(1))
  expect((lost.mock.calls[0][0] as CustomEvent).detail).toBe('Your last edit to Kerberos was not saved: disk full')
  expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT')).toHaveLength(1)
})

test('a lost save after leaving Reference still shows', async () => {
  const user = userEvent.setup()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json(500, { error: 'disk full' }) : json(200, url === '/api/reference' ? pages : pages[0]))
  const { unmount } = render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.type(screen.getByLabelText('Kerberos markdown'), '!')
  unmount()
  await waitFor(() => expect(lost).toHaveBeenCalledTimes(1))
  expect((lost.mock.calls[0][0] as CustomEvent).detail).toBe('Your last edit to Kerberos was not saved: disk full')
})

test('window focus reloads the list and a clean page shows the newer text', async () => {
  render(<ReferencePage id={2} />)
  await screen.findByText('Tickets')
  pages[0] = { ...pages[0], body: 'Newer text' }
  dispatchEvent(new Event('focus'))
  expect(await screen.findByText('Newer text')).toBeTruthy()
})

test('a page with unsaved edits keeps them on focus reload', async () => {
  const user = userEvent.setup()
  render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.type(screen.getByLabelText('Kerberos markdown'), '!')
  pages[0] = { ...pages[0], body: 'Newer text' }
  dispatchEvent(new Event('focus'))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/reference')).toHaveLength(2))
  await fetchMock.mock.results.at(-1)!.value
  await waitFor(() => expect((screen.getByLabelText('Kerberos markdown') as HTMLTextAreaElement).value).toBe(`${orig}!`))
})

test('a focus reload that started before a save finished does not revert it', async () => {
  const user = userEvent.setup()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return json(200, { id: 2, ...JSON.parse(init.body as string) })
    if (fetchMock.mock.calls.filter(([u, i]) => u === '/api/reference' && i?.method !== 'PUT').length > 1) await gate // the focus reload
    return json(200, url === '/api/reference' ? pages : pages[0])
  })
  render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await user.type(screen.getByLabelText('Kerberos markdown'), '!')
  dispatchEvent(new Event('focus')) // GET begins with the old text
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('button', { name: 'Edit' })
  release()
  await new Promise((r) => setTimeout(r, 20))
  expect(screen.getByText(/TGT <b>x<\/b>!/)).toBeTruthy()
})

test('a newer copy that arrived while editing is adopted once editing ends clean', async () => {
  const user = userEvent.setup()
  render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  pages[0] = { ...pages[0], body: 'Newer text' }
  dispatchEvent(new Event('focus'))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/reference')).toHaveLength(2))
  await fetchMock.mock.results.at(-1)!.value
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  expect((screen.getByLabelText('Kerberos markdown') as HTMLTextAreaElement).value).toBe('Newer text')
})

test('Save with nothing changed sends no PUT and adopts the newer copy', async () => {
  const user = userEvent.setup()
  render(<ReferencePage id={2} />)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  pages[0] = { ...pages[0], body: 'Newer text' }
  dispatchEvent(new Event('focus'))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/reference')).toHaveLength(2))
  await fetchMock.mock.results.at(-1)!.value
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  expect((screen.getByLabelText('Kerberos markdown') as HTMLTextAreaElement).value).toBe('Newer text')
})
