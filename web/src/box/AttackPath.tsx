import type { Step } from '../../../shared/types'

export function AttackPath({ steps, currentStepId }: { steps: Step[]; currentStepId: number | null }) {
  const sorted = [...steps].sort((a, b) => a.position - b.position)
  // Equal segments: time spent only colours a segment, it no longer sizes it.
  const spent = sorted.map((s) => s.seconds > 0 || s.timerStartedAt !== null)
  return (
    <ol className="path" aria-label="Attack path">
      {sorted.map((s, i) => (
        <li
          key={s.id}
          className={`${spent[i] ? 'spent' : ''} ${s.id === currentStepId ? 'now' : ''} ${s.dead ? 'dead' : ''}`}
          aria-current={s.id === currentStepId ? 'step' : undefined}
        >
          <b>{s.phase}</b>
        </li>
      ))}
    </ol>
  )
}
