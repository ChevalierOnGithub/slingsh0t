import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { statsChanged } from '../box/StepSection'
import { useCopy } from '../library/useCopy'
import './loot.css'

export type Host = { id: number; name: string }
export type Scope = { networkId: number } | { boxId: number } | { all: true }

/** `networkId=2` / `boxId=3` / `all=1` for the loot list endpoints. */
export const scopeQuery = (s: Scope) => ('all' in s ? 'all=1' : 'networkId' in s ? `networkId=${s.networkId}` : `boxId=${s.boxId}`)

/** Loads a loot list; `run` mutates, refetches (awaited, so callers can hold a button until fresh rows land) and tells the shell counts moved. */
export function useLoot<T>(url: string) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => api<T[]>('GET', url).then(setRows, (e) => setError(e.message)), [url])
  useEffect(() => { load() }, [load])
  const run = async (f: () => Promise<unknown>) => {
    try {
      await f()
      setError(null)
      statsChanged()
      await load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  return { rows, error, run }
}

/**
 * Masked by default: the value reaches the DOM only after Reveal. Copy never reveals it.
 * `name` labels the buttons ("secret for svc_web"); it must never contain the value.
 */
export function Secret({ value, name }: { value: string; name: string }) {
  const [shown, setShown] = useState(false)
  const [copy, doCopy] = useCopy()
  return (
    <span className="secret">
      <code className={shown ? undefined : 'masked'}>{shown ? value : '••••••'}</code>
      <button type="button" className="ghost" aria-label={`${shown ? 'Hide' : 'Reveal'} ${name}`} onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Reveal'}</button>
      <button type="button" className="ghost" aria-label={`Copy ${name}`} onClick={() => doCopy(value)}>{copy}</button>
      <span className="vh" aria-live="polite">{copy === 'Copy' ? '' : copy}</span>
    </span>
  )
}
