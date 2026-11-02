import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BoxSummary, Context, NetworkDetail, NetworkSummary } from '../../../shared/types'
import { api } from '../api'

type Ctx = { ctx: Context; update(patch: Partial<Context>): Promise<void>; error: string | null }

const empty: Context = { target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null }
const Store = createContext<Ctx | null>(null)

export function ContextProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<Context>(empty)
  const [error, setError] = useState<string | null>(null)
  // Overlapping GETs/PUTs: only the newest request's response may set the context.
  const seq = useRef(0)
  // Re-read on slingsh0t:stats: deleting the active host or adding a pivot changes the server's context.
  useEffect(() => {
    const load = () => {
      const n = ++seq.current
      api<Context>('GET', '/api/context').then((c) => n === seq.current && setCtx(c), (e) => n === seq.current && setError(e.message))
    }
    load()
    addEventListener('slingsh0t:stats', load)
    return () => removeEventListener('slingsh0t:stats', load)
  }, [])
  const update = useCallback(async (patch: Partial<Context>) => {
    const n = ++seq.current
    try {
      const c = await api<Context>('PUT', '/api/context', patch)
      if (n === seq.current) setCtx(c)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  return <Store.Provider value={{ ctx, update, error }}>{children}</Store.Provider>
}

export function useTargetContext(): Ctx {
  const v = useContext(Store)
  if (!v) throw new Error('ContextProvider missing')
  return v
}

const FIELDS = [
  ['target', 'TARGET', 't'],
  ['lhost', 'LHOST', 'h'],
  ['lport', 'LPORT', 'p'],
] as const
type Key = (typeof FIELDS)[number][0]

export function TargetBar() {
  const { ctx, update, error } = useTargetContext()
  const [boxes, setBoxes] = useState<BoxSummary[]>([])
  const [networks, setNetworks] = useState<NetworkDetail[]>([])
  const [draft, setDraft] = useState(ctx)
  // Which control the current error belongs to: a field, 'active' (Working on), or null (loading the context).
  const [failed, setFailed] = useState<string | null>(null)
  // The field being typed in keeps its draft when the context reloads underneath it (e.g. after slingsh0t:stats).
  const editing = useRef<Key | null>(null)
  // Reload on slingsh0t:stats (boxes and hosts announce their changes with it) and on window focus; navigation alone needs no refetch.
  const seq = useRef(0)
  useEffect(() => {
    const load = () => {
      const n = ++seq.current // overlapping loads: only the newest may set state
      api<BoxSummary[]>('GET', '/api/boxes').then((b) => n === seq.current && setBoxes(b), () => {})
      // shortcut: one request per network (there is no list-hosts endpoint); add GET /api/hosts if labs pile up.
      api<NetworkSummary[]>('GET', '/api/networks')
        .then((ns) => Promise.allSettled(ns.map((x) => api<NetworkDetail>('GET', `/api/networks/${x.id}`))))
        .then((rs) => n === seq.current && setNetworks(rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))), () => {})
    }
    load()
    addEventListener('slingsh0t:stats', load)
    addEventListener('focus', load) // boxes added by a CLI import or another tab announce nothing here
    return () => {
      removeEventListener('slingsh0t:stats', load)
      removeEventListener('focus', load)
    }
  }, [])
  useEffect(() => setDraft((d) => (editing.current ? { ...ctx, [editing.current]: d[editing.current] } : ctx)), [ctx])

  const save = async (key: Key, value = draft[key]) => {
    if (value === ctx[key]) return
    setFailed(key)
    await update({ [key]: value })
  }
  // Send only what changed: the server fills TARGET from the picked box or host, and clears the other pick.
  const pick = (v: string) => {
    setFailed('active')
    const [kind, id] = v.split(':')
    if (kind === 'h') return update({ activeHostId: Number(id) })
    if (kind === 'b') return update({ activeBoxId: Number(id) })
    return update(ctx.activeHostId !== null ? { activeHostId: null } : { activeBoxId: null })
  }
  const boxOptions = useMemo(() => boxes.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>), [boxes])
  const picked = ctx.activeHostId !== null ? `h:${ctx.activeHostId}` : ctx.activeBoxId !== null ? `b:${ctx.activeBoxId}` : ''
  const activeHost = networks.flatMap((n) => n.hosts).find((h) => h.id === ctx.activeHostId)
  const hostIps = ctx.activeHostId === null ? null : activeHost?.ips.map((i) => i.ip) ?? [ctx.target]

  return (
    <div className="top">
      <div className="active">
        <small>Working on</small>
        <select aria-label="Working on" value={picked} onChange={(e) => pick(e.target.value)}>
          <option value="">none</option>
          {/* Keeps the select on the active host while its network hasn't loaded (or failed to). */}
          {ctx.activeHostId !== null && !activeHost && <option value={picked}>Active host</option>}
          <optgroup label="Boxes">
            {boxOptions}
          </optgroup>
          {networks.map((n) => (
            <optgroup key={n.id} label={n.name}>
              {n.hosts.map((h) => <option key={h.id} value={`h:${h.id}`}>{h.name}</option>)}
            </optgroup>
          ))}
        </select>
        {error && (failed === 'active' || failed === null) && <span className="err" role="alert">{error}</span>}
      </div>
      {FIELDS.map(([key, label, cls]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className={`var ${cls}`}>
            <label htmlFor={`ctx-${key}`}>{label}</label>
            {key === 'target' && hostIps ? (
              <select id="ctx-target" value={ctx.target} aria-describedby={ctx.via ? 'ctx-via' : undefined} onChange={(e) => save('target', e.target.value)}>
                {hostIps.map((ip) => <option key={ip}>{ip}</option>)}
              </select>
            ) : (
              <input
                id={`ctx-${key}`}
                type="text"
                value={draft[key]}
                disabled={key === 'target' && ctx.activeBoxId === null}
                title={key === 'target' && ctx.activeBoxId === null ? 'Pick a box or host first' : undefined}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                onFocus={() => (editing.current = key)}
                onBlur={() => { editing.current = null; save(key) }}
                // Enter saves by leaving the field, so the blur that follows can't send a second PUT.
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            )}
          </div>
          {key === 'target' && ctx.via && <span id="ctx-via" className="via">{ctx.via}</span>}
          {error && failed === key && <span className="err" role="alert">{error}</span>}
        </div>
      ))}
      <button type="button" className="search-btn" onClick={() => dispatchEvent(new Event('slingsh0t:search'))}>
        Search <kbd>Ctrl K</kbd>
      </button>
    </div>
  )
}
