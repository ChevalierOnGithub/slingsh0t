import { useEffect, useState } from 'react'
import type { WriteupListItem } from '../../../shared/types'
import { api } from '../api'
import { navigate } from '../router'
import { STATUS_LABEL } from '../status'
import './library.css'

const href = (r: WriteupListItem) => r.kind === 'network' ? `#/writeups/network/${r.id}` : `#/writeups/${r.id}`

export function WriteupsPage() {
  const [rows, setRows] = useState<WriteupListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { api<WriteupListItem[]>('GET', '/api/writeups').then(setRows, (e) => setError(e.message)) }, [])

  return (
    <section className="lib">
      <h1>Writeups</h1>
      {error && <p className="err" role="alert">{error}</p>}
      {rows && !rows.length && <p className="empty">No writeups yet. Write a step on any box or network host and it shows up here.</p>}
      {rows && rows.length > 0 && (
        <table className="boxes fixed">
          <colgroup><col className="col-id" /><col /><col className="col-platform" /><col className="col-status" /><col className="col-steps" /><col className="col-released" /></colgroup>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Platform</th><th>Status</th><th>Steps written</th><th>Last updated</th></tr>
          </thead>
          {/* The whole row opens the report; the name link is the keyboard path. */}
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="go" onClick={() => navigate(href(r))}>
                <td>{r.shortId}</td>
                <td><a href={href(r)}>{r.name}</a></td>
                <td>{r.platform}</td>
                <td>{(STATUS_LABEL as Record<string, string>)[r.status] ?? r.status}</td>
                <td className="mono">{r.filledSteps}/{r.totalSteps}</td>
                <td className="mono">{r.updatedAt?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
