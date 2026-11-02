import type { NetworkDetail } from '../../../shared/types'
import { cidrContains } from '../../../shared/cidr'

export interface MapColumn {
  subnetId: number | null; cidr: string; hostIds: number[]
  via: { pivotId: number; fromHostId: number } | null
  /** 0 = your machine, 1 = entry subnets, then one more per pivot hop; unreachable subnets come last. */
  depth: number
}

export function layoutMap(detail: NetworkDetail): { columns: MapColumn[] } {
  const { hosts, subnets } = detail
  const known = new Set(subnets.map((s) => s.id))
  const pivots = detail.pivots.filter((p) => known.has(p.subnetId))
  // Reachability uses every subnet an IP is in; drawing uses only its most specific one, so nested CIDRs don't draw a host twice.
  const inside = (cidr: string) => hosts.filter((h) => h.ips.some((i) => cidrContains(cidr, i.ip))).map((h) => h.id)
  const prefix = (cidr: string) => Number(cidr.split('/')[1])
  const home = (ip: string) => subnets.filter((s) => cidrContains(s.cidr, ip)).sort((a, b) => prefix(b.cidr) - prefix(a.cidr))[0]?.cidr
  const hostIds = (cidr: string) => hosts.filter((h) => h.ips.some((i) => home(i.ip) === cidr)).map((h) => h.id)
  const placed = new Map<number, Omit<MapColumn, 'subnetId' | 'cidr' | 'hostIds'>>()

  let frontier = subnets.filter((s) => !pivots.some((p) => p.subnetId === s.id))
  frontier.forEach((s) => placed.set(s.id, { via: null, depth: 1 }))
  // BFS: hosts in this column open the subnets their pivots reach; the placed map stops cycles.
  for (let depth = 2; frontier.length; depth++) {
    const reached = new Set(frontier.flatMap((s) => inside(s.cidr)))
    const next = []
    for (const p of pivots) {
      if (placed.has(p.subnetId) || !reached.has(p.fromHostId)) continue
      placed.set(p.subnetId, { via: { pivotId: p.id, fromHostId: p.fromHostId }, depth })
      next.push(subnets.find((s) => s.id === p.subnetId)!)
    }
    frontier = next
  }
  // At least column 2: a pivot-only subnet is never drawn as directly reachable from your machine.
  const last = Math.max(1, ...[...placed.values()].map((c) => c.depth)) + 1
  for (const s of subnets) {
    if (placed.has(s.id)) continue
    // Unreachable subnets always have a pivot (otherwise they'd be entry subnets).
    const p = pivots.find((x) => x.subnetId === s.id)!
    placed.set(s.id, { via: { pivotId: p.id, fromHostId: p.fromHostId }, depth: last })
  }

  const columns = subnets
    .map((s) => ({ subnetId: s.id, cidr: s.cidr, hostIds: hostIds(s.cidr), ...placed.get(s.id)! }))
    .sort((a, b) => a.depth - b.depth)
  return { columns: [{ subnetId: null, cidr: '', hostIds: [], via: null, depth: 0 }, ...columns] }
}
