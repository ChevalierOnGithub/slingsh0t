// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Home, Stats } from '../../../shared/types'
import { HomePage } from './HomePage'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const recent = new Date(Date.now() - 3 * 3600_000).toISOString()

const stats: Stats = {
  boxes: 40, techniques: 0, tools: 0, writeups: 0, reference: 0, networks: 2, loot: 0,
  rooted: { HTB: { Easy: 20, Medium: 5, Hard: 2, Insane: 0 }, THM: { Easy: 9, Medium: 3, Hard: 1, Insane: 1 } },
  inProgress: { HTB: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 }, THM: { Easy: 0, Medium: 0, Hard: 0, Insane: 0 } },
  totals: { HTB: { rooted: 27, total: 512 }, THM: { rooted: 14, total: 900 } },
}

const full: Home = {
  working: {
    kind: 'box', id: 7, name: 'Lanternfish', status: 'in_progress', platform: 'HTB', difficulty: 'Medium', os: 'Linux',
    network: null, totalSeconds: 8040, lastWorked: recent, currentPhase: 'Initial Access', persistence: false, stepNumber: 4,
    step: { saw: 'Login page on 8080', think: 'Known issue for 2.3?', tried: 'default creds', got: '' },
    openThreads: 'backup.zip in /static',
  },
  unfinished: [
    { kind: 'box', id: 8, name: 'Copperline', platform: 'HTB', difficulty: 'Easy', status: 'user_flag', currentPhase: 'PrivEsc', persistence: true, hosts: null, lastWorked: recent },
    { kind: 'network', id: 3, name: 'Dante', platform: 'HTB', difficulty: null, status: null, currentPhase: null, persistence: false, hosts: { rooted: 7, total: 27 }, lastWorked: null },
  ],
  rootedThisWeek: 2,
  next: { difficulty: 'Medium', reason: '8 Medium rooted against 29 Easy', boxes: [
    { id: 21, name: 'Ironvale', platform: 'HTB', os: 'Linux' }, { id: 22, name: 'Saltmarsh', platform: 'THM', os: 'Windows' }, { id: 23, name: 'Wickerton', platform: 'HTB', os: 'Linux' },
  ] },
  networks: [{ id: 3, name: 'Dante', hostsRooted: 7, hostsTotal: 27, flags: 9 }],
  networksNotStarted: 4,
  techniques: [{ id: 11, name: 'Default credentials', count: 3 }],
  deadEnds: [{ stepId: 55, kind: 'host', ownerId: 9, owner: 'WEB01', text: 'Brute-forcing the login' }, { stepId: 56, kind: 'box', ownerId: 7, owner: 'Lanternfish', text: 'Kernel guess' }],
  writeups: { items: [{ id: 30, name: 'Brightwater' }], more: 6 },
  recents: [
    { kind: 'box', ref: '1', label: 'R box', openedAt: recent },
    { kind: 'host', ref: '2', label: 'R host', openedAt: recent },
    { kind: 'network', ref: '3', label: 'R network', openedAt: recent },
    { kind: 'writeup', ref: '4', label: 'R writeup', openedAt: recent },
    { kind: 'network-writeup', ref: '5', label: 'R network writeup', openedAt: recent },
    { kind: 'reference', ref: '6', label: 'R reference', openedAt: recent },
  ],
  searches: ['smb shares', 'port forward'],
}

const empty: Home = {
  working: null, unfinished: [], rootedThisWeek: 0,
  next: { difficulty: 'Easy', reason: '0 Easy rooted', boxes: [] },
  networks: [], networksNotStarted: 0, techniques: [], deadEnds: [], writeups: { items: [], more: 0 }, recents: [], searches: [],
}

const serve = (home: Home) => vi.stubGlobal('fetch', vi.fn(async (url: string) => json(200, url.endsWith('/api/stats') ? stats : home)))
const link = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
const TITLES = ['Working on', 'Rooted', 'Also unfinished', 'Next', 'Learned', 'Recently opened', 'Networks',
  'Techniques used lately', 'Dead ends this month', 'Writeups to finish']

