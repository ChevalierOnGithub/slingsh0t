import { expect, test } from 'vitest'
import type { NetworkDetail, NetworkHost } from '../../../shared/types'
import { layoutMap } from './mapLayout'

const host = (id: number, ...ips: string[]): NetworkHost => ({
  id, shortId: `HS-${id}`, name: `H${id}`, os: 'Linux', status: 'not_started',
  ips: ips.map((ip, i) => ({ id: id * 10 + i, ip, primary: i === 0 })),
})
const net = (p: Pick<NetworkDetail, 'hosts' | 'subnets' | 'pivots'>): NetworkDetail => ({
  id: 1, shortId: 'N-001', platform: 'HTB', name: 'Lab', hostsInScope: null, flagsInScope: null,
  hostsFound: 0, hostsOwned: 0, flagsCaptured: 0, credentials: 0, url: '', tags: [], notes: '', entry: '', ...p,
})
const pivot = (id: number, fromHostId: number, subnetId: number) => ({ id, fromHostId, subnetId, method: 'ligolo-ng', note: '' })

test('0 subnets: only your machine', () => {
  expect(layoutMap(net({ hosts: [host(1, '10.0.0.5')], subnets: [], pivots: [] }))).toEqual({
    columns: [{ subnetId: null, cidr: '', hostIds: [], via: null, depth: 0 }],
  })
})

test('entry subnet, pivot chain, cycle back-edge and a host in two subnets', () => {
  const { columns } = layoutMap(net({
    hosts: [host(1, '10.10.110.100', '172.16.1.100'), host(2, '172.16.1.20', '172.16.2.5'), host(3, '172.16.2.101')],
    // given out of depth order to prove sorting
    subnets: [{ id: 30, cidr: '172.16.2.0/24' }, { id: 10, cidr: '10.10.110.0/24' }, { id: 20, cidr: '172.16.1.0/24' }],
    // pivot 3 points back into subnet 20 from a deeper host: the cycle must terminate without moving 20
    pivots: [pivot(1, 1, 20), pivot(2, 2, 30), pivot(3, 3, 20)],
  }))
  expect(columns.map((c) => [c.subnetId, c.depth, c.hostIds, c.via])).toEqual([
    [null, 0, [], null],
    [10, 1, [1], null],
    [20, 2, [1, 2], { pivotId: 1, fromHostId: 1 }],
    [30, 3, [2, 3], { pivotId: 2, fromHostId: 2 }],
  ])
})

test('a detached pivot cycle goes last; unknown subnets are ignored', () => {
  const { columns } = layoutMap(net({
    hosts: [host(1, '10.0.0.1'), host(2, '10.1.0.2'), host(3, '10.2.0.3')],
    subnets: [{ id: 2, cidr: '10.1.0.0/16' }, { id: 1, cidr: '10.0.0.0/16' }, { id: 3, cidr: '10.2.0.0/16' }],
    pivots: [pivot(1, 3, 2), pivot(2, 2, 3), pivot(3, 1, 99)],
  }))
  expect(columns.map((c) => [c.subnetId, c.depth, c.via?.fromHostId ?? null])).toEqual([
    [null, 0, null], [1, 1, null], [2, 2, 3], [3, 2, 2],
  ])
})

test('an A<->B pivot cycle with no entry subnet is never drawn as directly reachable', () => {
  const { columns } = layoutMap(net({
    hosts: [host(1, '10.0.0.1'), host(2, '10.1.0.2')],
    subnets: [{ id: 1, cidr: '10.0.0.0/16' }, { id: 2, cidr: '10.1.0.0/16' }],
    pivots: [pivot(1, 2, 1), pivot(2, 1, 2)],
  }))
  expect(columns.map((c) => [c.subnetId, c.depth])).toEqual([[null, 0], [1, 2], [2, 2]])
})

test('nested subnets: a host is drawn only in its most specific subnet, but still opens pivots from the wider one', () => {
  const cols = layoutMap(net({
    hosts: [host(1, '10.0.1.5'), host(2, '10.0.9.9'), host(3, '172.16.0.4')],
    subnets: [{ id: 1, cidr: '10.0.0.0/16' }, { id: 2, cidr: '10.0.1.0/24' }, { id: 3, cidr: '172.16.0.0/24' }],
    pivots: [pivot(1, 1, 3)],
  })).columns.slice(1)
  expect(cols.map((c) => [c.subnetId, c.depth, c.hostIds])).toEqual([[1, 1, [2]], [2, 1, [1]], [3, 2, [3]]])
})
