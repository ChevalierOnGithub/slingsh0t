import { api } from '../api'
import { useAutosave } from '../autosave'

/** Markdown notes PATCHed as `{ notes }` to `path`; flushes on unmount and guards unload while unsaved. */
export function Notes({ path, initial }: { path: string; initial: string }) {
  const notes = useAutosave(initial, (text) => api('PATCH', path, { notes: text }), 'notes')
  return (
    <div className="notes">
      <textarea aria-label="Notes" value={notes.value} onChange={(e) => notes.onChange(e.target.value)} onBlur={notes.flush} placeholder="Creds, hashes, loose ends. Markdown." />
      <span className={`save ${notes.status === 'Not saved' ? 'bad' : ''}`} role="status">{notes.status}</span>
    </div>
  )
}
