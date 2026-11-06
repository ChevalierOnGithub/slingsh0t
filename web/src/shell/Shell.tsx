import { useEffect, useState } from 'react'
import type { Stats } from '../../../shared/types'
import { api } from '../api'
import { LOST_EVENT } from '../autosave'
import { useRoute } from '../router'
import { HomePage } from '../home/HomePage'
import { BoxesPage } from '../boxes/BoxesPage'
import { BoxPage } from '../box/BoxPage'
import { HostPage } from '../network/HostPage'
import { NetworkPage } from '../network/NetworkPage'
import { NetworksPage } from '../network/NetworksPage'
import { LootPage } from '../loot/LootPage'
import { TechniquesPage } from '../pages/TechniquesPage'
import { ToolsPage } from '../pages/ToolsPage'
import { ShellsPage } from '../pages/ShellsPage'
import { WriteupsPage } from '../pages/WriteupsPage'
import { ReferencePage } from '../pages/ReferencePage'
import { WriteupPage } from '../pages/WriteupPage'
import { ImportPage } from '../pages/ImportPage'
import { CreditsPage } from '../pages/CreditsPage'
import { TargetBar } from './TargetBar'
import { SearchPalette } from '../search/SearchPalette'

type Count = 'boxes' | 'networks' | 'loot' | 'techniques' | 'tools' | 'writeups' | 'reference'
const NAV: [string, string, Count | null][] = [
  ['home', 'Home', null], ['boxes', 'Boxes', 'boxes'], ['networks', 'Networks', 'networks'], ['loot', 'Loot', 'loot'], ['techniques', 'Techniques', 'techniques'], ['tools', 'Tools and commands', 'tools'],
  ['shells', 'Reverse shells', null], ['writeups', 'Writeups', 'writeups'], ['reference', 'Reference', 'reference'],
  ['import', 'Import / Backup', null],
]
const VIEWS = [['table', 'Table'], ['board', 'Board'], ['pyramid', 'Pyramid']]
const PAGES = { home: HomePage, boxes: BoxesPage, networks: NetworksPage, loot: LootPage, techniques: TechniquesPage, tools: ToolsPage, shells: ShellsPage, writeups: WriteupsPage, import: ImportPage, credits: CreditsPage }
const RAIL_KEY = 'slingsh0t:rail'
const readCollapsed = () => { try { return localStorage.getItem(RAIL_KEY) === 'collapsed' } catch { return false } }

export function Shell() {
  const route = useRoute()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleRail = () => {
    const next = !collapsed
    setCollapsed(next)
    try { if (next) localStorage.setItem(RAIL_KEY, 'collapsed'); else localStorage.removeItem(RAIL_KEY) } catch { /* keep in memory */ }
  }
  const [stats, setStats] = useState<Stats | null>(null)
  // Refetch on every route change, and on 'slingsh0t:stats' from pages that change counts in place.
  useEffect(() => {
    const load = () => { api<Stats>('GET', '/api/stats').then(setStats, () => {}) }
    load()
    addEventListener('slingsh0t:stats', load)
    return () => removeEventListener('slingsh0t:stats', load)
  }, [route.name, 'id' in route ? route.id : 0])

  // Edits that failed to save after their page unmounted; kept here so they outlive navigation.
  const [lost, setLost] = useState<string[]>([])
  useEffect(() => {
    const add = (e: Event) => setLost((l) => [...l, (e as CustomEvent<string>).detail])
    addEventListener(LOST_EVENT, add)
    return () => removeEventListener(LOST_EVENT, add)
  }, [])

  const section = route.name === 'box' ? 'boxes' : route.name === 'host' || route.name === 'network' ? 'networks' : route.name === 'writeup' ? 'writeups' : route.name
  const view = route.query.get('view') ?? 'table'
  const Page = route.name === 'box' || route.name === 'host' || route.name === 'network' || route.name === 'reference' || route.name === 'writeup' ? null : PAGES[route.name]

  return (
    <div className={collapsed ? 'app collapsed' : 'app'}>
      <nav className="rail">
        <button type="button" className="rail-toggle" aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} aria-expanded={!collapsed} aria-controls="rail-nav" onClick={toggleRail}>{collapsed ? '›' : '‹'}</button>
        <div className="brand" hidden={collapsed}>Sling<b>Sh0t</b></div>
        <div className="navs" id="rail-nav" hidden={collapsed}>
          {NAV.map(([name, label, count]) => (
            <div key={name}>
              {/* On the Boxes list its view link is the page, so Boxes itself is only 'true': one aria-current="page" per screen. */}
              <a className={section === name ? 'nav on' : 'nav'} href={`#/${name}`}
                aria-current={section !== name ? undefined : name === 'boxes' && route.name === 'boxes' ? 'true' : 'page'}>
                {label}{count && stats && <span>{stats[count]}</span>}
              </a>
              {name === 'boxes' && (
                <div className="views" role="group" aria-label="Boxes view">
                  {VIEWS.map(([v, l]) => {
                    const on = route.name === 'boxes' && view === v
                    return <a key={v} className={on ? 'on' : undefined} href={`#/boxes?view=${v}`} aria-current={on ? 'page' : undefined}>{l}</a>
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </nav>
      <main>
        <TargetBar />
        {lost.map((m, i) => (
          <p key={i} className="lost" role="alert">
            {m}
            <button type="button" className="btn" aria-label={`Dismiss: ${m}`} onClick={() => setLost((l) => l.filter((_, j) => j !== i))}>Dismiss</button>
          </p>
        ))}
        <div className="page">
          {route.name === 'box' ? <BoxPage key={route.id} id={route.id} />
            : route.name === 'host' ? <HostPage key={route.id} id={route.id} />
            : route.name === 'network' ? <NetworkPage key={route.id} id={route.id} />
            : route.name === 'reference' ? <ReferencePage id={route.id} />
            : route.name === 'writeup' ? <WriteupPage key={`${route.kind}-${route.id}`} kind={route.kind} id={route.id} />
            : Page && <Page />}
        </div>
      </main>
      <SearchPalette />
    </div>
  )
}
