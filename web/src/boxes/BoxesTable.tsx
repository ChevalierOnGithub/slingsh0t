import { memo, useMemo, useState, type CSSProperties } from 'react'
import type { BoxSummary, Difficulty } from '../../../shared/types'
import { STATUSES, STATUS_LABEL } from '../status'
import { api } from '../api'
import { statsChanged } from '../box/StepSection'

/** Opening a box from the list makes it the Working on box; the target bar re-reads the context on slingsh0t:stats. */
export const workOn = (id: number) => { api('PUT', '/api/context', { activeBoxId: id }).then(statsChanged, () => {}) }

export const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Insane']
const STATUS_ORDER = STATUSES.map(([s]) => s)
export const Dot = ({ d }: { d: Difficulty }) => <span className="dot" style={{ '--c': `var(--${d.toLowerCase()})` } as CSSProperties} />

const PAGE = 100
const COLS: [string, (b: BoxSummary) => string | number][] = [
  ['ID', (b) => b.shortId],
  ['Box', (b) => b.name.toLowerCase()],
  ['Platform', (b) => b.platform],
  ['OS', (b) => b.os],
  ['Difficulty', (b) => DIFFICULTIES.indexOf(b.difficulty)],
  ['Status', (b) => STATUS_ORDER.indexOf(b.status)],
  ['Released', (b) => b.releaseDate ?? ''],
]

export const BoxesTable = memo(function BoxesTable({ boxes }: { boxes: BoxSummary[] }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [page, setPage] = useState(0)
  const [seen, setSeen] = useState(boxes)
  if (seen !== boxes) { setSeen(boxes); setPage(0) } // new filter result → back to page 1

  const sorted = useMemo(() => {
    if (!sort) return boxes
    const key = COLS[sort.col][1]
    return [...boxes].sort((a, b) => {
      const x = key(a), y = key(b)
      if ((x === '') !== (y === '')) return x === '' ? 1 : -1 // blanks (no release date, no OS) last in either direction
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [boxes, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE))
  const rows = sorted.slice(page * PAGE, (page + 1) * PAGE)
  const sortBy = (col: number) => {
    setSort((s) => ({ col, dir: s?.col === col && s.dir === 1 ? -1 : 1 }))
    setPage(0)
  }

  return (
    <>
      <table className="boxes fixed">
        {/* Fixed layout: column widths do not shift with the names on the current page. */}
        <colgroup>{COLS.map(([label]) => <col key={label} className={`col-${label.toLowerCase()}`} />)}</colgroup>
        <thead>
          <tr>
            {COLS.map(([label], i) => (
              <th key={label} aria-sort={sort?.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => sortBy(i)}>{label}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>{b.shortId}</td>
              <td><a href={`#/boxes/${b.id}`} onClick={() => workOn(b.id)}>{b.name}</a>{b.url && <a className="room-link" href={b.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${b.name} on ${b.platform}`}>↗</a>}</td>
              <td>{b.platform}</td>
              <td>{b.os}</td>
              <td><Dot d={b.difficulty} />{b.difficulty}</td>
              <td>{STATUS_LABEL[b.status]}</td>
              <td>{b.releaseDate?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!boxes.length && <p className="empty">No boxes match these filters.</p>}
      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button className="btn" type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{page * PAGE + 1}–{page * PAGE + rows.length} of {sorted.length}</span>
          <button className="btn" type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </nav>
      )}
    </>
  )
})
