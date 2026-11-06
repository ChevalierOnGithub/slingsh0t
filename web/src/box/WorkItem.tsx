import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkItem } from '../../../shared/types'
import { currentStepId } from '../../../shared/steps'
import { api } from '../api'
import { useRoute } from '../router'
import { STATUSES } from '../status'
import { TabList, tabPanel } from '../tabs'
import { AttackPath } from './AttackPath'
import { Toolbox } from './Toolbox'
import { Writeup } from './Writeup'
import { Notes } from './Notes'
import { Report } from '../report/Report'
import { ownerPath, statsChanged, type Insert } from './StepSection'
import './box.css'

/** Loads a box or host; `change` runs a mutation that answers with the fresh item. */
export function useWorkItem<T extends WorkItem>(path: string) {
  const [item, setItem] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0) // only the latest GET may land

  const reload = useCallback(() => {
    const n = ++seq.current
    api<T>('GET', path).then((b) => { if (n === seq.current) { setItem(b); setError(null) } }, (e) => n === seq.current && setError(e.message))
  }, [path])
  useEffect(reload, [reload]) // Shell keys the page by id, so state never carries over between items
  useEffect(() => { // back from another tab or window: pick up edits made there
    addEventListener('focus', reload)
    return () => removeEventListener('focus', reload)
  }, [reload])

  const change = async (to: string, body?: unknown, method = 'PATCH') => {
    try {
      const next = await api<T>(method, to, body)
      seq.current++ // a mutation's answer always lands and outdates every GET still in flight
      setItem(next)
      setError(null)
      statsChanged() // status and Mark rooted move counts
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  return { item, error, reload, change }
}

/** Status and Mark rooted, for the page header. */
export function WorkActs({ item, change }: { item: WorkItem; change(to: string, body?: unknown, method?: string): unknown }) {
  return (
    <div className="acts">
      <select aria-label="Status" value={item.status} onChange={(e) => change(ownerPath(item), { status: e.target.value })}>
        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {item.status !== 'rooted' && (
        <button className="btn primary" onClick={() => change(ownerPath(item), { status: 'rooted' })}>Mark rooted</button>
      )}
    </div>
  )
}

/** Attack path, Writeup/Notes tabs (Report on hosts, plus `extra` tabs) and the Toolbox; shared by box and host pages. */
export function WorkBody({ item, reload, extra = {} }: { item: WorkItem; reload(): void; extra?: Record<string, () => ReactNode> }) {
  const { query } = useRoute()
  // A box's report lives on its Writeups page (#/writeups/:id); hosts have no index there, so they keep the tab.
  const tabs = ['Writeup', 'Notes', ...(item.kind === 'host' ? ['Report'] : []), ...Object.keys(extra)]
  const wanted = query.get('tab')
  const step0 = query.get('step')
  // A ?step= link wins over ?tab= even on first load.
  const [tab, setTab] = useState(!step0 && wanted && tabs.includes(wanted) ? wanted : 'Writeup')
  // A ?step= link opens Writeup during render, so Writeup's scroll effect finds its panel already shown.
  const step = query.get('step')
  const [seenStep, setSeenStep] = useState(step)
  if (step !== seenStep) {
    setSeenStep(step)
    if (step) setTab('Writeup')
  }
  const [visited, setVisited] = useState<string[]>(() => [tab]) // Report and extra tabs mount on first visit, then stay mounted
  const show = (t: string) => { setTab(t); setVisited((v) => (v.includes(t) ? v : [...v, t])) }
  const [insert, setInsert] = useState<Insert | null>(null)
  const cur = currentStepId(item.steps)
  return (
    <>
      <AttackPath steps={item.steps} currentStepId={cur} />
      <div className="boxbody">
        <div>
          <TabList id="work" tabs={tabs} current={tab} onSelect={show} />
          {/* Tabs stay mounted once shown, so autosaves, Toolbox inserts and half-typed forms survive tab switches. */}
          <div {...tabPanel('work', 'Writeup', tab)}><Writeup item={item} insert={insert} onInserted={() => setInsert(null)} reload={reload} /></div>
          <div {...tabPanel('work', 'Notes', tab)}><Notes key={item.id} path={ownerPath(item)} initial={item.notes} /></div>
          {visited.includes('Report') && <div {...tabPanel('work', 'Report', tab)}><Report key={item.id} item={item} ownerPath={ownerPath(item)} active={tab === 'Report'} /></div>}
          {Object.entries(extra).map(([k, render]) => visited.includes(k) && <div key={k} {...tabPanel('work', k, tab)}>{render()}</div>)}
        </div>
        <Toolbox
          item={item}
          currentStepId={cur}
          onInsert={(template) => {
            if (cur === null) return
            setTab('Writeup')
            setInsert({ stepId: cur, template })
          }}
          onChanged={reload}
        />
      </div>
    </>
  )
}
