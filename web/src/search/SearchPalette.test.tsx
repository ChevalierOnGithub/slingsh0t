// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchPalette } from './SearchPalette'

afterEach(() => { vi.unstubAllGlobals(); location.hash = '' })

const hits = [
  { kind: 'box', id: 3, boxId: null, title: 'Lame', snippet: '' },
  { kind: 'step', id: 9, boxId: 3, title: 'Foothold', snippet: 'run [x] \u0002smbclient\u0003 now' },
]
const setup = () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(hits)))
  vi.stubGlobal('fetch', fetchMock)
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  return fetchMock
}

test('Ctrl K opens, focuses input, debounces to one call, marks snippet', async () => {
  const fetchMock = setup()
  const input = await screen.findByRole('combobox')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(document.activeElement).toBe(input)
  await userEvent.type(input, 'smb')
  await screen.findByText('smbclient')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.getByText('smbclient').tagName).toBe('MARK')
  expect(document.querySelectorAll('mark')).toHaveLength(1) // the literal [x] is not a highlight
  expect(screen.getByText('smbclient').parentElement!.textContent).toBe('run [x] smbclient now')
})

test('Enter on a step hit navigates to the box step', async () => {
  setup()
  const input = await screen.findByRole('combobox')
  await userEvent.type(input, 'smb')
  await screen.findByText('Foothold')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(location.hash).toBe('#/boxes/3?step=9')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('Esc closes', async () => {
  setup()
  await userEvent.type(await screen.findByRole('combobox'), '{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('clicking a result area keeps focus so Esc still closes', async () => {
  setup()
  await userEvent.type(await screen.findByRole('combobox'), 'smb')
  await screen.findByText('Foothold')
  await userEvent.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('group', { name: /^Steps/ }) })
  expect(document.activeElement).toBe(screen.getByRole('combobox'))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('Enter during the debounce window does nothing', async () => {
  setup()
  const input = await screen.findByRole('combobox')
  await userEvent.type(input, 'smb')
  await screen.findByText('Foothold')
  await userEvent.type(input, 'x{Enter}')
  expect(location.hash).toBe('')
})

test('technique hit goes to ?t=id', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ kind: 'technique', id: 5, boxId: null, title: 'Kerberoast', snippet: '' }]))))
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await userEvent.type(await screen.findByRole('combobox'), 'ker')
  await screen.findByText('Kerberoast')
  await userEvent.keyboard('{Enter}')
  expect(location.hash).toBe('#/techniques?t=5')
})

test('a slower stale response does not overwrite newer results', async () => {
  let resolveSlow!: (r: Response) => void
  const slow = { promise: new Promise<Response>((res) => { resolveSlow = res }) }
  const fetchMock = vi.fn((url: string) =>
    url.includes('q=a&') ? slow.promise : Promise.resolve(new Response(JSON.stringify([{ kind: 'box', id: 1, boxId: null, title: 'Newer', snippet: '' }]))))
  vi.stubGlobal('fetch', fetchMock)
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const input = await screen.findByRole('combobox')
  await userEvent.type(input, 'a')
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  await userEvent.type(input, 'b')
  await screen.findByText('Newer')
  resolveSlow(new Response(JSON.stringify([{ kind: 'box', id: 2, boxId: null, title: 'Older', snippet: '' }])))
  await new Promise((r) => setTimeout(r, 20))
  expect(screen.queryByText('Older')).toBeNull()
  expect(screen.getByText('Newer')).toBeTruthy()
})

test.each([
  [{ kind: 'step', id: 7, boxId: null, hostId: 4, title: 'Pivot step', snippet: '' }, '#/hosts/4?step=7'],
  [{ kind: 'host', id: 4, boxId: null, hostId: null, title: 'DC01', snippet: '' }, '#/hosts/4'],
  [{ kind: 'credential', id: 2, boxId: null, hostId: null, title: 'svc_sql', snippet: '' }, '#/loot'],
])('network hit %#: $title goes to its page', async (hit, hash) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([hit]))))
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await userEvent.type(await screen.findByRole('combobox'), 'x')
  await screen.findByText(hit.title)
  await userEvent.keyboard('{Enter}')
  expect(location.hash).toBe(hash)
})

