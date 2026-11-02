import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { BoxStatus, BoxSummary } from '../../../shared/types'
import { STATUSES } from '../status'
import { Dot, workOn } from './BoxesTable'

const FIRST = 12
type Pick = (box: BoxSummary, status: BoxStatus) => void

const Card = memo(function Card({ b, onPick, selects }: { b: BoxSummary; onPick: Pick; selects: Map<number, HTMLSelectElement> }) {
  return (
    <article className="card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(b.id))}>
      <div className="card-head">
        <a href={`#/boxes/${b.id}`} onClick={() => workOn(b.id)}>{b.name}</a>
        <span className="mono">{b.shortId}</span>
      </div>
      <div className="card-meta">
        <span>{b.platform}</span>{b.os && <span>{b.os}</span>}<span><Dot d={b.difficulty} />{b.difficulty}</span>
      </div>
      {b.targetIp && <div className="mono">{b.targetIp}</div>}
      <div className="card-foot">
        <select
          ref={(el) => { if (el) selects.set(b.id, el); return () => { selects.delete(b.id) } }}
          aria-label={`Status of ${b.name}`}
          value={b.status}
          onChange={(e) => onPick(b, e.target.value as BoxStatus)}
        >
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
    </article>
  )
})

export const BoxesBoard = memo(function BoxesBoard({ boxes, onMove }: { boxes: BoxSummary[]; onMove: Pick }) {
  const [showAll, setShowAll] = useState(false)
  const [over, setOver] = useState<BoxStatus | null>(null)
  // The card whose select keeps focus: a move remounts it in another column, which drops focus to <body>.
  const [focusId, setFocusId] = useState<number | null>(null)
  const selects = useRef(new Map<number, HTMLSelectElement>()).current
  useEffect(() => {
    const a = document.activeElement
    if (focusId !== null && (!a || a === document.body)) selects.get(focusId)?.focus()
  })
  // Once the owner focuses or clicks anything else, stop pulling focus back to that select.
  useEffect(() => {
    if (focusId === null) return
    const away = (e: Event) => { if (e.target !== selects.get(focusId)) setFocusId(null) }
    document.addEventListener('focusin', away)
    document.addEventListener('pointerdown', away)
    return () => { document.removeEventListener('focusin', away); document.removeEventListener('pointerdown', away) }
  }, [focusId])
  const pick = useCallback<Pick>((b, s) => { setFocusId(b.id); onMove(b, s) }, [onMove])

  return (
    <div className="board">
      {STATUSES.map(([s, label]) => {
        const col = boxes.filter((b) => b.status === s)
        let shown = col
        if (s === 'not_started' && !showAll) {
          shown = col.slice(0, FIRST)
          const moved = col.find((b) => b.id === focusId)
          if (moved && !shown.includes(moved)) shown = [moved, ...shown.slice(0, FIRST - 1)] // keep a just-moved card visible
        }
        return (
          <section
            key={s}
            className={over === s ? 'bcol over' : 'bcol'}
            aria-label={label}
            onDragOver={(e) => { e.preventDefault(); setOver(s) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null) }}
            onDrop={(e) => {
              e.preventDefault()
              setOver(null)
              const box = boxes.find((b) => b.id === Number(e.dataTransfer.getData('text/plain')))
              if (box && box.status !== s) pick(box, s)
            }}
          >
            <h2>{label}<span>{col.length}</span></h2>
            {shown.map((b) => <Card key={b.id} b={b} onPick={pick} selects={selects} />)}
            {!col.length && <p className="hint">Drag a box here.</p>}
            {shown.length < col.length && (
              <button className="btn" type="button" onClick={() => { setFocusId(col.find((b) => !shown.includes(b))!.id); setShowAll(true) }}>
                Show all {col.length}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
})
