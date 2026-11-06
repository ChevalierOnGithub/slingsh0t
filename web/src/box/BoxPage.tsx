import type { BoxDetail } from '../../../shared/types'
import { api } from '../api'
import { useEffect, useState } from 'react'
import { recordRecent } from '../recents'
import { useAutosave } from '../autosave'
import { navigate } from '../router'
import { statsChanged } from './StepSection'
import { CredentialsTable } from '../loot/CredentialsTable'
import { FlagsTable } from '../loot/FlagsTable'
import { WorkActs, WorkBody, useWorkItem } from './WorkItem'
import './box.css'

export function BoxPage({ id }: { id: number }) {
  const { item: box, error, reload, change } = useWorkItem<BoxDetail>(`/api/boxes/${id}`)
  if (!box) return error ? <p className="err" role="alert">{error}</p> : null
  return <BoxView box={box} error={error} reload={reload} change={change} />
}

// Split so the DNS autosave hook can take the loaded box as its server value.
function BoxView({ box, error, reload, change }: { box: BoxDetail; error: string | null; reload(): void; change(to: string, body?: unknown, method?: string): Promise<boolean> }) {
  const dns = useAutosave(box.dns, (d) => api('PATCH', `/api/boxes/${box.id}`, { dns: d.trim() }).then(reload), 'the DNS name')
  const url = useAutosave(box.url, (u) => api('PATCH', `/api/boxes/${box.id}`, { url: u.trim() }).then(reload), 'the room link')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => recordRecent('box', box.id, box.name), [box.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async () => {
    if (!confirm(`Delete ${box.name} with its steps, notes, credentials and flags? This can't be undone.`)) return
    try {
      await api('DELETE', `/api/boxes/${box.id}`)
      statsChanged()
      navigate('#/boxes')
    } catch (e) {
      setDeleteError((e as Error).message)
    }
  }
  return (
    <section className="boxpage">
      <header className="boxhead">
        <h1>
          {box.name}
          <input className="dns" type="text" aria-label="DNS name" placeholder="dns name, e.g. example.htb" value={dns.value} onChange={(e) => dns.onChange(e.target.value)} onBlur={dns.flush} />
          {dns.error && <span className="save bad" role="status">Not saved</span>}
        </h1>
        <div className="room">
          {box.url && <a href={box.url} target="_blank" rel="noopener noreferrer">Open on {box.platform} ↗</a>}
          <input className="dns" type="url" aria-label="Room link" placeholder="room link, e.g. https://app.hackthebox.com/machines/…" value={url.value} onChange={(e) => url.onChange(e.target.value)} onBlur={url.flush} />
          {url.error && <span className="save bad" role="status">Not saved</span>}
        </div>
        <div className="facts">
          <span className="sid">{box.shortId}</span>
          <span>{box.platform}</span>
          <span>{box.os}</span>
          <span><span className="dot" style={{ '--c': `var(--${box.difficulty.toLowerCase()})` } as React.CSSProperties} />{box.difficulty}</span>
          {box.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          <span>{box.startedAt ? `Started ${new Date(box.startedAt).toLocaleDateString()}` : 'Not started yet'}</span>
          <button type="button" className="ghost bad" onClick={remove}>Delete box</button>
        </div>
        <WorkActs item={box} change={change} />
        {error && <p className="err" role="alert">{error}</p>}
        {deleteError && <p className="err" role="alert">Couldn't delete the box: {deleteError}</p>}
      </header>
      {/* Loot and Flags fetch on demand, so they mount on first visit. */}
      <WorkBody
        item={box}
        reload={reload}
        extra={{ Loot: () => <CredentialsTable scope={{ boxId: box.id }} />, Flags: () => <FlagsTable scope={{ boxId: box.id }} /> }}
      />
    </section>
  )
}