test('full dashboard: working box, rooted tally, next, learned and recents', async () => {
  serve(full)
  render(<HomePage />)
  const work = (await screen.findByRole('heading', { name: 'Working on' })).closest('section')!
  expect(within(work).getByRole('heading', { name: 'Lanternfish' })).toBeTruthy()
  expect(within(work).getByText('Medium')).toBeTruthy()
  expect(within(work).getByText(/Initial Access · step 4 · 2h 14m spent · last worked 3h ago/)).toBeTruthy()
  const phases = within(work).getByRole('list', { name: 'Phase: Initial Access' }).children
  expect([...phases].map((li) => `${li.textContent}:${li.className}`)).toEqual(['Recon:done', 'Initial Access:now', 'PrivEsc:', 'Lateral Movement:', 'Root:'])
  for (const [k, v] of [['Saw', 'Login page on 8080'], ['Think', 'Known issue for 2.3?'], ['Tried', 'default creds'], ['Got', 'nothing yet']]) {
    expect(within(work).getByText(k).nextElementSibling!.textContent).toBe(v)
  }
  expect(within(work).getByText('Open threads:').parentElement!.textContent).toBe('Open threads: backup.zip in /static')
  expect(link('Resume')).toBe('#/boxes/7')
  expect(link('Notes')).toBe('#/boxes/7?tab=Notes')

  const rooted = screen.getByRole('heading', { name: 'Rooted' }).closest('section')!
  expect(within(rooted).getByText('41')).toBeTruthy()
  const bars = within(within(rooted).getByRole('list', { name: 'Rooted by difficulty' })).getAllByRole('listitem')
  expect(bars.map((b) => b.textContent)).toEqual(['Easy29', 'Medium8', 'Hard3', 'Insane1'])
  expect(within(rooted).getByText('HTB 27/512')).toBeTruthy()
  expect(within(rooted).getByText('THM 14/900')).toBeTruthy()
  expect(within(rooted).getByText('2 this week')).toBeTruthy()

  expect(link('Copperline')).toBe('#/boxes/8')
  expect(screen.getAllByRole('list', { name: 'Phase: PrivEsc' })[0].children).toHaveLength(6) // Persistence shown
  const netRow = screen.getByRole('link', { name: 'Dante' }).closest('li')!
  expect(screen.getByRole('link', { name: 'Dante' }).getAttribute('href')).toBe('#/networks/3')
  expect(netRow.textContent).toContain('7 / 27 hosts')
  expect(within(netRow).queryByRole('list', { name: /^Phase:/ })).toBeNull() // hosts bar instead of phases
  expect((netRow.querySelector('.home-hostbar') as HTMLElement).style.getPropertyValue('--w')).toBe(`${(7 / 27) * 100}%`)

  const gap = screen.getByRole('heading', { name: 'Fill the gap: Medium' }).closest('section')!
  expect(within(gap).getByText('8 Medium rooted against 29 Easy')).toBeTruthy()
  expect(within(gap).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/boxes/21', '#/boxes/22', '#/boxes/23'])

  const nets = screen.getByRole('heading', { name: 'Networks' }).closest('section')!
  expect(within(nets).getByRole('link', { name: /Dante/ }).getAttribute('href')).toBe('#/networks/3')
  expect(within(nets).getByText('4 networks not started')).toBeTruthy()

  expect(link('Default credentials 3 targets')).toBe('#/techniques?t=11')
  expect(link('Brute-forcing the login · WEB01')).toBe('#/hosts/9?step=55')
  expect(link('Kernel guess · Lanternfish')).toBe('#/boxes/7?step=56')
  expect(link('Brightwater')).toBe('#/writeups/30')
  expect(screen.getByText('+6 more')).toBeTruthy()

  const opened = screen.getByRole('heading', { name: 'Recently opened' }).closest('section')!
  expect(within(opened).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(
    ['#/boxes/1', '#/hosts/2', '#/networks/3', '#/writeups/4', '#/writeups/network/5', '#/reference/6'])
  expect(within(opened).getAllByText('3h ago')).toHaveLength(6)
})

test('a host as the working item links to the host and names its network', async () => {
  serve({ ...full, working: { ...full.working!, kind: 'host', id: 9, name: 'WEB01', platform: 'HTB', difficulty: null, network: 'Dante', currentPhase: null, stepNumber: null, step: null } })
  render(<HomePage />)
  const work = (await screen.findByRole('heading', { name: 'Working on' })).closest('section')!
  expect(within(work).getByText('Dante')).toBeTruthy()
  expect(within(work).queryByText(/^(Easy|Medium|Hard|Insane)$/)).toBeNull()
  expect(within(work).getByRole('list', { name: 'Phase: not started' })).toBeTruthy()
  expect(link('Resume')).toBe('#/hosts/9')
  expect(link('Notes')).toBe('#/hosts/9?tab=Notes')
})

test('empty dashboard keeps every panel and offers Boxes', async () => {
  serve(empty)
  render(<HomePage />)
  expect(await screen.findByText(/Nothing on the go/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Browse boxes' }).getAttribute('href')).toBe('#/boxes')
  for (const t of [...TITLES, 'Fill the gap: Easy']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Resume' })).toBeNull()
})

test('search field and recent-search chips open the palette', async () => {
  serve(full)
  const onSearch = vi.fn()
  addEventListener('slingsh0t:search', onSearch)
  render(<HomePage />)
  await userEvent.click(await screen.findByRole('button', { name: 'port forward' }))
  expect((onSearch.mock.calls[0][0] as CustomEvent).detail).toBe('port forward')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect((onSearch.mock.calls[1][0] as CustomEvent).detail).toBeNull()
  removeEventListener('slingsh0t:search', onSearch)
})

test('a failed load shows the error instead of the panels', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/home') ? json(500, { error: 'db locked' }) : json(200, stats)))
  render(<HomePage />)
  expect((await screen.findByRole('alert')).textContent).toBe('db locked')
  expect(screen.queryByRole('heading', { name: 'Working on' })).toBeNull()
})
