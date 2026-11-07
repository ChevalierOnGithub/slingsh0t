import { useEffect, useState } from 'react'
import type { BoxDetail, WorkItem } from '../../../shared/types'
import { api } from '../api'
import { useFlash } from '../library/useFlash'
import { useRoute } from '../router'
import { StepSection, ownerPath, statsChanged, useAct, type Insert, type Mode } from './StepSection'

const MODES: [Mode, string][] = [['live', 'Live preview'], ['markdown', 'Markdown'], ['split', 'Split']]

export function Writeup({ item, insert, onInserted, reload }: { item: WorkItem; insert: Insert | null; onInserted(): void; reload(): void }) {
  const [mode, setMode] = useState<Mode>('live')
  const [act, error] = useAct(reload)
  const [errAt, setErrAt] = useState<number | null>(null) // the step whose Move failed; null: Add step / default steps
  const step = useRoute().query.get('step')
  useFlash(step && `step_${step}`)
  const steps = [...item.steps].sort((a, b) => a.position - b.position)
  // An insert aimed at a step that was deleted meanwhile is dropped, not left pending.
  useEffect(() => { if (insert && !item.steps.some((s) => s.id === insert.stepId)) onInserted() }, [insert, item.steps])

  const move = (i: number, dir: -1 | 1) => {
    const ids = steps.map((s) => s.id)
    setErrAt(ids[i])
    ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
    act(() => api('PUT', `${ownerPath(item)}/step-order`, { stepIds: ids }))
  }
  const ordinals: Record<string, number> = {}

  return (
    <div className="writeup">
      <div className="writeup-bar">
        {/* Boxes only: Home's "Writeups to finish" skips rooms marked here (too old, not interesting). */}
        {item.kind === 'box' && (
          <label className="no-writeup">
            <input type="checkbox" checked={(item as BoxDetail).noWriteup}
              onChange={(e) => { const noWriteup = e.target.checked; setErrAt(null); act(() => api('PATCH', `/api/boxes/${item.id}`, { noWriteup })) }} />
            No writeup
          </label>
        )}
        <div className="mode" role="group" aria-label="Editor mode">
          {MODES.map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
          ))}
        </div>
      </div>
      {steps.length === 0 && (
        <p className="empty">
          No steps yet.{' '}
          <button className="btn primary" onClick={() => { setErrAt(null); act(() => api('POST', `${ownerPath(item)}/default-steps`).then(statsChanged)) }}>
            Start with the default steps
          </button>
        </p>
      )}
      {steps.map((s, i) => (
        <StepSection
          key={s.id}
          step={s}
          item={item}
          mode={mode}
          ordinal={(ordinals[s.phase] = (ordinals[s.phase] ?? 0) + 1)}
          insert={insert}
          onInserted={onInserted}
          onUp={i > 0 ? () => move(i, -1) : null}
          onDown={i < steps.length - 1 ? () => move(i, 1) : null}
          reload={reload}
          moveError={errAt === s.id ? error : null}
        />
      ))}
      <button className="btn addstep" onClick={() => { setErrAt(null); act(() => api('POST', `${ownerPath(item)}/steps`, { phase: steps.at(-1)?.phase ?? 'Recon' }).then(statsChanged)) }}>
        Add step
      </button>
      {error && errAt === null && <p className="err" role="alert">{error}</p>}
    </div>
  )
}
