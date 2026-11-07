import { useCallback, useDeferredValue, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AD_TAG, type BoxDetail, type BoxStatus, type BoxSummary, type Difficulty, type Platform } from '../../../shared/types'
import { api } from '../api'
import { navigate, useRoute } from '../router'
import { statsChanged } from '../box/StepSection'
import { BoxesBoard } from './BoxesBoard'
import { STATUSES } from '../status'
import { BoxesTable, DIFFICULTIES } from './BoxesTable'
import { Pyramid } from './Pyramid'
import { Continue } from './Continue'

const VIEWS = [['table', 'Table'], ['board', 'Board'], ['pyramid', 'Pyramid']]
const NO_FILTER ={ q: '', platform: '', difficulty: '', os: '', status: '' }
// The table hides rooted boxes until asked; the board keeps its Rooted column to drop boxes into.
const statusFor = (view: string | null) => (view === 'board' ? '' : 'open')

export function BoxesPage() {
  const view = useRoute().query.get('view')
  const [boxes, setBoxes] = useState<BoxSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null) // shown by the Add box button, not at the top of the page
  const [filter, setFilter] = useState(() => ({ ...NO_FILTER, status: statusFor(view) }))
  const [filterView, setFilterView] = useState(view)
  if (view !== filterView) { setFilterView(view); setFilter((p) => ({ ...p, status: statusFor(view) })) }
  const deferred = useDeferredValue(filter)
  useEffect(() => {
    api<BoxSummary[]>('GET', '/api/boxes').then(setBoxes, (e) => setError(e.message))
  }, [])

  const all = boxes ?? []
  const oses = useMemo(() => [...new Set(all.map((b) => b.os).filter(Boolean))].sort(), [boxes])
  const shown = useMemo(() => {
    const f = deferred
    const q = f.q.trim().toLowerCase()
    return all.filter((b) =>
      (!q || b.name.toLowerCase().includes(q) || b.shortId.toLowerCase().includes(q)) &&
      (!f.platform || b.platform === f.platform) && (!f.difficulty || b.difficulty === f.difficulty) &&
      (!f.os || b.os === f.os) && (!f.status || (f.status === 'open' ? b.status !== 'rooted' : b.status === f.status)))
  }, [boxes, deferred])
  const set = (k: keyof typeof NO_FILTER) => (e: { target: { value: string } }) => setFilter((p) => ({ ...p, [k]: e.target.value }))

  const move = useCallback((box: BoxSummary, status: BoxStatus) => {
    // Revert only while the box still shows this move, so a later move isn't undone.
    const put = (from: BoxStatus | null, to: BoxStatus) =>
      setBoxes((bs) => bs && bs.map((b) => (b.id === box.id && (from === null || b.status === from) ? { ...b, status: to } : b)))
    put(null, status)
    api('PATCH', `/api/boxes/${box.id}`, { status }).then(
      () => { setError(null); dispatchEvent(new Event('slingsh0t:stats')) },
      (e) => { put(status, box.status); setError(e.message) },
    )
  }, [])

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      const box = await api<BoxDetail>('POST', '/api/boxes', {
        platform: f.get('platform') as Platform,
        name: f.get('name'),
        os: f.get('os'),
        difficulty: f.get('difficulty') as Difficulty,
        tags: f.get('ad') ? [AD_TAG] : [],
      })
      statsChanged()
      navigate(`#/boxes/${box.id}`)
    } catch (err) {
      setAddError((err as Error).message)
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>Boxes</h1>
        <nav className="views" aria-label="Boxes view">
          {VIEWS.map(([v, l]) => (
            <a key={v} href={`#/boxes?view=${v}`} aria-current={(view ?? 'table') === v ? 'page' : undefined}>{l}</a>
          ))}
        </nav>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {boxes === null && !error && <p className="empty" role="status">Loading boxes…</p>}
      {boxes?.length === 0 && <p className="empty">No boxes yet. Add the box you're working on.</p>}
      {!!boxes?.length && (view === 'pyramid' ? <Pyramid boxes={boxes} /> : (
        <>
          <Continue boxes={all} />
          <div className="filters">
            <input type="text" aria-label="Filter by name or ID" placeholder="Name or ID" value={filter.q} onChange={set('q')} />
            <select aria-label="Filter by platform" value={filter.platform} onChange={set('platform')}>
              <option value="">Any platform</option><option>HTB</option><option>THM</option>
            </select>
            <select aria-label="Filter by difficulty" value={filter.difficulty} onChange={set('difficulty')}>
              <option value="">Any difficulty</option>{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
            </select>
            <select aria-label="Filter by OS" value={filter.os} onChange={set('os')}>
              <option value="">Any OS</option>{oses.map((o) => <option key={o}>{o}</option>)}
            </select>
            <select aria-label="Filter by status" value={filter.status} onChange={set('status')}>
              <option value="">Any status</option><option value="open">Not rooted</option>{STATUSES.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
            </select>
            <span className="count">{shown.length === all.length ? `${all.length} boxes` : `${shown.length} of ${all.length} boxes`}</span>
          </div>
          {view === 'board' ? <BoxesBoard boxes={shown} onMove={move} /> : <BoxesTable boxes={shown} />}
        </>
      ))}
      <form className="add" onSubmit={add}>
        <label>Platform <select name="platform"><option>HTB</option><option>THM</option></select></label>
        <label>Name <input type="text" name="name" required /></label>
        <label>OS <input type="text" name="os" required /></label>
        <label>Difficulty <select name="difficulty"><option>Easy</option><option>Medium</option><option>Hard</option><option>Insane</option></select></label>
        <label className="chk"><input type="checkbox" name="ad" /> Active Directory</label>
        <button className="btn primary" type="submit">Add box</button>
        {addError && <p className="err" role="alert">{addError}</p>}
      </form>
    </section>
  )
}
