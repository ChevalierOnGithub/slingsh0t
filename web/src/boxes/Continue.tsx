import type { BoxSummary } from '../../../shared/types'
import { useTargetContext } from '../shell/TargetBar'
import { STATUS_LABEL } from '../status'

/** The active box, then the most recently started in-progress / user-flag boxes; at most four. */
export const continueList = (boxes: BoxSummary[], activeId: number | null): BoxSummary[] => {
  const active = boxes.find((b) => b.id === activeId && b.status !== 'rooted')
  const live = boxes
    .filter((b) => b !== active && (b.status === 'in_progress' || b.status === 'user_flag'))
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || b.id - a.id) // '' sorts nulls last when desc
  return [...(active ? [active] : []), ...live].slice(0, 4)
}

export function Continue({ boxes }: { boxes: BoxSummary[] }) {
  const list = continueList(boxes, useTargetContext().ctx.activeBoxId)
  if (!list.length) return null
  return (
    <nav className="continue" aria-label="Continue">
      <h2>Continue</h2>
      {list.map((b) => (
        <a key={b.id} href={`#/boxes/${b.id}`}>
          <span className="sid">{b.shortId}</span> <b>{b.name}</b> <span>{STATUS_LABEL[b.status]}</span>
        </a>
      ))}
    </nav>
  )
}