test('a network hit is grouped under Networks and opens the network page', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ kind: 'network', id: 4, boxId: null, hostId: null, title: 'N-001 Dante', snippet: '' }]))))
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await userEvent.type(await screen.findByRole('combobox'), 'dante')
  expect(await screen.findByRole('group', { name: /^Networks/ })).toBeTruthy()
  await userEvent.keyboard('{Enter}')
  expect(location.hash).toBe('#/networks/4')
})

test('tool and command hits go to that tool or command on the Tools page', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
    { kind: 'tool', id: 2, boxId: null, hostId: null, title: 'gobuster', snippet: '' },
    { kind: 'command', id: 7, boxId: null, hostId: null, title: 'Basic usage', snippet: '' },
  ]))))
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await userEvent.type(await screen.findByRole('combobox'), 'gob')
  await screen.findByText('gobuster')
  await userEvent.keyboard('{Enter}')
  expect(location.hash).toBe('#/tools?tool=2')
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await userEvent.type(await screen.findByRole('combobox'), 'gob')
  await screen.findByText('Basic usage')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(location.hash).toBe('#/tools?cmd=7')
})

test('a mousedown on the dialog padding keeps focus in the input; one on the input does not block the caret', async () => {
  setup()
  const input = await screen.findByRole('combobox')
  expect(fireEvent.mouseDown(screen.getByRole('dialog'))).toBe(false) // default prevented: no blur
  expect(fireEvent.mouseDown(input)).toBe(true)
})

test('Esc and Enter during IME composition belong to the IME, not the palette', async () => {
  setup()
  const input = await screen.findByRole('combobox')
  await userEvent.type(input, 'smb')
  await screen.findByText('Foothold')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(window, { key: 'Escape', isComposing: true })
  expect(location.hash).toBe('')
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test.each([[null, '#/techniques?cmd=8'], [2, '#/tools?cmd=8']])('command hit with toolId %s opens %s', async (toolId, hash) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ kind: 'command', id: 8, boxId: null, hostId: null, toolId, title: 'ping', snippet: '' }]))))
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await userEvent.type(await screen.findByRole('combobox'), 'pin')
  await screen.findByText('ping')
  await userEvent.keyboard('{Enter}')
  expect(location.hash).toBe(hash)
})

const palette = (body: unknown[]) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
}
const tech = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'technique', id: i + 1, boxId: null, hostId: null, toolId: null, title: `T${i + 1}`, snippet: '', total: n }))

test('shows a Pages group first and navigates; enter on a page row navigates', async () => {
  palette([{ kind: 'technique', id: 1, boxId: null, hostId: null, toolId: null, title: 'Shell upgrade', snippet: '', total: 1 }])
  await userEvent.type(await screen.findByRole('combobox'), 'reverse shell')
  await screen.findByText('Shell upgrade')
  expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Pages', 'Techniques (1)'])
  expect(screen.getByRole('option', { name: 'Reverse shells' })).toBeTruthy()
  await userEvent.keyboard('{Enter}')
  expect(location.hash).toBe('#/shells')
})

test('group headings show totals and top 5', async () => {
  palette(tech(12))
  await userEvent.type(await screen.findByRole('combobox'), 'kerb')
  expect(await screen.findByText('Techniques (12)')).toBeTruthy()
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'Show all 12'])
})

test('show all expands in place and keeps selection', async () => {
  palette(tech(12))
  await userEvent.type(await screen.findByRole('combobox'), 'kerb')
  await screen.findByText('Show all 12')
  await userEvent.keyboard('{ArrowDown>5/}{Enter}')
  expect(screen.getAllByRole('option')).toHaveLength(12)
  expect(screen.queryByText('Show all 12')).toBeNull()
  expect(screen.getByRole('option', { selected: true }).textContent).toBe('T6')
  await userEvent.type(screen.getByRole('combobox'), 'x') // a new query collapses the group again
  expect(await screen.findByText('Show all 12')).toBeTruthy()
})

test('groups ordered by best match', async () => {
  palette([{ kind: 'tool', id: 2, boxId: null, hostId: null, toolId: null, title: 'gobuster', snippet: '', total: 1 }, ...tech(2)])
  await userEvent.type(await screen.findByRole('combobox'), 'gob')
  await screen.findByText('gobuster')
  expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Tools (1)', 'Techniques (2)'])
})

