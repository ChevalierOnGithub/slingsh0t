// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { reportLost } from '../autosave'
import { ContextProvider } from './TargetBar'
import { Shell } from './Shell'

afterEach(() => { vi.unstubAllGlobals(); location.hash = '' })

test('sidebar refetches stats on the slingsh0t:stats event', async () => {
  const stats = { boxes: 1, techniques: 0, tools: 0, writeups: 0, reference: 0,
    rooted: { HTB: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }, THM: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 } },
    inProgress: { HTB: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }, THM: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 } },
    totals: { HTB: { rooted: 0, total: 1 }, THM: { rooted: 0, total: 0 } } }
  const fetchMock = vi.fn(async (url: string) =>
    new Response(JSON.stringify(url === '/api/stats' ? stats : url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null } : [])))
  vi.stubGlobal('fetch', fetchMock)
  const statsCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/stats').length
  const { findByText } = render(<ContextProvider><Shell /></ContextProvider>)
  expect(await findByText('HTB 0/1')).toBeTruthy()
  expect(statsCalls()).toBe(1)

  stats.totals.HTB.rooted = 1
  act(() => { dispatchEvent(new Event('slingsh0t:stats')) })
  expect(await findByText('HTB 1/1')).toBeTruthy()
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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null } : url === '/api/stats' ? STATS : []))))
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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null } : url === '/api/stats' ? STATS : []))))
  const { container } = render(<ContextProvider><Shell /></ContextProvider>)
  const links = [...container.querySelectorAll('nav.rail a.nav')].map((a) => a.textContent)
  expect(links).not.toContain('Credits')
  act(() => { location.hash = '#/credits'; dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(await screen.findByRole('heading', { name: 'Credits', level: 1 })).toBeTruthy()
})
