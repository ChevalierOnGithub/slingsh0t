import type { Step } from '../../../shared/types'

export function AttackPath({ steps, currentStepId }: { steps: Step[]; currentStepId: number | null }) {
  const sorted = [...steps].sort((a, b) => a.position - b.position)
  return (
    <ol className="path" aria-label="Attack path">
      {sorted.map((s) => (
        <li
          key={s.id}
          className={`${s.id === currentStepId ? 'now' : ''} ${s.dead ? 'dead' : ''}`}
          aria-current={s.id === currentStepId ? 'step' : undefined}
        >
          <b>{s.phase}</b>
        </li>
      ))}
    </ol>
  )
}
