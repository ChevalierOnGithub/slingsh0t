import type { CSSProperties } from 'react'
import type { BoxStatus, NetworkDetail, NetworkHost } from '../../../shared/types'
import { cidrContains } from '../../../shared/cidr'
import { STATUS_LABEL } from '../status'
import { layoutMap } from './mapLayout'
import './map.css'

const STATUS_COLOR: Record<BoxStatus, string> = {
  rooted: 'var(--accent)', user_flag: 'var(--medium)', in_progress: 'var(--medium)', not_started: 'var(--muted)',
}
// Fixed geometry so the SVG lines can be drawn without measuring the DOM.
const PAD = 20, GAP = 64, COL = 208, ME_W = 140, ME_H = 40, HEAD = 32, INSET = 12, NODE_GAP = 8, EMPTY_H = 40, STACK = 24
const nodeH = (h: NetworkHost) => 36 + 16 * h.ips.length
const colX = (depth: number) => (depth === 0 ? PAD : PAD + ME_W + GAP + (depth - 1) * (COL + GAP))
const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C${x1 + 32} ${y1} ${x2 - 32} ${y2} ${x2} ${y2}`
const ipsOf = (h: NetworkHost) => [...h.ips].sort((a, b) => +b.primary - +a.primary)
type Spot = { x: number; y: number; h: number }

export function NetworkMap({ network, activeHostId, onOpenHost }: {
  network: NetworkDetail; activeHostId: number | null; onOpenHost(id: number): void
}) {
  const hostById = new Map(network.hosts.map((h) => [h.id, h]))
  const pivotHosts = new Set(network.pivots.map((p) => p.fromHostId))
  const columnY = new Map<number, number>()
  const firstSpot = new Map<number, Spot>() // host id -> its leftmost appearance, where its lines start
  const boxSpot = new Map<number, Spot>() // subnet id -> box
  const links: string[] = []

  const boxes = layoutMap(network).columns.slice(1).map((col) => {
    const x = colX(col.depth), y = columnY.get(col.depth) ?? PAD
    let top = HEAD
    const nodes = col.hostIds.map((id) => {
      const host = hostById.get(id)!, h = nodeH(host), node = { host, top, h }
      const prev = firstSpot.get(id)
      if (!prev) firstSpot.set(id, { x: x + INSET, y: y + top, h })
      else if (prev.x < x) links.push(curve(prev.x + COL - 2 * INSET, prev.y + prev.h / 2, x + INSET, y + top + h / 2))
      top += h + NODE_GAP
      return node
    })
    const h = (nodes.length ? top - NODE_GAP : HEAD + EMPTY_H) + INSET
    columnY.set(col.depth, y + h + STACK)
    boxSpot.set(col.subnetId!, { x, y, h })
    if (col.depth === 1) links.push(curve(PAD + ME_W, PAD + ME_H / 2, x, y + HEAD / 2))
    const via = col.via && hostById.get(col.via.fromHostId)
    return { col, x, y, h, nodes, label: via ? `${col.cidr}, via ${via.name}` : col.cidr }
  })

  const tunnels = network.pivots.flatMap((p) => {
    const from = firstSpot.get(p.fromHostId), to = boxSpot.get(p.subnetId)
    return from && to ? [curve(from.x + COL - 2 * INSET, from.y + from.h / 2, to.x, to.y + HEAD / 2)] : []
  })
  const unplaced = network.hosts.filter((h) => !network.subnets.some((s) => h.ips.some((i) => cidrContains(s.cidr, i.ip)))).length
  const width = Math.max(colX(1) + COL, ...boxes.map((b) => b.x + COL)) + PAD // a column even when empty, for the empty-state message
  const height = Math.max(PAD + ME_H, ...boxes.map((b) => b.y + b.h)) + PAD

  return (
    <div className="map">
      <div className="map-scroll">
        <div className="map-canvas" style={{ width, height }}>
          <svg width={width} height={height} aria-hidden="true">
            {links.map((d, i) => <path key={i} d={d} />)}
            {tunnels.map((d, i) => <path key={`t${i}`} className="tun" d={d} />)}
          </svg>
          <div className="map-me" style={{ left: PAD, top: PAD, width: ME_W, height: ME_H }}>Your machine</div>
          {boxes.length === 0 && (
            <p className="map-empty" style={{ left: colX(1), top: PAD }}>No subnets yet — add the entry subnet to draw the map</p>
          )}
          {boxes.map(({ col, x, y, h, nodes, label }) => (
            // A group, not a <section>: one region landmark per subnet would flood the landmark list.
            <div key={col.subnetId} role="group" className="subnet" style={{ left: x, top: y, width: COL, height: h }} aria-label={label}>
              <span className="cidr">{label}</span>
              {nodes.length === 0 && <p className="unscanned">Not scanned yet — run a ping sweep</p>}
              {nodes.map(({ host, top, h: nh }) => {
                const ips = ipsOf(host)
                const here = ips.find((i) => cidrContains(col.cidr, i.ip)) ?? ips[0]
                return (
                  <button
                    key={host.id} type="button" className={`mnode s-${host.status}`}
                    style={{ left: INSET, top, width: COL - 2 * INSET, height: nh }}
                    aria-label={`${host.name}, ${here?.ip ?? 'no IP'}, ${STATUS_LABEL[host.status]}${pivotHosts.has(host.id) ? ', pivot' : ''}`}
                    aria-current={host.id === activeHostId ? 'true' : undefined}
                    onClick={() => onOpenHost(host.id)}
                  >
                    <span className="mname">
                      <span className="dot" style={{ '--c': STATUS_COLOR[host.status] } as CSSProperties} />
                      <span className="nm">{host.name}</span>
                      {pivotHosts.has(host.id) && <span className="badge">pivot</span>}
                    </span>
                    {ips.map((ip) => <span key={ip.id} className={cidrContains(col.cidr, ip.ip) ? 'mip here' : 'mip'}>{ip.ip}</span>)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {unplaced > 0 && <p className="map-unplaced">{unplaced === 1 ? "1 host isn't" : `${unplaced} hosts aren't`} in any subnet yet</p>}
      <ul className="map-legend">
        <li><span className="dot" style={{ '--c': STATUS_COLOR.rooted } as CSSProperties} />Rooted</li>
        <li><span className="dot" style={{ '--c': STATUS_COLOR.in_progress } as CSSProperties} />In progress or user flag</li>
        <li><span className="dot" style={{ '--c': STATUS_COLOR.not_started } as CSSProperties} />Not started</li>
        <li><span className="ln tun" />Tunnel through a pivot</li>
        <li><span className="ln" />Direct link, or the same host on another subnet</li>
        <li>Brighter IP: the host's address on that subnet</li>
      </ul>
    </div>
  )
}
