import { useState, type FormEvent } from 'react'
import type { Flag } from '../../../shared/types'
import { api } from '../api'
import { focusFirstField } from '../forms'
import { Secret, scopeQuery, useLoot, type Host } from './shared'

const when = (at: string) => new Date(`${at.replace(' ', 'T')}Z`).toLocaleDateString() // SQLite datetime('now') is UTC

export function FlagsTable({ scope, hosts }: { scope: { networkId: number } | { boxId: number }; hosts?: Host[] }) {
  const { rows, error, run } = useLoot<Flag>(`/api/flags?${scopeQuery(scope)}`)
  const [editing, setEditing] = useState<number | null>(null)
  const nameOf = (hid: number | null) => (hid === null ? '' : hosts?.find((h) => h.id === hid)?.name ?? `#${hid}`)
  const cols = hosts ? 5 : 4

  return (
    <div className="loot">
      {error && <p className="err" role="alert">{error}</p>}
      <table className="loottable">
        <thead>
          <tr><th>Flag</th><th>Value</th>{hosts && <th>Host</th>}<th>Captured</th><th><span className="vh">Actions</span></th></tr>
        </thead>
        <tbody>
          {rows?.map((f) => { const what = f.label || 'no label'; return editing === f.id ? (
            <tr key={f.id}>
              <td colSpan={cols}>
                <FlagForm initial={f} hosts={hosts} onCancel={() => setEditing(null)}
                  onSubmit={(body) => run(async () => { await api('PATCH', `/api/flags/${f.id}`, body); setEditing(null) })} />
              </td>
            </tr>
          ) : (
            <tr key={f.id}>
              <td className="user">{f.label || <span className="none">no label</span>}</td>
              <td>{f.value ? <Secret value={f.value} name={`flag ${what}`} /> : <span className="none">not yet</span>}</td>
              {hosts && <td>{nameOf(f.hostId)}</td>}
              <td className="mono">{f.value ? when(f.capturedAt) : ''}</td>
              <td className="rowacts">
                <button type="button" className="ghost" aria-label={`Edit flag ${what}`} onClick={() => setEditing(f.id)}>Edit</button>
                <button type="button" className="ghost bad" aria-label={`Delete flag ${what}`} onClick={() => confirm(`Delete flag ${what}?`) && run(() => api('DELETE', `/api/flags/${f.id}`))}>Delete</button>
              </td>
            </tr>
          ) })}
          {rows && !rows.length && <tr><td colSpan={cols} className="none">No flags captured yet.</td></tr>}
        </tbody>
      </table>
      <FlagForm hosts={hosts} onSubmit={(body) => run(() => api('POST', '/api/flags', { ...scope, ...body }))} />
      {'networkId' in scope && <ExpectedForm networkId={scope.networkId} run={run} />}
    </div>
  )
}

/** Add (no `initial`) or edit. On edit a blank value keeps the stored one. */
function FlagForm({ initial, hosts, onSubmit, onCancel }: {
  initial?: Flag; hosts?: Host[]; onSubmit(body: Record<string, unknown>): Promise<boolean>; onCancel?(): void
}) {
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const form = e.currentTarget
    const f = new FormData(form)
    const value = String(f.get('value') ?? '').trim()
    const body: Record<string, unknown> = { label: String(f.get('label')).trim() }
    if (value) body.value = value
    if (hosts) body.hostId = f.get('host') ? Number(f.get('host')) : null
    setBusy(true)
    onSubmit(body).then((ok) => {
      setBusy(false)
      if (!ok || initial) return
      form.reset()
      focusFirstField(form)
    })
  }
  return (
    <form className="add lootform" onSubmit={submit}>
      <input type="text" name="label" aria-label="Flag label" placeholder="Label, e.g. user.txt" defaultValue={initial?.label} />
      <input type="text" name="value" aria-label="Flag value" autoComplete="off" spellCheck={false} required={!initial} placeholder={initial ? 'Value (blank keeps it)' : 'Flag value'} />
      {hosts && (
        <select name="host" aria-label="Host" defaultValue={initial?.hostId ?? ''}>
          <option value="">No host</option>
          {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      )}
      <button type="submit" className="btn primary" disabled={busy}>{initial ? 'Save' : 'Add flag'}</button>
      {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
    </form>
  )
}

/** Paste the lab's flag names; each becomes an expected (uncaptured) flag. */
function ExpectedForm({ networkId, run }: { networkId: number; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    run(() => api('POST', '/api/flags/bulk', { networkId, labels: text.split('\n') })).then((ok) => {
      setBusy(false)
      if (ok) setText('')
    })
  }
  return (
    <form className="add lootform" onSubmit={submit}>
      <textarea aria-label="Expected flags, one per line" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the lab's flag names, one per line" />
      <button type="submit" className="btn primary" disabled={busy}>Add expected flags</button>
    </form>
  )
}