test('page match with no server hits shows no "No matches."', async () => {
  palette([])
  await userEvent.type(await screen.findByRole('combobox'), 'msfvenom')
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
  await new Promise((r) => setTimeout(r, 20))
  expect(screen.getByRole('option', { name: 'Reverse shells' })).toBeTruthy()
  expect(screen.queryByText('No matches.')).toBeNull()
})

test('the palette asks for 50 per kind', async () => {
  palette([])
  await userEvent.type(await screen.findByRole('combobox'), 'zz')
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('&limit=50')
})

test('aria-activedescendant follows the selected row key, so it changes after Show all', async () => {
  palette(tech(12))
  const input = await screen.findByRole('combobox')
  await userEvent.type(input, 'kerb')
  await screen.findByText('Show all 12')
  await userEvent.keyboard('{ArrowDown>5/}')
  const before = input.getAttribute('aria-activedescendant')
  await userEvent.keyboard('{Enter}')
  expect(input.getAttribute('aria-activedescendant')).not.toBe(before)
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('T6')
})

test('the selected row is scrolled into view', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  try {
    palette(tech(3))
    await userEvent.type(await screen.findByRole('combobox'), 'kerb')
    await screen.findByText('T1')
    scroll.mockClear()
    await userEvent.keyboard('{ArrowDown}')
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  } finally { delete (Element.prototype as any).scrollIntoView }
})

test('Show label says "N of M" when the server capped the list', async () => {
  palette(tech(12).map((h) => ({ ...h, total: 60 })))
  await userEvent.type(await screen.findByRole('combobox'), 'kerb')
  expect(await screen.findByText('Show 12 of 60')).toBeTruthy()
})

test('a result arriving does not reset a selection made on a Pages row', async () => {
  let resolve!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { resolve = res })))
  render(<SearchPalette />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await userEvent.type(await screen.findByRole('combobox'), 'loot tools')
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
  await userEvent.keyboard('{ArrowDown}')
  expect(screen.getByRole('option', { selected: true }).textContent).toBe('Tools and commands')
  resolve(new Response(JSON.stringify(tech(2))))
  await screen.findByText('T1')
  expect(screen.getByRole('option', { selected: true }).textContent).toBe('Tools and commands')
})

test('clicking Show all expands; clicking a Pages row navigates', async () => {
  palette(tech(12))
  await userEvent.type(await screen.findByRole('combobox'), 'shell')
  await userEvent.click(await screen.findByText('Show all 12'))
  expect(screen.getAllByRole('option', { name: /^T\d+$/ })).toHaveLength(12)
  await userEvent.click(screen.getByRole('option', { name: 'Reverse shells' }))
  expect(location.hash).toBe('#/shells')
})

test('a string detail on slingsh0t:search opens prefilled; null or a plain Event opens empty', async () => {
  setup()
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent(window, new CustomEvent('slingsh0t:search', { detail: 'smb' }))
  expect(((await screen.findByRole('combobox')) as HTMLInputElement).value).toBe('smb')
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent(window, new CustomEvent('slingsh0t:search', { detail: null }))
  expect(((await screen.findByRole('combobox')) as HTMLInputElement).value).toBe('')
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent(window, new Event('slingsh0t:search'))
  expect(((await screen.findByRole('combobox')) as HTMLInputElement).value).toBe('')
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  expect(((await screen.findByRole('combobox')) as HTMLInputElement).value).toBe('')
})

test('choosing a result with a query records the search; an empty query records nothing', async () => {
  const fetchMock = setup()
  const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit?][]
  const input = await screen.findByRole('combobox')
  await userEvent.type(input, ' smb ')
  await screen.findByText('Foothold')
  await userEvent.keyboard('{Enter}')
  const posts = () => calls().filter(([, i]) => i?.method === 'POST')
  await waitFor(() => expect(posts()).toHaveLength(1))
  expect(posts()[0][0]).toBe('/api/recents')
  expect(JSON.parse(posts()[0][1]!.body as string)).toEqual({ kind: 'search', ref: 'smb', label: 'smb' })
})
