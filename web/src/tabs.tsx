import type { KeyboardEvent } from 'react'

/**
 * WAI-ARIA tabs: one tab stop, Left/Right/Home/End move and select, each panel is labelled by its tab.
 * `id` keeps the element ids unique on the page; panels come from `tabPanel`.
 */
export function TabList({ id, tabs, current, onSelect }: { id: string; tabs: string[]; current: string; onSelect(t: string): void }) {
  const keys = (e: KeyboardEvent) => {
    const i = tabs.indexOf(current)
    const to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 } as Record<string, number>)[e.key]
    if (to === undefined) return
    e.preventDefault()
    const t = tabs[(to + tabs.length) % tabs.length]
    onSelect(t)
    document.getElementById(`${id}-tab-${t}`)?.focus()
  }
  return (
    <div className="tabs" role="tablist" onKeyDown={keys}>
      {tabs.map((t) => (
        <button key={t} type="button" id={`${id}-tab-${t}`} role="tab" aria-selected={current === t} aria-controls={`${id}-panel-${t}`}
          tabIndex={current === t ? 0 : -1} onClick={() => onSelect(t)}>{t}</button>
      ))}
    </div>
  )
}

/** Props for a tab's panel; it stays mounted and is only hidden, so drafts survive tab switches. */
export const tabPanel = (id: string, t: string, current: string) =>
  ({ role: 'tabpanel', id: `${id}-panel-${t}`, 'aria-labelledby': `${id}-tab-${t}`, hidden: current !== t }) as const
