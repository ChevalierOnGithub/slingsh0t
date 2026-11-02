import { useMemo, useSyncExternalStore } from 'react'

type Page = 'boxes' | 'techniques' | 'tools' | 'shells' | 'writeups' | 'reference' | 'import' | 'networks' | 'loot' | 'credits'
export type Route = ({ name: 'box' | 'host' | 'network'; id: number } | { name: 'writeup'; kind: 'box' | 'network'; id: number } | { name: 'reference'; id?: number } | { name: Exclude<Page, 'reference'> }) & {
  query: URLSearchParams
}

const PAGES: readonly string[] = ['boxes', 'techniques', 'tools', 'shells', 'writeups', 'reference', 'import', 'networks', 'loot', 'credits']

export function parseHash(hash: string): Route {
  const [path, qs = ''] = hash.split(/\?(.*)/)
  const query = new URLSearchParams(qs)
  const w = /^#\/writeups\/network\/(\d+)$/.exec(path)
  if (w) return { name: 'writeup', kind: 'network', id: Number(w[1]), query }
  const m = /^#\/(\w+)(?:\/(\d+))?$/.exec(path)
  if (m?.[1] === 'boxes' && m[2]) return { name: 'box', id: Number(m[2]), query }
  if (m?.[1] === 'hosts' && m[2]) return { name: 'host', id: Number(m[2]), query }
  if (m?.[1] === 'networks' && m[2]) return { name: 'network', id: Number(m[2]), query }
  if (m?.[1] === 'writeups' && m[2]) return { name: 'writeup', kind: 'box', id: Number(m[2]), query }
  if (m?.[1] === 'reference') return { name: 'reference', id: m[2] ? Number(m[2]) : undefined, query }
  if (m && !m[2] && PAGES.includes(m[1])) return { name: m[1] as Exclude<Page, 'reference'>, query }
  return { name: 'boxes', query }
}

const subscribe = (cb: () => void) => {
  addEventListener('hashchange', cb)
  return () => removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return useMemo(() => parseHash(hash), [hash])
}

export const navigate = (hash: string) => {
  location.hash = hash
}
