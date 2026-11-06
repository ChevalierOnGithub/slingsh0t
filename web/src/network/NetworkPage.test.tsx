// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NetworkDetail } from '../../../shared/types'
import { ContextProvider } from '../shell/TargetBar'
import { NetworkPage } from './NetworkPage'

const net: NetworkDetail = {
  id: 1, shortId: 'N-001', platform: 'HTB', name: 'Dante', hostsInScope: 14, flagsInScope: 26,
  hostsFound: 2, hostsOwned: 1, flagsCaptured: 3, credentials: 4, url: '', entry: '', tags: ['Active Directory'], notes: 'start at the web box',
  hosts: [
    { id: 5, shortId: 'HS-001', name: 'NIX01', os: 'Linux', status: 'rooted', ips: [{ id: 1, ip: '10.10.110.100', primary: true }, { id: 2, ip: '172.16.1.100', primary: false }] },
    { id: 6, shortId: 'HS-002', name: 'DC01', os: 'Windows', status: 'not_started', ips: [{ id: 3, ip: '172.16.1.20', primary: true }] },
  ],
  subnets: [{ id: 10, cidr: '10.10.110.0/24' }, { id: 20, cidr: '172.16.1.0/24' }],
  pivots: [{ id: 1, fromHostId: 5, subnetId: 20, method: 'ligolo-ng', note: '' }],
}

let fetchMock: ReturnType<typeof vi.fn>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const calls = (method: string) => fetchMock.mock.calls.filter(([u, i]) => u !== '/api/recents' && (i?.method ?? 'GET') === method) // the recents write is covered elsewhere

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/context') return json({ target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: 6, via: null })
    if (url === '/api/networks/1' && init?.method === 'GET') return json(net)
    if (url.startsWith('/api/credentials') || url.startsWith('/api/flags')) return json([])
    return json({}, init?.method === 'POST' ? 201 : 200)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); location.hash = '' })

const setup = () => render(<ContextProvider><NetworkPage id={1} /></ContextProvider>)

test('header shows the network stats from the detail', async () => {
  setup()
  expect(await screen.findByRole('heading', { name: 'Dante' })).toBeTruthy()
  const stat = (label: string) => within(screen.getByText(label, { selector: 'dt' }).parentElement!).getByRole('definition').textContent
  expect(stat('Hosts owned')).toBe('1of 2 found14 in scope')
  expect(stat('Flags captured')).toBe('3of 26 in scope')
  expect(stat('Credentials')).toBe('4')
  expect(screen.getByText('N-001')).toBeTruthy()
  expect(screen.getByText('Active Directory')).toBeTruthy()
})

test('hosts tab lists hosts with IPs, pivot badge and a link; adding a host posts its IPs and refreshes counts', async () => {
  setup()
  await userEvent.click(await screen.findByRole('tab', { name: 'Hosts' }))
  const row = screen.getByRole('link', { name: 'NIX01' }).closest('tr')!
  expect(screen.getByRole('link', { name: 'NIX01' }).getAttribute('href')).toBe('#/hosts/5')
  expect(within(row).getByText('172.16.1.100')).toBeTruthy()
  expect(within(row).getByText('pivot')).toBeTruthy()

  const onStats = vi.fn()
  addEventListener('slingsh0t:stats', onStats)
  await userEvent.type(screen.getByLabelText('Host name'), 'WS01')
  await userEvent.type(screen.getByLabelText('IP addresses'), '172.16.1.30, 10.10.110.30')
  await userEvent.click(screen.getByRole('button', { name: 'Add host' }))
  await waitFor(() => expect(onStats).toHaveBeenCalled())
  removeEventListener('slingsh0t:stats', onStats)
  const [url, init] = calls('POST')[0]
  expect(url).toBe('/api/networks/1/hosts')
  expect(JSON.parse(init.body)).toEqual({ name: 'WS01', os: '', ips: ['172.16.1.30', '10.10.110.30'] })
  await waitFor(() => expect(calls('GET').filter(([u]) => u === '/api/networks/1')).toHaveLength(2))
  // The busy-disabled button drops focus; the form hands it back to its first field for the next entry.
  expect(document.activeElement).toBe(screen.getByLabelText('Host name'))
})

test('subnets and pivots are added from the hosts tab', async () => {
  setup()
  await userEvent.click(await screen.findByRole('tab', { name: 'Hosts' }))
  await userEvent.type(screen.getByLabelText('Subnet CIDR'), '172.16.2.0/24')
  await userEvent.click(screen.getByRole('button', { name: 'Add subnet' }))
  await userEvent.selectOptions(screen.getByLabelText('Pivot host'), 'DC01')
  await userEvent.selectOptions(screen.getByLabelText('Reaches subnet'), '10.10.110.0/24')
  await userEvent.type(screen.getByLabelText('Method'), 'chisel')
  await userEvent.click(screen.getByRole('button', { name: 'Add pivot' }))
  await waitFor(() => expect(calls('POST')).toHaveLength(2))
  expect(calls('POST').map(([u, i]) => [u, JSON.parse(i.body)])).toEqual([
    ['/api/networks/1/subnets', { cidr: '172.16.2.0/24' }],
    ['/api/pivots', { fromHostId: 6, subnetId: 10, method: 'chisel', note: '' }],
  ])
  expect(screen.getByText('NIX01 reaches 172.16.1.0/24 via ligolo-ng')).toBeTruthy()
})

