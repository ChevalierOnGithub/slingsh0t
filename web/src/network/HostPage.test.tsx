// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HostDetail } from '../../../shared/types'
import { HostPage } from './HostPage'

vi.mock('../box/Editor', () => ({ Editor: () => null }))
const ctx = vi.hoisted(() => ({ target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null as number | null, via: null }))
vi.mock('../shell/TargetBar', () => ({ useTargetContext: () => ({ ctx, update: vi.fn(), error: null }) }))
afterEach(() => { vi.unstubAllGlobals(); location.hash = '' })

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const host: HostDetail = {
  id: 3, kind: 'host', shortId: 'HS-003', networkId: 2, name: 'DC01', os: 'Windows', status: 'in_progress', tags: [], nextStep: '', notes: '', foothold: '', privesc: '', rating: '', dns: '',
  targetIp: '10.10.110.5', ips: [{ id: 1, ip: '10.10.110.5', primary: true }, { id: 2, ip: '172.16.1.5', primary: false }], uses: [], services: [], haves: [],
  steps: [{ id: 21, boxId: null, hostId: 3, phase: 'Recon', position: 0, body: 'nmap {{TARGET}}', seconds: 0, timerStartedAt: null, done: false, saw: '', think: '', tried: '', got: '', dead: false }],
}
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    json(init?.method === 'PATCH' ? host : url === '/api/hosts/3' ? host : url === '/api/networks/2' ? { id: 2, name: 'Dante' } : { phases: [] }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

test('renders the host steps and requests the toolbox with hostId', async () => {
  Object.assign(ctx, { target: '172.16.1.5', activeHostId: 3 })
  render(<HostPage id={3} />)
  expect(await screen.findByRole('heading', { name: 'DC01' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Collapse Recon 1' })).toBeTruthy()
  // The active host takes the bar's TARGET, here its secondary IP.
  expect(screen.getByText('nmap 172.16.1.5')).toBeTruthy()
  expect((await screen.findByRole('link', { name: 'Dante' })).getAttribute('href')).toBe('#/networks/2')
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/toolbox?hostId=3', expect.anything()))
})

test('TARGET falls back to the host primary IP when another host is active', async () => {
  Object.assign(ctx, { target: '10.99.99.99', activeHostId: 9 })
  render(<HostPage id={3} />)
  expect(await screen.findByText('nmap 10.10.110.5')).toBeTruthy()
})

test('host notes save to /api/hosts/:id', async () => {
  render(<HostPage id={3} />)
  await userEvent.click(await screen.findByRole('tab', { name: 'Notes' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'admin:hunter2')
  await userEvent.tab()
  const saves = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH')
  await waitFor(() => expect(saves()).toHaveLength(1))
  expect(saves()[0][0]).toBe('/api/hosts/3')
  expect(JSON.parse(saves()[0][1].body)).toEqual({ notes: 'admin:hunter2' })
})

test('Delete host asks first, then deletes and opens its network', async () => {
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  render(<HostPage id={3} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Delete host' }))
  expect(confirm).toHaveBeenCalledWith("Delete DC01 with its steps, IPs, pivots and credential results? This can't be undone.")
  const deletes = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'DELETE').map(([u]) => u)
  expect(deletes()).toEqual([])
  const onStats = vi.fn()
  addEventListener('slingsh0t:stats', onStats)
  confirm.mockReturnValue(true)
  await userEvent.click(screen.getByRole('button', { name: 'Delete host' }))
  await waitFor(() => expect(location.hash).toBe('#/networks/2'))
  removeEventListener('slingsh0t:stats', onStats)
  expect(deletes()).toEqual(['/api/hosts/3'])
  expect(onStats).toHaveBeenCalled()
})

test('the last IP has no Remove button (a host keeps at least one IP)', async () => {
  render(<HostPage id={3} />)
  expect(await screen.findByRole('button', { name: 'Remove 172.16.1.5' })).toBeTruthy()
  cleanup()
  fetchMock.mockImplementation(async (url: string) =>
    json(url === '/api/hosts/3' ? { ...host, ips: [host.ips[0]] } : url === '/api/networks/2' ? { id: 2, name: 'Dante' } : { phases: [] }))
  render(<HostPage id={3} />)
  await screen.findByRole('heading', { name: 'DC01' })
  expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
})

test('?tab=Report opens the lazily mounted Report panel on first load', async () => {
  location.hash = '#/hosts/3?tab=Report'
  render(<HostPage id={3} />)
  await screen.findByRole('heading', { name: 'DC01' })
  const panel = document.getElementById('work-panel-Report')!
  expect(panel).toBeTruthy()
  expect(panel.hidden).toBe(false)
})
