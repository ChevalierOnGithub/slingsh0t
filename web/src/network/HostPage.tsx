import { useEffect, useState, type FormEvent } from 'react'
import type { HostDetail } from '../../../shared/types'
import { api } from '../api'
import { WorkActs, WorkBody, useWorkItem } from '../box/WorkItem'
import { statsChanged } from '../box/StepSection'
import { navigate } from '../router'
import { recordRecent } from '../recents'

export function HostPage({ id }: { id: number }) {
  const { item: host, error, reload, change } = useWorkItem<HostDetail>(`/api/hosts/${id}`)
  const [network, setNetwork] = useState<{ name?: string; error?: string }>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const networkId = host?.networkId
  useEffect(() => {
    if (networkId) api<{ name: string }>('GET', `/api/networks/${networkId}`).then((n) => setNetwork({ name: n.name }), (e) => setNetwork({ error: e.message }))
  }, [networkId])
  useEffect(() => { if (host) recordRecent('host', host.id, host.name) }, [host?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!host) return error ? <p className="err" role="alert">{error}</p> : null

  const remove = async () => {
    if (!confirm(`Delete ${host.name} with its steps, IPs, pivots and credential results? This can't be undone.`)) return
    try {
      await api('DELETE', `/api/hosts/${host.id}`)
      statsChanged()
      navigate(`#/networks/${host.networkId}`)
    } catch (e) {
      setDeleteError((e as Error).message)
    }
  }
  const addIp = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const ip = String(new FormData(form).get('ip') ?? '').trim()
    if (ip) change(`/api/hosts/${host.id}/ips`, { ip }, 'POST').then((ok) => ok && form.reset())
  }

  return (
    <section className="boxpage">
      <header className="boxhead">
        <h1>{host.name}</h1>
        <div className="facts">
          <span className="sid">{host.shortId}</span>
          <a className="netlink" href={`#/networks/${host.networkId}`}>{network.name ?? 'Network'}</a>
          {host.os && <span>{host.os}</span>}
          <ul className="ips" aria-label="IP addresses">
            {host.ips.map((i) => (
              <li key={i.id} className={i.primary ? 'primary' : undefined}>
                <span>{i.ip}</span>
                {i.primary && <small>primary</small>}
                {host.ips.length > 1 && <button className="ghost" aria-label={`Remove ${i.ip}`} title="Remove" onClick={() => confirm(`Remove ${i.ip} from ${host.name}?`) && change(`/api/hosts/${host.id}/ips/${i.id}`, undefined, 'DELETE')}>×</button>}
              </li>
            ))}
          </ul>
          <form className="ipadd" onSubmit={addIp}>
            <input type="text" name="ip" aria-label="New IP address" placeholder="Add an IP" required />
            <button className="ghost" type="submit">Add</button>
          </form>
          <button type="button" className="ghost bad" onClick={remove}>Delete host</button>
        </div>
        <WorkActs item={host} change={change} />
        {error && <p className="err" role="alert">{error}</p>}
        {deleteError && <p className="err" role="alert">Couldn't delete the host: {deleteError}</p>}
        {network.error && <p className="err" role="alert">Couldn't load the network name: {network.error}</p>}
      </header>
      <WorkBody item={host} reload={reload} />
    </section>
  )
}