test('notes are saved when the page unmounts', async () => {
  const { unmount } = setup()
  await userEvent.click(await screen.findByRole('tab', { name: 'Notes' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), ', then DC01')
  unmount()
  await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
  expect(calls('PATCH')[0][0]).toBe('/api/networks/1')
  expect(JSON.parse(calls('PATCH')[0][1].body)).toEqual({ notes: 'start at the web box, then DC01' })
})

test('Edit network PATCHes name, platform, in-scope counts and tags', async () => {
  setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit network' }))
  const hosts = screen.getByLabelText('Hosts in scope')
  await userEvent.clear(hosts)
  await userEvent.type(hosts, '15')
  await userEvent.type(screen.getByLabelText('Other tags'), 'Pro Lab')
  await userEvent.type(screen.getByLabelText('Entry point'), 'VPN')
  await userEvent.click(screen.getByRole('button', { name: 'Save network' }))
  await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
  expect(calls('PATCH')[0][0]).toBe('/api/networks/1')
  expect(JSON.parse(calls('PATCH')[0][1].body)).toEqual({
    platform: 'HTB', name: 'Dante', hostsInScope: 15, flagsInScope: 26, tags: ['Active Directory', 'Pro Lab'], entry: 'VPN',
  })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save network' })).toBeNull())
})

test('Delete network asks first, then deletes and goes back to the list', async () => {
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Delete network' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Dante'))
  expect(calls('DELETE')).toHaveLength(0)
  const hashAtStats: string[] = []
  const onStats = () => hashAtStats.push(location.hash)
  addEventListener('slingsh0t:stats', onStats)
  const gets = calls('GET').filter(([u]) => u === '/api/networks/1').length
  confirm.mockReturnValue(true)
  await userEvent.click(screen.getByRole('button', { name: 'Delete network' }))
  await waitFor(() => expect(location.hash).toBe('#/networks'))
  await new Promise((r) => setTimeout(r, 20))
  removeEventListener('slingsh0t:stats', onStats)
  expect(calls('DELETE').map(([u]) => u)).toEqual(['/api/networks/1'])
  expect(hashAtStats).toEqual(['#/networks']) // navigated first
  expect(calls('GET').filter(([u]) => u === '/api/networks/1')).toHaveLength(gets) // the deleted network is not reloaded
})

test('double-clicking Add host posts once', async () => {
  // Hold the POST open so the second click lands while the first is in flight.
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'POST' && (await held), base(url, init)))
  setup()
  await userEvent.click(await screen.findByRole('tab', { name: 'Hosts' }))
  await userEvent.type(screen.getByLabelText('Host name'), 'WS01')
  await userEvent.type(screen.getByLabelText('IP addresses'), '172.16.1.30')
  await userEvent.dblClick(screen.getByRole('button', { name: 'Add host' }))
  release()
  await waitFor(() => expect(calls('GET').filter(([u]) => u === '/api/networks/1')).toHaveLength(2))
  expect(calls('POST')).toHaveLength(1)
})

test('a failed add host keeps the typed input and shows the error at that form', async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === 'POST' ? json({ error: 'duplicate ip' }, 400)
      : url === '/api/networks/1' ? json(net)
      : url === '/api/context' ? json({ target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null })
      : json([]))
  setup()
  await userEvent.click(await screen.findByRole('tab', { name: 'Hosts' }))
  await userEvent.type(screen.getByLabelText('Host name'), 'WS01')
  await userEvent.type(screen.getByLabelText('IP addresses'), '172.16.1.30 172.16.1.30')
  await userEvent.click(screen.getByRole('button', { name: 'Add host' }))
  const form = screen.getByRole('button', { name: 'Add host' }).closest('form')!
  expect((await within(form).findByRole('alert')).textContent).toBe('duplicate ip')
  expect((screen.getByLabelText('Host name') as HTMLInputElement).value).toBe('WS01')
  expect((screen.getByLabelText('IP addresses') as HTMLInputElement).value).toBe('172.16.1.30 172.16.1.30')
  expect(within(screen.getByRole('button', { name: 'Add subnet' }).closest('form')!).queryByRole('alert')).toBeNull()
})

test('the header links to the network Report', async () => {
  setup()
  expect((await screen.findByRole('link', { name: 'Report' })).getAttribute('href')).toBe('#/writeups/network/1')
})
