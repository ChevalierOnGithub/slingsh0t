import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { SERVICES, type CredentialKind, type LootItem, type NetworkDetail } from '../../../shared/types'
import { api } from '../api'
import { focusFirstField } from '../forms'
import { Secret, scopeQuery, useLoot, type Host, type Scope } from './shared'

type State = 'untested' | 'works' | 'failed'

const KINDS: [CredentialKind, string][] = [['password', 'Password'], ['ntlm', 'NTLM hash'], ['kerberos', 'Kerberos'], ['ssh_key', 'SSH key'], ['other', 'Other']]
const KIND_LABEL = Object.fromEntries(KINDS) as Record<CredentialKind, string>
const HASHES: CredentialKind[] = ['ntlm', 'kerberos']
const NEXT: Record<State, State> = { untested: 'works', works: 'failed', failed: 'untested' }

/** `compact`: a list instead of the six-column table, for the narrow network-page panel (the full table stays on Loot and box pages). */
export function CredentialsTable({ scope, hosts, compact = false }: { scope: Scope; hosts?: Host[]; compact?: boolean }) {
  const { rows, error, run } = useLoot<LootItem>(`/api/credentials?${scopeQuery(scope)}`)
  const [filter, setFilter] = useState('all') // 'all' | 'password' | 'hash' | a host id
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [pending, setPending] = useState<string | null>(null) // the result toggle whose PUT is in flight
  const all = 'all' in scope
  const toggles = 'networkId' in scope && hosts ? hosts : null
  // Editing a network credential where no host list was passed (Loot page): load its network's hosts for the Works on toggles.
  const [editHosts, setEditHosts] = useState<Host[] | undefined>()
  const editNet = !hosts && rows?.find((c) => c.id === editing)?.scope
  const editNetId = editNet && 'networkId' in editNet ? editNet.networkId : null
  useEffect(() => {
    setEditHosts(undefined)
    if (editNetId === null) return
    let stale = false
    api<NetworkDetail>('GET', `/api/networks/${editNetId}`).then((n) => { if (!stale) setEditHosts(n.hosts.map(({ id, name }) => ({ id, name }))) }, () => {})
    return () => { stale = true }
  }, [editNetId])

  const q = query.trim().toLowerCase()
  const shown = (rows ?? []).filter((c) =>
    (filter === 'all' ? true
      : filter === 'password' ? c.kind === 'password'
      : filter === 'hash' ? HASHES.includes(c.kind)
      : c.results.some((r) => r.hostId === Number(filter) && r.result === 'works'))
    && [c.username, KIND_LABEL[c.kind], c.foundOn?.name ?? '', c.foundNote, c.scopeName ?? ''].some((s) => s.toLowerCase().includes(q)))

  const cycle = async (c: LootItem, h: Host) => {
    const next = NEXT[c.results.find((r) => r.hostId === h.id)?.result ?? 'untested']
    setPending(`${c.id}:${h.id}`)
    await run(() => api('PUT', `/api/credentials/${c.id}/results/${h.id}`, { result: next === 'untested' ? null : next }))
    setPending(null)
  }
  const cols = all ? 7 : 6
  const who = (c: LootItem) => c.username || 'no user'
  const user = (c: LootItem) => c.username || <span className="none">no user</span>
  const secret = (c: LootItem) => <Secret value={c.secret} name={`secret for ${who(c)}`} />
  const found = (c: LootItem) => <>{c.foundOn?.name}{c.foundOn && c.foundNote && ', '}<span className="none">{c.foundNote}</span></>
  const worksOn = (c: LootItem, hs = toggles) => (
    <div className="works">
      {'boxId' in c.scope ? c.worksOn.map((s) => <span key={s} className="res works">{s}</span>)
        : hs
        ? hs.map((h) => {
            const state: State = c.results.find((r) => r.hostId === h.id)?.result ?? 'untested'
            return <button key={h.id} type="button" className={`res ${state}`} aria-label={`${h.name}: ${state}`} title="Click to cycle untested, works, failed" disabled={pending === `${c.id}:${h.id}`} onClick={() => cycle(c, h)}>{h.name}</button>
          })
        : c.results.map((r) => <span key={r.hostId} className={`res ${r.result}`}>{r.name}</span>)}
      {c.untested > 0 && <span className="untested-n">untested {c.untested}</span>}
    </div>
  )
  const actions = (c: LootItem) => (
    <>
      <button type="button" className="ghost" aria-label={`Edit credential ${who(c)}`} onClick={() => setEditing(c.id)}>Edit</button>
      <button type="button" className="ghost bad" aria-label={`Delete credential ${who(c)}`} onClick={() => confirm(`Delete the ${KIND_LABEL[c.kind]} for ${who(c)}?`) && run(() => api('DELETE', `/api/credentials/${c.id}`))}>Delete</button>
    </>
  )
  const form = (c: LootItem) => {
    const hs = 'networkId' in c.scope ? hosts ?? editHosts : undefined
    return (
      <CredForm initial={c} hosts={hs} services={'boxId' in c.scope} onCancel={() => setEditing(null)}
        onSubmit={(body) => run(async () => { await api('PATCH', `/api/credentials/${c.id}`, body); setEditing(null) })}>
        {hs && hs.length > 0 && <div className="works-edit"><span>Works on</span>{worksOn(c, hs)}</div>}
      </CredForm>
    )
  }
  const empty = rows && !shown.length ? (rows.length ? 'No credentials match.' : 'No credentials yet.') : null

  return (
    <div className="loot">
      <div className="filters">
        <div className="seg" role="group" aria-label="Show">
          {[['all', 'All'], ['password', 'Passwords'], ['hash', 'Hashes']].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        {hosts && hosts.length > 0 && (
          <select aria-label="Works on" value={/^\d+$/.test(filter) ? filter : ''} onChange={(e) => setFilter(e.target.value || 'all')}>
            <option value="">Works on any host</option>
            {hosts.map((h) => <option key={h.id} value={h.id}>Works on {h.name}</option>)}
          </select>
        )}
        <input type="text" aria-label="Search credentials" placeholder="Search user, host or note" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {compact ? (
        <ul className="credlist" aria-label="Credentials">
          {shown.map((c) => (
            <li key={c.id}>
              {editing === c.id ? form(c) : (
                <>
                  <div className="cred-line">
                    <span className="user">{user(c)}</span>
                    <span className="kind">{KIND_LABEL[c.kind]}</span>
                    {secret(c)}
                    <span className="rowacts">{actions(c)}</span>
                  </div>
                  {worksOn(c)}
                  {(c.foundOn || c.foundNote) && <p className="cred-found">{c.foundOn ? <>Found on {found(c)}</> : c.foundNote}</p>}
                </>
              )}
            </li>
          ))}
          {empty && <li className="none">{empty}</li>}
        </ul>
      ) : (
      <div className="tablescroll">
      <table className="loottable">
        <thead>
          <tr>
            {all && <th>Found in</th>}
            <th>User</th><th>Kind</th><th>Secret</th><th>Found on</th><th>Works on</th><th><span className="vh">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => editing === c.id ? (
            <tr key={c.id}><td colSpan={cols}>{form(c)}</td></tr>
          ) : (
            <tr key={c.id}>
              {all && <td><span className="sid">{c.scopeShortId}</span> {c.scopeName}</td>}
              <td className="user">{user(c)}</td>
              <td>{KIND_LABEL[c.kind]}</td>
              <td>{secret(c)}</td>
              <td>{found(c)}</td>
              <td>{worksOn(c)}</td>
              <td className="rowacts">{actions(c)}</td>
            </tr>
          ))}
          {empty && <tr><td colSpan={cols} className="none">{empty}</td></tr>}
        </tbody>
      </table>
      </div>
      )}
      {!all && <CredForm hosts={hosts} services={'boxId' in scope} onSubmit={(body) => run(() => api('POST', '/api/credentials', { ...scope, ...body }))} />}
    </div>
  )
}

