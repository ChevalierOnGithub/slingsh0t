import { setTimeout as sleep } from 'node:timers/promises'
import type { Difficulty } from '../../shared/types'

export type ThmRoom = { code: string; title: string; difficulty: Difficulty; os: string; releaseDate: string | null }
/** A THM network (multi-machine room): `ad` when THM tags it Active Directory, `kind` walkthrough or challenge. */
export type ThmNetwork = { code: string; title: string; description: string; difficulty: Difficulty | null; kind: 'walkthrough' | 'challenge'; ad: boolean }

// Undocumented endpoints the tryhackme.com website calls; shapes in the slice-1 task-3 report.
const API = 'https://tryhackme.com/api/v2'
const DIFFICULTY: Record<string, Difficulty> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane' }
const MAX_PAGES = 200
const TIMEOUT_MS = 30_000

type Doc = { code?: unknown; title?: unknown; difficulty?: unknown; tagDocs?: unknown; description?: unknown; type?: unknown; technologyTags?: unknown; tags?: unknown; kind?: unknown; published?: unknown }

/** Accepts a THM response body (`{ data: { docs } }`) or a bare docs array. */
function docsOf(json: unknown): Doc[] {
  const docs = Array.isArray(json) ? json : (json as { data?: { docs?: unknown } } | null)?.data?.docs
  if (!Array.isArray(docs)) throw new Error('TryHackMe JSON has an unexpected shape: expected { data: { docs: [...] } }')
  return docs.map((d) => (d && typeof d === 'object' ? d : {}) as Doc)
}

/** Challenge rooms from a search response (fetched or saved from the browser). Bad items and THM `info` rooms are skipped. */
export function parseRoomsJson(json: unknown): ThmRoom[] {
  return docsOf(json).flatMap((d) => {
    const key = String(d.difficulty).toLowerCase()
    const difficulty = Object.hasOwn(DIFFICULTY, key) ? DIFFICULTY[key] : undefined
    const title = typeof d.title === 'string' ? d.title.trim() : ''
    if (typeof d.code !== 'string' || !d.code || !title || !difficulty) return []
    // No OS field in the search docs; the OS shows up as a tag (`technologyTags` today, `tagDocs[].label` in older responses).
    const tags = [...(Array.isArray(d.technologyTags) ? d.technologyTags : []), ...(Array.isArray(d.tags) ? d.tags : []),
      ...(Array.isArray(d.tagDocs) ? d.tagDocs.map((t) => t?.label) : [])].map((t) => String(t).trim().toLowerCase())
    const os = tags.includes('windows') ? 'Windows' : tags.includes('linux') ? 'Linux' : ''
    const releaseDate = typeof d.published === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.published) ? d.published.slice(0, 10) : null
    return [{ code: d.code, title, difficulty, os, releaseDate }]
  })
}

/** Networks from an extended-search response with kind=networks (fetched or saved from the browser). Bad items are skipped. */
export function parseNetworksJson(json: unknown): ThmNetwork[] {
  return docsOf(json).flatMap((d) => {
    const title = typeof d.title === 'string' ? d.title.trim() : ''
    if (typeof d.code !== 'string' || !d.code || !title) return []
    const key = String(d.difficulty).toLowerCase()
    const difficulty = Object.hasOwn(DIFFICULTY, key) ? DIFFICULTY[key] : null
    const tags = [...(Array.isArray(d.technologyTags) ? d.technologyTags : []), ...(Array.isArray(d.tags) ? d.tags : [])].map((t) => String(t).trim().toLowerCase())
    return [{
      code: d.code, title, description: typeof d.description === 'string' ? d.description.trim() : '', difficulty,
      kind: d.type === 'challenge' ? 'challenge' : 'walkthrough', ad: tags.includes('active directory'),
    }]
  })
}

/** Room codes from a completed-rooms response (fetched or saved from the browser). */
export function parseCompletedJson(json: unknown): string[] {
  return docsOf(json).flatMap((d) => (typeof d.code === 'string' && d.code ? [d.code] : []))
}

async function getPage(url: string, fetchImpl: typeof fetch): Promise<{ docs: Doc[]; totalPages?: number }> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`TryHackMe answered HTTP ${res.status} (${res.headers.get('content-type') ?? 'no content type'}) for ${url}. `
      + 'Its bot checkpoint often blocks scripted requests; paste your completed rooms in the Import screen instead.')
  }
  const body = await res.json()
  const totalPages = (body as { data?: { totalPages?: unknown } } | null)?.data?.totalPages
  return { docs: docsOf(body), totalPages: typeof totalPages === 'number' ? totalPages : undefined }
}

type Wait = (ms: number) => Promise<unknown>

/** All pages: stops on an empty page or totalPages, not on a short page, so a server-side limit cap can't truncate silently. */
async function allDocs(url: (page: number) => string, fetchImpl: typeof fetch, wait: Wait): Promise<Doc[]> {
  const out: Doc[] = []
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`TryHackMe kept returning pages past ${MAX_PAGES}; stopped rather than import a partial list.`)
    if (page > 1) await wait(1000) // ~1 req/s, be polite to THM
    const { docs, totalPages } = await getPage(url(page), fetchImpl)
    out.push(...docs)
    if (!docs.length || page >= (totalPages ?? Infinity)) return out
  }
}

/** Challenge (CTF) rooms only. */
export async function fetchChallengeRooms(fetchImpl: typeof fetch = fetch, wait: Wait = sleep): Promise<ThmRoom[]> {
  return parseRoomsJson(await allDocs((page) => `${API}/hacktivities/extended-search?kind=rooms&difficulty=all&order=relevance`
    + `&roomType=challenge&contentSubType=all&userProgress=all&searchText=&limit=50&page=${page}`, fetchImpl, wait))
}

/** Every THM network (roomType=all: walkthroughs and challenges). */
export async function fetchNetworks(fetchImpl: typeof fetch = fetch, wait: Wait = sleep): Promise<ThmNetwork[]> {
  return parseNetworksJson(await allDocs((page) => `${API}/hacktivities/extended-search?kind=networks&difficulty=all&order=relevance`
    + `&roomType=all&contentSubType=all&userProgress=all&searchText=&limit=50&page=${page}`, fetchImpl, wait))
}

/** Room codes on the user's public profile (all room types; non-catalog codes end up unmatched). */
export async function fetchCompletedRooms(username: string, fetchImpl: typeof fetch = fetch, wait: Wait = sleep): Promise<string[]> {
  // limit 16: larger page sizes are reported to 404 on this endpoint
  return parseCompletedJson(await allDocs((page) =>
    `${API}/public-profile/completed-rooms?username=${encodeURIComponent(username)}&limit=16&page=${page}`, fetchImpl, wait))
}
