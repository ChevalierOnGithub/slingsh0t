import { AD_TAG, type BoxDetail } from '../../../shared/types'
import { api } from '../api'
import { useEffect, useState, type FormEvent } from 'react'
import { recordRecent } from '../recents'
import { useAutosave } from '../autosave'
import { navigate } from '../router'
import { statsChanged } from './StepSection'
import { CredentialsTable } from '../loot/CredentialsTable'
import { FlagsTable } from '../loot/FlagsTable'
import { WorkActs, WorkBody, useWorkItem } from './WorkItem'
import { DIFFICULTIES } from '../boxes/BoxesTable'
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
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const saveDetails = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const tags = f.get('ad') ? [...new Set([...box.tags, AD_TAG])] : box.tags.filter((t) => t !== AD_TAG)
    try {
      await api('PATCH', `/api/boxes/${box.id}`, { name: f.get('name'), os: f.get('os'), difficulty: f.get('difficulty'), tags })
      setEditing(false)
      setEditError(null)
      statsChanged() // difficulty and name feed the rail counts, tally and lists
      reload()
    } catch (err) {
      setEditError((err as Error).message)
    }
  }
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
          {!editing && <button type="button" className="ghost" onClick={() => setEditing(true)}>Edit details</button>}
          <button type="button" className="ghost bad" onClick={remove}>Delete box</button>
        </div>
        {editing && (
          <form className="add edit" aria-label="Box details" onSubmit={saveDetails}>
            <label>Name <input type="text" name="name" required defaultValue={box.name} /></label>
            <label>OS <input type="text" name="os" required defaultValue={box.os} /></label>
            <label>Difficulty <select name="difficulty" defaultValue={box.difficulty}>{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="chk"><input type="checkbox" name="ad" defaultChecked={box.tags.includes(AD_TAG)} /> Active Directory</label>
            <button className="btn primary" type="submit">Save</button>
            <button className="btn" type="button" onClick={() => { setEditing(false); setEditError(null) }}>Cancel</button>
            {editError && <p className="err" role="alert">Couldn't save the details: {editError}</p>}
          </form>
        )}
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
