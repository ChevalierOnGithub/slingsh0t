import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { NetworkDetail } from '../../../shared/types'
import { api } from '../api'
import { focusFirstField } from '../forms'
import { navigate } from '../router'
import { recordRecent } from '../recents'
import { Notes } from '../box/Notes'
import { statsChanged } from '../box/StepSection'
import { STATUS_LABEL } from '../status'
import { CredentialsTable } from '../loot/CredentialsTable'
import { FlagsTable } from '../loot/FlagsTable'
import { useTargetContext } from '../shell/TargetBar'
import { TabList, tabPanel } from '../tabs'
import { NetworkMap } from './NetworkMap'
import { NetworkForm } from './NetworksPage'
import '../box/box.css'
import './network.css'

const TABS = ['Map', 'Hosts', 'Flags', 'Notes']

export function NetworkPage({ id }: { id: number }) {
  const { ctx } = useTargetContext()
  const [net, setNet] = useState<NetworkDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState('Map')
  const [editing, setEditing] = useState(false)
  const path = `/api/networks/${id}`
  const deleted = useRef(false)

  useEffect(() => {
    // hashchange (and so the unmount) lands after the delete's stats event: don't reload a network that is gone.
    const load = () => !deleted.current && api<NetworkDetail>('GET', path).then((n) => (setNet(n), setError(null)), (e) => setError(e.message))
    load()
    // The loot tables and this page's own edits announce count changes; the header stats follow them.
    addEventListener('slingsh0t:stats', load)
    return () => removeEventListener('slingsh0t:stats', load)
  }, [path])
  useEffect(() => { if (net) recordRecent('network', net.id, net.name) }, [net?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!net) return error ? <p className="err" role="alert">{error}</p> : null

  const act = async (f: () => Promise<unknown>) => {
    try {
      await f()
      setError(null)
      statsChanged() // also reloads the detail through the listener above
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  const remove = async () => {
    if (!confirm(`Delete ${net.name} with all its hosts, subnets, credentials and flags? This can't be undone.`)) return
    try {
      await api('DELETE', path)
    } catch (e) {
      return setError((e as Error).message)
    }
    deleted.current = true
    navigate('#/networks')
    statsChanged()
  }
  const hosts = net.hosts.map((h) => ({ id: h.id, name: h.name }))
  const unset = 'in-scope count not set'

  return (
    <section className="boxpage">
      <header className="boxhead">
        <h1>{net.name}</h1>
        <div className="facts">
          <span className="sid">{net.shortId}</span>
          <span>{net.platform}</span>
          {net.url && <a href={net.url} target="_blank" rel="noopener noreferrer">Open on {net.platform} ↗</a>}
          <a href={`#/writeups/network/${net.id}`}>Report</a>
          {net.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          <span className="netacts">
            <button type="button" className="ghost" aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit network</button>
            <button type="button" className="ghost bad" onClick={remove}>Delete network</button>
          </span>
        </div>
        <dl className="netstats">
          <div>
            <dt>Hosts owned</dt>
            <dd><b>{net.hostsOwned}</b><span>of {net.hostsFound} found</span><span>{net.hostsInScope === null ? unset : `${net.hostsInScope} in scope`}</span></dd>
          </div>
          <div>
            <dt>Flags captured</dt>
            <dd><b>{net.flagsCaptured}</b><span>{net.flagsInScope === null ? unset : `of ${net.flagsInScope} in scope`}</span></dd>
          </div>
          <div>
            <dt>Credentials</dt>
            <dd><b>{net.credentials}</b></dd>
          </div>
        </dl>
        {editing && (
          <div className="netedit">
            <NetworkForm initial={net} submitLabel="Save network" onCancel={() => setEditing(false)}
              onSubmit={async (body) => (await act(() => api('PATCH', path, body))) && setEditing(false)} />
          </div>
        )}
        {error && <p className="err" role="alert">{error}</p>}
      </header>
      <div className="netbody">
        <div>
          <TabList id="net" tabs={TABS} current={tab} onSelect={setTab} />
          {/* All tabs stay mounted, so half-typed forms and unsaved notes survive tab switches. */}
          <div {...tabPanel('net', 'Map', tab)}>
            <NetworkMap network={net} activeHostId={ctx.activeHostId} onOpenHost={(h) => navigate(`#/hosts/${h}`)} />
          </div>
          <div {...tabPanel('net', 'Hosts', tab)}><HostsTab net={net} /></div>
          <div {...tabPanel('net', 'Flags', tab)}>
            <FlagProgress captured={net.flagsCaptured} inScope={net.flagsInScope} />
            <FlagsTable scope={{ networkId: net.id }} hosts={hosts} />
          </div>
          <div {...tabPanel('net', 'Notes', tab)}><Notes path={path} initial={net.notes} /></div>
        </div>
        <aside className="netpanel" aria-labelledby="net-creds">
          <h2 id="net-creds">Credentials</h2>
          <CredentialsTable scope={{ networkId: net.id }} hosts={hosts} compact />
        </aside>
      </div>
    </section>
  )
}

function FlagProgress({ captured, inScope }: { captured: number; inScope: number | null }) {
  if (inScope === null) return <p className="flagprog">{captured} flags captured, in-scope count not set</p>
  return (
    <p className="flagprog">
      <span>{captured} of {inScope} flags captured</span>
      <span className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, inScope ? (captured / inScope) * 100 : 0)}%` }} /></span>
    </p>
  )
}

/** Host table and add form, then subnet and pivot management. Each form shows its own busy state and error. */
function HostsTab({ net }: { net: NetworkDetail }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inFlight = useRef(false) // state alone lets a fast double-click submit twice before the re-render
  const pivotHosts = new Set(net.pivots.map((p) => p.fromHostId))
  const hostName = (hid: number) => net.hosts.find((h) => h.id === hid)?.name ?? `#${hid}`
  const cidrOf = (sid: number) => net.subnets.find((s) => s.id === sid)?.cidr ?? `#${sid}`
  const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

  const run = async (key: string, f: () => Promise<unknown>) => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(key)
    try {
      await f()
      setErrors((e) => ({ ...e, [key]: '' }))
      statsChanged() // also reloads the page's detail
      return true
    } catch (e) {
      setErrors((x) => ({ ...x, [key]: (e as Error).message }))
      return false
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }
  const submit = (key: string, send: (f: FormData) => Promise<unknown>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    if (!(await run(key, () => send(new FormData(form))))) return
    form.reset()
    focusFirstField(form)
  }
  const err = (k: string) => errors[k] && <p className="err" role="alert">{errors[k]}</p>

  return (
    <div className="hoststab">
      <table className="boxes fixed">
        <colgroup><col className="col-id" /><col /><col className="col-ips" /><col className="col-status" /></colgroup>
        <thead><tr><th>ID</th><th>Host</th><th>IPs</th><th>Status</th></tr></thead>
        <tbody>
          {net.hosts.map((h) => (
            <tr key={h.id}>
              <td>{h.shortId}</td>
              <td><a href={`#/hosts/${h.id}`}>{h.name}</a>{pivotHosts.has(h.id) && <span className="badge">pivot</span>}</td>
              <td className="wrap">
                <ul className="iplist">
                  {[...h.ips].sort((a, b) => +b.primary - +a.primary).map((i) => <li key={i.id}>{i.ip}</li>)}
                </ul>
              </td>
              <td>{STATUS_LABEL[h.status]}</td>
            </tr>
          ))}
          {!net.hosts.length && <tr><td colSpan={4} className="hint">No hosts yet. Add the first one your scan turns up.</td></tr>}
        </tbody>
      </table>
      <form className="add" onSubmit={submit('host', (f) => {
        const ips = text(f, 'ips').split(/[\s,]+/).filter(Boolean)
        if (!ips.length) throw new Error('Add at least one IP')
        return api('POST', `/api/networks/${net.id}/hosts`, { name: text(f, 'name'), os: text(f, 'os'), ips })
      })}>
        <input type="text" name="name" aria-label="Host name" placeholder="Host name" required />
        <input type="text" name="os" aria-label="OS" placeholder="OS" />
        <input type="text" name="ips" className="mono-in" aria-label="IP addresses" placeholder="IPs, primary first" required />
        <button type="submit" className="btn primary" disabled={busy === 'host'}>Add host</button>
        {err('host')}
      </form>

      <h2>Subnets</h2>
      {net.subnets.length ? (
        <ul className="netlist">
          {net.subnets.map((s) => (
            <li key={s.id}>
              <code>{s.cidr}</code>
              <button type="button" className="ghost bad" aria-label={`Delete subnet ${s.cidr}`} disabled={busy !== null}
                onClick={() => confirm(`Delete subnet ${s.cidr} and the pivots into it?`) && run('subnet', () => api('DELETE', `/api/subnets/${s.id}`))}>Delete</button>
            </li>
          ))}
        </ul>
      ) : <p className="hint">No subnets yet. Start with the entry subnet from the lab's connection pack.</p>}
      <form className="add" onSubmit={submit('subnet', (f) => api('POST', `/api/networks/${net.id}/subnets`, { cidr: text(f, 'cidr') }))}>
        <input type="text" name="cidr" className="mono-in" aria-label="Subnet CIDR" placeholder="10.10.110.0/24" required />
        <button type="submit" className="btn primary" disabled={busy === 'subnet'}>Add subnet</button>
        {err('subnet')}
      </form>

      <h2>Pivots</h2>
      {net.pivots.length ? (
        <ul className="netlist">
          {net.pivots.map((p) => {
            const route = `${hostName(p.fromHostId)} reaches ${cidrOf(p.subnetId)}`
            return (
              <li key={p.id}>
                <span>{route}{p.method && ` via ${p.method}`}</span>
                {p.note && <span className="note">{p.note}</span>}
                <button type="button" className="ghost bad" aria-label={`Delete pivot: ${route}`} disabled={busy !== null}
                  onClick={() => confirm(`Delete pivot: ${route}?`) && run('pivot', () => api('DELETE', `/api/pivots/${p.id}`))}>Delete</button>
              </li>
            )
          })}
        </ul>
      ) : <p className="hint">No pivots yet. Record the host you tunnel through and the subnet it opens.</p>}
      <form className="add" onSubmit={submit('pivot', (f) => api('POST', '/api/pivots', {
        fromHostId: Number(f.get('from')), subnetId: Number(f.get('subnet')), method: text(f, 'method'), note: text(f, 'note'),
      }))}>
        <select name="from" aria-label="Pivot host" required defaultValue="">
          <option value="" disabled>Pivot host</option>
          {net.hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select name="subnet" aria-label="Reaches subnet" required defaultValue="">
          <option value="" disabled>Reaches subnet</option>
          {net.subnets.map((s) => <option key={s.id} value={s.id}>{s.cidr}</option>)}
        </select>
        <input type="text" name="method" aria-label="Method" placeholder="Method e.g. ligolo-ng" />
        <input type="text" name="note" aria-label="Note" placeholder="Note" />
        <button type="submit" className="btn primary" disabled={busy === 'pivot'}>Add pivot</button>
        {err('pivot')}
      </form>
    </div>
  )
}
