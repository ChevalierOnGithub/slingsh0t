import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AD_TAG, type NetworkDetail, type NetworkPreset, type NetworkSummary } from '../../../shared/types'
import { api } from '../api'
import { navigate } from '../router'
import { statsChanged } from '../box/StepSection'
import './network.css'

const NotSet = ({ n }: { n: number | null }) => (n === null ? <small>not set</small> : <>{n}</>)

/** Create (with presets) or edit; the body matches POST and PATCH /api/networks. */
export function NetworkForm({ initial, presets, submitLabel, onSubmit, onCancel }: {
  initial?: NetworkDetail; presets?: NetworkPreset[]; submitLabel: string
  onSubmit(body: Record<string, unknown>): Promise<unknown>; onCancel?(): void
}) {
  const [form, setForm] = useState({
    platform: initial?.platform ?? 'HTB', name: initial?.name ?? '',
    hostsInScope: String(initial?.hostsInScope ?? ''), flagsInScope: String(initial?.flagsInScope ?? ''), entry: initial?.entry ?? '',
    ad: !!initial?.tags.includes(AD_TAG), tags: initial?.tags.filter((t) => t !== AD_TAG).join(', ') ?? '',
  })
  const [preset, setPreset] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // state alone lets a fast double-click submit twice before the re-render
  const set = (k: 'platform' | 'name' | 'hostsInScope' | 'flagsInScope' | 'tags' | 'entry') => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  // A preset fills platform, name and counts; Manual entry keeps whatever is typed.
  const choose = (id: string) => {
    const p = presets?.find((x) => x.id === id)
    setPreset(id)
    if (p) setForm({ ...form, platform: p.platform, name: p.name, hostsInScope: String(p.hostsInScope ?? ''), flagsInScope: String(p.flagsInScope ?? ''), ad: !!p.tags?.includes(AD_TAG) })
  }
  const count = (v: string) => (v === '' ? null : Number(v))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const tags = [...(form.ad ? [AD_TAG] : []), ...form.tags.split(',').map((t) => t.trim()).filter((t) => t && t !== AD_TAG)]
      await onSubmit({ platform: form.platform, name: form.name.trim(), hostsInScope: count(form.hostsInScope), flagsInScope: count(form.flagsInScope), tags: [...new Set(tags)], entry: form.entry, ...(preset && { presetId: preset }) })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form className="add" onSubmit={submit}>
      {presets && (
        <label>Preset{' '}
          <select className="preset" value={preset} onChange={(e) => choose(e.target.value)}>
            <option value="">Manual entry</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <label>Platform <select value={form.platform} onChange={set('platform')}><option>HTB</option><option>THM</option><option>Other</option></select></label>
      <label>Name <input type="text" value={form.name} onChange={set('name')} required /></label>
      <label>Hosts in scope <input type="number" min={0} step={1} value={form.hostsInScope} onChange={set('hostsInScope')} /></label>
      <label>Flags in scope <input type="number" min={0} step={1} value={form.flagsInScope} onChange={set('flagsInScope')} /></label>
      <label>Entry point <input type="text" value={form.entry} onChange={set('entry')} placeholder="e.g. VPN, 10.10.110.0/24" /></label>
      <label className="chk"><input type="checkbox" checked={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.checked })} /> Active Directory</label>
      <label>Other tags <input type="text" value={form.tags} onChange={set('tags')} placeholder="Comma separated" /></label>
      <button className="btn primary" type="submit" disabled={busy}>{submitLabel}</button>
      {onCancel && <button className="btn" type="button" onClick={onCancel}>Cancel</button>}
    </form>
  )
}

export function NetworksPage() {
  const [networks, setNetworks] = useState<NetworkSummary[] | null>(null)
  const [presets, setPresets] = useState<NetworkPreset[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<NetworkSummary[]>('GET', '/api/networks').then(setNetworks, (e) => setError(e.message))
    api<NetworkPreset[]>('GET', '/api/network-presets').then(setPresets, () => {})
  }, [])

  const add = async (body: Record<string, unknown>) => {
    try {
      const n = await api<NetworkDetail>('POST', '/api/networks', body)
      statsChanged()
      navigate(`#/networks/${n.id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section>
      <h1>Networks</h1>
      {error && <p className="err" role="alert">{error}</p>}
      {networks?.length === 0 && <p className="empty">No networks yet. Add the Pro Lab you're working on.</p>}
      {!!networks?.length && (
        <table className="boxes nets">
          <thead>
            <tr>
              <th>ID</th><th>Name</th><th>Platform</th><th>Hosts owned</th><th>Hosts found</th><th>Hosts in scope</th>
              <th>Flags captured</th><th>Flags in scope</th>
            </tr>
          </thead>
          <tbody>
            {networks.map((n) => (
              <tr key={n.id}>
                <td>{n.shortId}</td>
                <td><a href={`#/networks/${n.id}`}>{n.name}</a></td>
                <td>{n.platform}</td>
                <td className="num">{n.hostsOwned}</td>
                <td className="num">{n.hostsFound}</td>
                <td className="num"><NotSet n={n.hostsInScope} /></td>
                <td className="num">{n.flagsCaptured}</td>
                <td className="num"><NotSet n={n.flagsInScope} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NetworkForm presets={presets} submitLabel="Add network" onSubmit={add} />
    </section>
  )
}
