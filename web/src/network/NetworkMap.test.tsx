// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NetworkDetail } from '../../../shared/types'
import { NetworkMap } from './NetworkMap'


const base: NetworkDetail = {
  id: 1, shortId: 'N-001', platform: 'HTB', name: 'Lab', hostsInScope: null, flagsInScope: null,
  hostsFound: 0, hostsOwned: 0, flagsCaptured: 0, credentials: 0, url: '', tags: [], notes: '', entry: '',
  hosts: [], subnets: [], pivots: [],
}
const lab: NetworkDetail = {
  ...base,
  hosts: [
    { id: 1, shortId: 'HS-001', name: 'NIX01', os: 'Linux', status: 'rooted', ips: [
      { id: 1, ip: '10.10.110.100', primary: true }, { id: 2, ip: '172.16.1.100', primary: false }] },
    { id: 2, shortId: 'HS-002', name: 'DC01', os: 'Windows', status: 'in_progress', ips: [{ id: 3, ip: '172.16.1.20', primary: true }] },
  ],
  subnets: [{ id: 10, cidr: '10.10.110.0/24' }, { id: 20, cidr: '172.16.1.0/24' }, { id: 30, cidr: '172.16.9.0/24' }],
  pivots: [{ id: 1, fromHostId: 1, subnetId: 20, method: 'ligolo-ng', note: '' }],
}

test('0 subnets: your machine and an empty-state message', () => {
  render(<NetworkMap network={base} activeHostId={null} onOpenHost={() => {}} />)
  expect(screen.getByText('Your machine')).toBeTruthy()
  const empty = screen.getByText(/No subnets yet/)
  // The message sits right of Your machine; the canvas must leave it a column, not a 20px sliver.
  expect(parseInt((empty.parentElement as HTMLElement).style.width) - parseInt(empty.style.left)).toBeGreaterThanOrEqual(208)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})

test('subnets, hosts, tunnel, pivot badge, empty subnet and active host', () => {
  const { container } = render(<NetworkMap network={lab} activeHostId={2} onOpenHost={() => {}} />)
  expect(screen.getByText('10.10.110.0/24')).toBeTruthy()
  expect(screen.getByText('172.16.1.0/24, via NIX01')).toBeTruthy()
  expect(screen.getByText('Not scanned yet — run a ping sweep')).toBeTruthy()
  // NIX01 sits in both subnets; each button names the IP inside its subnet, and its secondary IP shows as a second line
  expect(screen.getByRole('button', { name: 'NIX01, 10.10.110.100, Rooted, pivot' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'NIX01, 172.16.1.100, Rooted, pivot' })).toBeTruthy()
  expect(screen.getAllByText('172.16.1.100')).toHaveLength(2)
  expect(screen.getAllByText('pivot')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'DC01, 172.16.1.20, In progress' }).getAttribute('aria-current')).toBe('true')
  expect(container.querySelectorAll('path.tun')).toHaveLength(1)
  const paths = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d'))
  expect(paths.length).toBeGreaterThan(2)
  for (const d of paths) expect(d).not.toMatch(/NaN|undefined/)
  expect(screen.getByRole('group', { name: '172.16.1.0/24, via NIX01' })).toBeTruthy()
  expect(screen.queryAllByRole('region')).toHaveLength(0)
  expect(screen.queryByText(/in any subnet yet/)).toBeNull()
})

test('counts hosts that are in no subnet', () => {
  const stray = (id: number, ip: string) => ({ id, shortId: `HS-00${id}`, name: `S${id}`, os: '', status: 'not_started' as const, ips: [{ id: id * 10, ip, primary: true }] })
  const { rerender } = render(<NetworkMap network={{ ...lab, hosts: [...lab.hosts, stray(3, '192.168.5.5')] }} activeHostId={null} onOpenHost={() => {}} />)
  expect(screen.getByText("1 host isn't in any subnet yet")).toBeTruthy()
  rerender(<NetworkMap network={{ ...lab, hosts: [...lab.hosts, stray(3, '192.168.5.5'), stray(4, '192.168.5.6')] }} activeHostId={null} onOpenHost={() => {}} />)
  expect(screen.getByText("2 hosts aren't in any subnet yet")).toBeTruthy()
})

test('click and Enter open the host', async () => {
  const open = vi.fn()
  render(<NetworkMap network={lab} activeHostId={null} onOpenHost={open} />)
  const user = userEvent.setup()
  await user.tab()
  await user.keyboard('{Enter}')
  await user.click(screen.getByRole('button', { name: /^DC01/ }))
  expect(open.mock.calls).toEqual([[1], [2]])
})
