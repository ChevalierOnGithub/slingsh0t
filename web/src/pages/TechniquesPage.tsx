import { useEffect, useState } from 'react'
import type { Vars } from '../../../shared/placeholders'
import { APPLIES, HAVES, PHASES, SERVICES, type Applies, type Have, type TechniqueListItem } from '../../../shared/types'
import { api } from '../api'
import { CommandRow } from '../library/CommandRow'
import { useAutosave } from '../autosave'
import { useFlash } from '../library/useFlash'
import { useRoute } from '../router'
import { useTargetContext } from '../shell/TargetBar'
import './library.css'

export function TechniquesPage() {
  const [list, setList] = useState<TechniqueListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { ctx } = useTargetContext()
  const vars: Vars = { TARGET: ctx.target, LHOST: ctx.lhost, LPORT: ctx.lport }
  const route = useRoute().query, t = route.get('t'), cmd = route.get('cmd')
  useEffect(() => { api<TechniqueListItem[]>('GET', '/api/techniques').then(setList, (e) => setError(e.message)) }, [])
  const fail = (e: Error) => setError(e.message)
  const [filter, setFilter] = useState('all') // 'all' | 'svc:<slug>' | 'phase:<name>'
  // the response, not the request, sets state: the pressed pills follow what the server kept
  const patch = (x: TechniqueListItem, body: Partial<Pick<TechniqueListItem, 'applies' | 'service' | 'needs' | 'yields'>>) =>
    api<TechniqueListItem>('PATCH', `/api/techniques/${x.id}`, body).then((r) => {
      setError(null)
      setList((l) => l && l.map((y) => y.id === x.id ? { ...y, ...Object.fromEntries(Object.keys(body).map((k) => [k, r[k as keyof typeof r]])) } : y))
      return true
    }, (e: Error) => { fail(e); return false })
  const move = (here: TechniqueListItem[], i: number, dir: -1 | 1) => {
    const ids = here.map((y) => y.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
    setError(null)
    api<TechniqueListItem[]>('PUT', '/api/techniques/order', { ids }).then((re) =>
      setList((l) => l && [...l.filter((y) => y.phase !== here[0].phase), ...re]), fail)
  }
  const services = [...new Set((list ?? []).map((x) => x.service))].filter((s) => s !== 'any' && s !== 'shell').sort()
  const phases = PHASES.filter((p) => list?.some((x) => x.phase === p))
  const chips: [string, string][] = [['all', 'all'], ...services.map((s): [string, string] => [`svc:${s}`, s]), ['svc:shell', 'after a shell'], ...phases.map((p): [string, string] => [`phase:${p}`, p])]
  const match = (x: TechniqueListItem) => filter === 'all' || (filter.startsWith('svc:') ? x.service === filter.slice(4) : x.phase === filter.slice(6))
  const reorderable = !filter.startsWith('svc:')
  useEffect(() => { if (filter.startsWith('svc:') && filter !== 'svc:shell' && !services.includes(filter.slice(4))) setFilter('all') }, [filter, services.join()])
  useFlash(list && (t ? `t-${t}` : cmd ? `cmd-${cmd}` : null)) // wait for the list so the anchor exists

  return (
    <section className="lib">
      <h1>Techniques</h1>
      {error && <p className="err" role="alert">{error}</p>}
      {list && !list.length && <p className="empty">No techniques yet. Add them from a box's toolbox.</p>}
      {list && list.length > 0 && (
        <div className="filters" role="group" aria-label="Filter">
          {chips.map(([v, label]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{label}</button>)}
        </div>
      )}
      {list && PHASES.map((phase) => {
        const here = list.filter((x) => x.phase === phase && match(x)).sort((a, b) => a.position - b.position)
        return here.length > 0 && (
          <section key={phase} className="lib-phase">
            <h2>{phase}</h2>
            {here.map((x, i) => (
              <Technique key={x.id} t={x} vars={vars} onPatch={(b) => patch(x, b)}
                onMove={(dir) => (reorderable && here[i + dir] ? () => move(here, i, dir) : null)} />
            ))}
          </section>
        )
      })}
    </section>
  )
}

const APPLIES_LABEL: Record<Applies, string> = { any: 'Any', linux: 'Linux', windows: 'Windows', ad: 'Active Directory' }

function Technique({ t, vars, onMove, onPatch }: { t: TechniqueListItem; vars: Vars; onMove: (dir: -1 | 1) => (() => void) | null; onPatch: (b: Partial<Pick<TechniqueListItem, 'applies' | 'service' | 'needs' | 'yields'>>) => Promise<boolean> }) {
  const up = onMove(-1), down = onMove(1)
  const desc = useAutosave(t.description, async (description) => {
    await api('PATCH', `/api/techniques/${t.id}`, { description })
    dispatchEvent(new Event('slingsh0t:stats'))
  }, `the ${t.name} description`)
  const known = t.service === 'any' || t.service === 'shell' || (SERVICES as readonly string[]).includes(t.service)
  const [other, setOther] = useState(false)
  const [slug, setSlug] = useState('')
  const badSlug = slug !== '' && !/^[a-z][a-z0-9-]{0,23}$/.test(slug)
  const saveSlug = () => { if (slug !== '' && !badSlug) onPatch({ service: slug }).then((ok) => ok && setOther(false)) }
  const toggles = (key: 'needs' | 'yields', label: string) => (
    <div className="tq-pills" role="group" aria-label={`${label} for ${t.name}`}>
      {HAVES.map((h: Have) => (
        <button key={h} type="button" aria-pressed={t[key].includes(h)}
          onClick={() => onPatch({ [key]: t[key].includes(h) ? t[key].filter((y) => y !== h) : [...t[key], h] })}>{h}</button>
      ))}
    </div>
  )
  return (
    <article className="tq tq-card" id={`t-${t.id}`}>
      <span className="mono">{t.shortId}</span>
      <div>
        <h3>{t.name}</h3>
        <p className="tq-pills"><span>{t.phase}</span><span>{t.service === 'shell' ? 'after a shell' : t.service === 'any' ? 'any service' : t.service}</span><span>{APPLIES_LABEL[t.applies]}</span></p>
        <div className="tq-acts">
          <select aria-label={`Applies to for ${t.name}`} value={t.applies} onChange={(e) => onPatch({ applies: e.target.value as Applies })}>
            {APPLIES.map((a) => <option key={a} value={a}>{APPLIES_LABEL[a]}</option>)}
          </select>
          <button type="button" className="ghost" aria-label={`Move ${t.name} up`} disabled={!up} onClick={() => up?.()}>↑</button>
          <button type="button" className="ghost" aria-label={`Move ${t.name} down`} disabled={!down} onClick={() => down?.()}>↓</button>
        </div>
        <div className="tq-meta">
          <span>Service</span>
          <span>
            <select aria-label={`Service for ${t.name}`} value={other ? 'other' : t.service} onChange={(e) => e.target.value === 'other' ? setOther(true) : (setOther(false), onPatch({ service: e.target.value }))}>
              <option value="any">any service</option>
              <option value="shell">after a shell</option>
              {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
              {!known && <option value={t.service}>{t.service}</option>}
              <option value="other">other…</option>
            </select>
            {other && <input aria-label={`Other service for ${t.name}`} value={slug} aria-invalid={badSlug} maxLength={24} onChange={(e) => setSlug(e.target.value)} onBlur={saveSlug} onKeyDown={(e) => e.key === 'Enter' && saveSlug()} />}
            {other && badSlug && <small className="err">lowercase letters, digits and dashes</small>}
          </span>
          <span>Needs</span>{toggles('needs', 'Needs')}
          <span>Yields</span>{toggles('yields', 'Yields')}
          <span>When</span>
        <textarea aria-label={`Description of ${t.name}`} rows={Math.max(1, desc.value.split('\n').length)} value={desc.value} placeholder="Add a description" onChange={(e) => desc.onChange(e.target.value)} onBlur={desc.flush} />
        </div>
        {desc.error && <p className="err" role="alert">Description not saved: {desc.error}</p>}
        {t.commands.length > 0 && <ul className="tb-cmds">{t.commands.map((c) => <CommandRow key={c.id} cmd={c} vars={vars} id={`cmd-${c.id}`} />)}</ul>}
        <p className="uses">
          {t.uses.length ? 'Used on' : 'Not used on a box yet'}
          {t.uses.map((u) => (
            <a key={u.stepId} href={u.hostId ? `#/hosts/${u.hostId}?step=${u.stepId}` : `#/boxes/${u.boxId}?step=${u.stepId}`}>{u.ownerName} · {u.phase} {u.ordinal}{u.dead ? ' (dead end)' : ''}</a>
          ))}
        </p>
      </div>
    </article>
  )
}