/** Add (no `initial`) or edit. On edit a blank secret keeps the stored one, so it never sits in an input unrevealed. */
function CredForm({ initial, hosts, services, onSubmit, onCancel, children }: {
  initial?: LootItem; hosts?: Host[]; services: boolean; onSubmit(body: Record<string, unknown>): Promise<boolean>; onCancel?(): void; children?: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string[]>(initial?.worksOn ?? [])
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const secret = String(f.get('secret') ?? '')
    const body: Record<string, unknown> = { username: String(f.get('username')).trim(), kind: f.get('kind'), foundNote: String(f.get('note')).trim() }
    if (secret) body.secret = secret
    if (hosts) body.foundOnHostId = f.get('host') ? Number(f.get('host')) : null
    if (services) body.worksOn = picked
    setBusy(true)
    onSubmit(body).then((ok) => {
      setBusy(false)
      if (!ok || initial) return
      form.reset()
      setPicked([])
      focusFirstField(form)
    })
  }
  return (
    <form className="add lootform" onSubmit={submit}>
      <input type="text" name="username" aria-label="User" placeholder="User" defaultValue={initial?.username} />
      <select name="kind" aria-label="Kind" defaultValue={initial?.kind ?? 'password'}>
        {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input type="text" name="secret" aria-label="Secret" autoComplete="off" spellCheck={false} required={!initial} placeholder={initial ? 'Keep if blank' : 'Secret'} />
      {hosts && (
        <select name="host" aria-label="Found on" defaultValue={initial?.foundOn?.hostId ?? ''}>
          <option value="">Found on no host</option>
          {hosts.map((h) => <option key={h.id} value={h.id}>Found on {h.name}</option>)}
        </select>
      )}
      <input type="text" name="note" aria-label="Note" placeholder="Where it came from" defaultValue={initial?.foundNote} />
      <button type="submit" className="btn primary" disabled={busy}>{initial ? 'Save' : 'Add credential'}</button>
      {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      {services && (
        <div className="works-edit" role="group" aria-label="Works on">
          <span>Works on</span>
          <div className="works">
            {SERVICES.map((s) => {
              const on = picked.includes(s)
              return <button key={s} type="button" className={`res ${on ? 'works' : 'untested'}`} aria-pressed={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}>{s}</button>
            })}
          </div>
        </div>
      )}
      {children}
    </form>
  )
}
