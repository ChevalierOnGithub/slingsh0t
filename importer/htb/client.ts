import { setTimeout as sleep } from 'node:timers/promises'
import { mapMachine, type HtbMachine } from './map'

const LISTS = ['https://labs.hackthebox.com/api/v4/machine/paginated', 'https://labs.hackthebox.com/api/v4/machine/list/retired/paginated']
const PER_PAGE = 100
const MAX_RETRIES = 5
const MAX_PAGES = 100
const TIMEOUT_MS = 30_000
const MAX_RETRY_AFTER = 60 // seconds; a huge Retry-After must not hang the import

type Page = { data?: unknown; meta?: { current_page?: number; last_page?: unknown } }
/** Still a plain HtbMachine[]; the extra count lets importHtb report unknown-difficulty skips. */
export type FetchedMachines = HtbMachine[] & { unknownDifficulty: number }

/** Active + retired machines with the token owner's progress. ~1 request/s, backs off on 429. */
export async function fetchMachines(token: string, fetchImpl: typeof fetch = fetch, wait: (ms: number) => Promise<unknown> = sleep): Promise<FetchedMachines> {
  const init = { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  const machines = Object.assign([] as HtbMachine[], { unknownDifficulty: 0 })
  let requests = 0
  for (const list of LISTS) {
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new Error('HTB kept returning pages; stopped')
      const url = `${list}?per_page=${PER_PAGE}&page=${page}`
      let res: Response
      for (let retry = 0; ; retry++) {
        if (requests++) await wait(1000)
        res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) // fresh per request, retries included
        if (res.status !== 429) break
        if (retry === MAX_RETRIES) throw new Error(`HTB API 429 (rate limited) after ${MAX_RETRIES} retries: ${url}`)
        await wait(Math.min(Number(res.headers.get('retry-after')) || 2 ** retry, MAX_RETRY_AFTER) * 1000)
      }
      if (!res.ok) throw new Error(`HTB API ${res.status} ${res.statusText}: ${url}`)
      const body = (await res.json().catch(() => null)) as Page | null
      if (!Array.isArray(body?.data)) throw new Error(`HTB API response has no data array: ${url}`)
      const items = body.data as Record<string, unknown>[]
      for (const raw of items) {
        const m = mapMachine(raw)
        if (m) machines.push(m)
        else machines.unknownDifficulty++
      }
      const lastPage = body.meta?.last_page
      // meta wins over page size, so a server that caps per_page cannot truncate the import.
      if (items.length === 0 || (typeof lastPage === 'number' ? (body.meta?.current_page ?? page) >= lastPage : items.length < PER_PAGE)) break
    }
  }
  return machines
}
