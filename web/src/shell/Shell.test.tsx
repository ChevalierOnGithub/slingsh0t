// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { reportLost } from '../autosave'
import { ContextProvider } from './TargetBar'
import { Shell } from './Shell'

afterEach(() => { vi.unstubAllGlobals(); location.hash = ''; localStorage.clear() })

test('sidebar refetches stats on the slingsh0t:stats event', async () => {
  const stats = { boxes: 1, techniques: 0, tools: 0, writeups: 0, reference: 0,
    rooted: { HTB: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }, THM: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 } },
    inProgress: { HTB: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }, THM: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 } },
    totals: { HTB: { rooted: 0, total: 1 }, THM: { rooted: 0, total: 0 } } }
  const fetchMock = vi.fn(async (url: string) =>
    new Response(JSON.stringify(url === '/api/stats' ? stats : url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null } : [])))
  vi.stubGlobal('fetch', fetchMock)
  location.hash = '#/loot'
  const statsCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/stats').length
  const { findByText } = render(<ContextProvider><Shell /></ContextProvider>)
  expect(await findByText('1', { selector: 'a.nav span' })).toBeTruthy()
  expect(statsCalls()).toBe(1)

  stats.boxes = 7
  act(() => { dispatchEvent(new Event('slingsh0t:stats')) })
  expect(await findByText('7', { selector: 'a.nav span' })).toBeTruthy()
  await waitFor(() => expect(statsCalls()).toBe(2))
})

test('nav shows Networks and Loot counts and highlights Networks on host and network pages', async () => {
  const stats = { boxes: 1, networks: 2, loot: 5, techniques: 0, tools: 0, writeups: 0, reference: 0,
    rooted: { HTB: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }, THM: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 } },
    inProgress: { HTB: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }, THM: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 } },
    totals: { HTB: { rooted: 0, total: 1 }, THM: { rooted: 0, total: 0 } } }
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url === '/api/stats' ? new Response(JSON.stringify(stats))
      : url === '/api/context' ? new Response(JSON.stringify({ target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null }))
      : new Response(JSON.stringify({ error: 'not found' }), { status: 404 })))
  location.hash = '#/hosts/4'
  const { findByRole } = render(<ContextProvider><Shell /></ContextProvider>)
  const networks = await findByRole('link', { name: /^Networks\s*2$/ })
  expect(networks.getAttribute('aria-current')).toBe('page')
  expect((await findByRole('link', { name: /^Loot\s*5$/ })).getAttribute('aria-current')).toBeNull()
  act(() => { location.hash = '#/networks/4'; dispatchEvent(new HashChangeEvent('hashchange')) })
  await waitFor(() => expect(networks.getAttribute('aria-current')).toBe('page'))
})

const T = { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }
const STATS = { boxes: 0, networks: 0, loot: 0, techniques: 0, tools: 0, writeups: 0, reference: 0,
  rooted: { HTB: T, THM: T }, inProgress: { HTB: T, THM: T }, totals: { HTB: { rooted: 0, total: 0 }, THM: { rooted: 0, total: 0 } } }

const HOME = { working: null, unfinished: [], rootedThisWeek: 0, next: { difficulty: 'Easy', reason: '', boxes: [] }, networks: [], networksNotStarted: 0,
  techniques: [], deadEnds: [], writeups: { items: [], more: 0 }, recents: [], searches: [] }
const homeFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
  url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null } : url === '/api/stats' ? STATS : url === '/api/home' ? HOME : []))))

test('the Boxes list has one aria-current="page": the view link; Boxes itself is "true"', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null } : url === '/api/stats' ? STATS : []))))
  location.hash = '#/boxes?view=board'
  const { findByRole, container } = render(<ContextProvider><Shell /></ContextProvider>)
  expect((await findByRole('link', { name: 'Board' })).getAttribute('aria-current')).toBe('page')
  expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  expect((await findByRole('link', { name: /^Boxes/ })).getAttribute('aria-current')).toBe('true')
})

test('shows a lost-edit message until dismissed', async () => {
  homeFetch()
  render(<ContextProvider><Shell /></ContextProvider>)
  act(() => reportLost('notes', 'offline'))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Your last edit to notes was not saved: offline')
  act(() => { location.hash = '#/loot'; dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(screen.getByText(/Your last edit to notes/)).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss: Your last edit to notes was not saved: offline' }))
  expect(screen.queryByText(/Your last edit to notes/)).toBeNull()
})

test('Credits is not in the nav but #/credits still opens it (licence notices)', async () => {
  homeFetch()
  const { container } = render(<ContextProvider><Shell /></ContextProvider>)
  const links = [...container.querySelectorAll('nav.rail a.nav')].map((a) => a.textContent)
  expect(links).not.toContain('Credits')
  act(() => { location.hash = '#/credits'; dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(await screen.findByRole('heading', { name: 'Credits', level: 1 })).toBeTruthy()
})

test('Home is the first rail link and current on #/home; the rail no longer carries the rooted tally', async () => {
  homeFetch()
  location.hash = '#/home'
  const { container } = render(<ContextProvider><Shell /></ContextProvider>)
  const first = container.querySelector('nav.rail a.nav') as HTMLAnchorElement
  expect(first.textContent).toBe('Home')
  expect(first.getAttribute('href')).toBe('#/home')
  expect(first.getAttribute('aria-current')).toBe('page')
  expect(container.querySelector('nav.rail')!.textContent).not.toContain('rooted')
})

test('the rail toggles collapsed, hides its links, and remembers it', async () => {
  homeFetch()
  const { container } = render(<ContextProvider><Shell /></ContextProvider>)
  const btn = screen.getByRole('button', { name: 'Collapse menu' })
  expect(btn.getAttribute('aria-expanded')).toBe('true')
  expect(btn.getAttribute('aria-controls')).toBe(container.querySelector('.navs')!.id)
  await userEvent.click(btn)
  const open = screen.getByRole('button', { name: 'Expand menu' })
  expect(open.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('link', { name: 'Home' })).toBeNull()
  expect(localStorage.getItem('slingsh0t:rail')).toBe('collapsed')
  await userEvent.click(open)
  expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
  expect(localStorage.getItem('slingsh0t:rail')).toBeNull()
})

test('a stored collapsed flag starts the rail collapsed; failing storage falls back to expanded and still toggles', async () => {
  homeFetch()
  localStorage.setItem('slingsh0t:rail', 'collapsed')
  const first = render(<ContextProvider><Shell /></ContextProvider>)
  expect(screen.getByRole('button', { name: 'Expand menu' })).toBeTruthy()
  first.unmount()
  localStorage.clear()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  render(<ContextProvider><Shell /></ContextProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Collapse menu' }))
  expect(screen.getByRole('button', { name: 'Expand menu' })).toBeTruthy()
  vi.restoreAllMocks()
})
