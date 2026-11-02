import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SearchHit } from '../../../shared/types'
import { api } from '../api'
import { navigate } from '../router'
import { matchPages } from './pages'
import './SearchPalette.css'

const LABEL: Record<SearchHit['kind'], string> = {
  box: 'Boxes', network: 'Networks', host: 'Hosts', step: 'Steps', credential: 'Credentials', technique: 'Techniques', tool: 'Tools',
  command: 'Commands', reference: 'Reference',
}
const TOP = 5
// Credential hits carry no secret, so they open the loot index rather than reveal anything here.
const target = (h: SearchHit) =>
  h.kind === 'box' ? `#/boxes/${h.id}`
    : h.kind === 'network' ? `#/networks/${h.id}`
    : h.kind === 'host' ? `#/hosts/${h.id}`
    : h.kind === 'credential' ? '#/loot'
    : h.kind === 'step' ? (h.hostId ? `#/hosts/${h.hostId}?step=${h.id}` : `#/boxes/${h.boxId}?step=${h.id}`)
    : h.kind === 'technique' ? `#/techniques?t=${h.id}`
    : h.kind === 'reference' ? `#/reference/${h.id}`
    : h.kind === 'tool' ? `#/tools?tool=${h.id}`
    : `#/${h.toolId === null ? 'techniques' : 'tools'}?cmd=${h.id}`

// Server marks matches with \u0002…\u0003 (never in typed text); built as nodes, never innerHTML.
const Snippet = ({ text }: { text: string }) => (
  <>{text.split(/\u0002([^\u0003]*)\u0003/).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>
)

export function SearchPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const [expanded, setExpanded] = useState<SearchHit['kind'][]>([])
  const input = useRef<HTMLInputElement>(null)
  const opener = useRef<Element | null>(null)

  const close = () => {
    setOpen(false)
    ;(opener.current as HTMLElement | null)?.focus?.()
  }
  const show = () => {
    opener.current = document.activeElement
    setQ(''); setHits([]); setSel(0); setFailed(false); setExpanded([]); setOpen(true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (e.repeat) return
        if (open) close(); else show()
      } else if (open && e.key === 'Escape' && !e.isComposing) { e.preventDefault(); close() } // Esc during IME composition cancels the composition only
    }
    const onOpen = () => show()
    addEventListener('keydown', onKey)
    addEventListener('slingsh0t:search', onOpen)
    return () => { removeEventListener('keydown', onKey); removeEventListener('slingsh0t:search', onOpen) }
  }, [open])

  useEffect(() => { if (open) input.current?.focus() }, [open])

  useEffect(() => {
    if (!open || !q.trim()) { setHits([]); setPending(false); return }
    let stale = false
    setPending(true)
    const t = setTimeout(() => {
      api<SearchHit[]>('GET', `/api/search?q=${encodeURIComponent(q.trim())}&limit=50`).then(
        (r) => { if (!stale) { setHits(r); setFailed(false); setPending(false) } },
        () => { if (!stale) { setFailed(true); setPending(false) } },
      )
    }, 150)
    return () => { stale = true; clearTimeout(t) }
  }, [q, open])

  // Runs before the early return (hook order); finds the active row by aria-selected, as ids live below.
  useEffect(() => { document.querySelector('#sp-list [aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [sel, hits, expanded, open, q])

  if (!open) return null
  const go = (href: string) => { close(); navigate(href) }
  type Row = { key: string; act: () => void; body: ReactNode; more?: true }
  const pages = matchPages(q)
  const groups: { label: string; heading: string; rows: Row[] }[] = pages.length
    ? [{ label: 'Pages', heading: 'Pages', rows: pages.map((p) => ({ key: `page-${p.href.slice(2)}`, act: () => go(p.href), body: <b>{p.label}</b> })) }]
    : []
  // Server rows arrive best match first, so a kind's first appearance orders its group.
  for (const kind of new Set(hits.map((h) => h.kind))) {
    const items = hits.filter((h) => h.kind === kind)
    const { total } = items[0]
    const full = expanded.includes(kind)
    const rows: Row[] = (full ? items : items.slice(0, TOP)).map((h) => ({
      key: `${h.kind}-${h.id}`, act: () => go(target(h)),
      body: <><b>{h.title}</b>{h.snippet && <span><Snippet text={h.snippet} /></span>}</>,
    }))
    // The Show all row's index becomes the first newly shown row, so the selection stays put.
    if (!full && (total > TOP || items.length > TOP)) rows.push({ key: `${kind}-all`, act: () => setExpanded([...expanded, kind]), body: <b>{items.length < total ? `Show ${items.length} of ${total}` : `Show all ${total}`}</b>, more: true })
    groups.push({ label: LABEL[kind], heading: `${LABEL[kind]} (${total})`, rows })
  }
  // Flat order matches the grouped display so arrow keys follow what is on screen.
  const flat = groups.flatMap((g) => g.rows)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return // the IME owns arrows and Enter until it commits
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length) setSel((sel + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length)
    } else if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); flat[sel].act() }
    else if (e.key === 'Tab') e.preventDefault() // trap: the input is the only stop
  }

  return (
    <div className="sp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      {/* Keep focus in the input when clicking anywhere in the dialog (padding, notes, results); the input itself still places the caret. */}
      <div className="sp" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown}
        onMouseDown={(e) => { if (e.target !== input.current) e.preventDefault() }}>
        <input
          ref={input}
          role="combobox" aria-expanded={flat.length > 0} aria-controls="sp-list" aria-autocomplete="list"
          aria-activedescendant={flat[sel] ? `sp-${flat[sel].key}` : undefined}
          aria-label="Search boxes, networks, hosts, steps, credentials, techniques, tools and reference"
          placeholder="Search boxes, networks, hosts, steps, credentials, techniques, tools, reference"
          value={q} onChange={(e) => { setQ(e.target.value); setHits([]); setSel(0); setExpanded([]); setFailed(false) }}
        />
        {failed && <p className="sp-note" role="alert">Search failed. Try again.</p>}
        {!failed && q.trim() && !flat.length && !pending && <p className="sp-note">No matches.</p>}
        <div id="sp-list" role="listbox" aria-label="Results">
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.heading}>
              <h3 role="presentation" aria-hidden="true">{g.heading}</h3>
              {g.rows.map((r) => {
                const i = flat.indexOf(r)
                return (
                  <div key={r.key} id={`sp-${r.key}`} role="option" aria-selected={i === sel}
                    className={`sp-row${r.more ? ' more' : ''}${i === sel ? ' on' : ''}`} onMouseMove={() => setSel(i)} onClick={() => { setSel(i); r.act() }}>
                    {r.body}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
