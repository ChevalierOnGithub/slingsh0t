import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { UnsortedItem } from '../../../shared/types'
import { api } from '../api'
import { apiDownload } from '../download'
import './import.css'

type Result = Record<string, number | string[]>
type Body = Record<string, unknown>
// A function body is resolved inside the guarded section (file reads), so errors and double-submits are handled in one place.
// A function body resolving to null cancels: nothing is posted.
type Run = (path: string, body?: Body | (() => Promise<Body | null>)) => Promise<void>

/** unknownDifficulty -> "unknown difficulty": result keys read as words. */
const words = (k: string) => k.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
const summary = (r: Result) =>
  Object.entries(r)
    .map(([k, v]) => `${words(k)} ${Array.isArray(v) ? v.length : v}`)
    .join(', ')
    .replace(/^./, (c) => c.toUpperCase())

function Panel({ title, note, children }: { title: string; note?: ReactNode; children: (run: Run, busy: boolean) => ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const inFlight = useRef(false)
  const run: Run = async (path, body) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const payload = typeof body === 'function' ? await body() : body
      if (payload === null) return
      setResult(await api<Result>('POST', path, payload))
      window.dispatchEvent(new Event('slingsh0t:stats'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <section className="ipanel" aria-label={title}>
      <h2>{title}</h2>
      {note && <p className="hint">{note}</p>}
      <div className="irow">{children(run, busy)}</div>
      {error && <p className="err" role="alert">{error}</p>}
      <div aria-live="polite">
        {busy && <p className="mono">Running…</p>}
        {result && (
          <>
            <p className="mono">{summary(result)}</p>
            {Object.entries(result).map(
              ([k, v]) =>
                Array.isArray(v) && k !== 'matched' && v.length > 0 && (
                  <p key={k} className="hint">
                    {words(k)}: {v.join(', ')}
                  </p>
                ),
            )}
          </>
        )}
      </div>
    </section>
  )
}

function BackupPanel() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const download = async () => {
    setBusy(true)
    setError('')
    try {
      await apiDownload('POST', '/api/backup')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="ipanel" aria-label="Backup">
      <h2>Backup</h2>
      <p className="hint">Downloads a copy of the database: boxes, writeups, screenshots, loot. Credentials are stored in plain text, so keep the file private. Nothing is kept on the server; run <code>npm run backup</code> for a copy in the data folder.</p>
      <div className="irow">
        <button className="btn primary" disabled={busy} onClick={download}>
          Download backup
        </button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
    </section>
  )
}

const MAX_JSON_BYTES = 20 * 1024 * 1024

async function readJson(file: File): Promise<Body> {
  if (file.size > MAX_JSON_BYTES) throw new Error('That file is over 20 MB. Save only the JSON response.')
  try {
    return { json: JSON.parse(await file.text()) as unknown }
  } catch {
    throw new Error('That file is not valid JSON.')
  }
}

/** Completed-rooms JSON as the server parses it: `{ data: { docs } }` or an array; counts docs with a room code. */
function completedCount(json: unknown) {
  const docs = Array.isArray(json) ? json : (json as { data?: { docs?: unknown } } | null)?.data?.docs
  if (!Array.isArray(docs)) throw new Error('That JSON is not a completed-rooms response: expected { data: { docs: [...] } } or an array.')
  return docs.filter((d) => typeof d?.code === 'string' && d.code).length
}

async function readProgressJson(file: File): Promise<Body | null> {
  const body = await readJson(file)
  return window.confirm(`This marks ${completedCount(body.json)} rooms rooted`) ? body : null
}

function JsonFile({ run, busy, path, label, read = readJson }: { run: Run; busy: boolean; path: string; label: string; read?: (f: File) => Promise<Body | null> }) {
  return (
    <label className="hint">
      {label}{' '}
      <input
        type="file"
        accept=".json,application/json"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) run(path, () => read(file))
        }}
      />
    </label>
  )
}

// Same URLs as importer/thm/client.ts (catalog 50 rooms/page, completed 16 rooms/page).
const CATALOG_URL = 'https://tryhackme.com/api/v2/hacktivities/extended-search?kind=rooms&difficulty=all&order=relevance&roomType=challenge&contentSubType=all&userProgress=all&searchText=&limit=50&page=1'
const NETWORKS_URL = 'https://tryhackme.com/api/v2/hacktivities/extended-search?kind=networks&difficulty=all&order=relevance&roomType=all&contentSubType=all&userProgress=all&searchText=&limit=50&page=1'
const COMPLETED_URL = 'https://tryhackme.com/api/v2/public-profile/completed-rooms?username=YOUR_USERNAME&limit=16&page=1'
const saveNote = (url: string, perPage: number) => (
  <>
    If the live fetch is blocked, open <code className="mono url">{url}</code> in your browser, save the JSON response, and load it here.
    It returns {perPage} rooms per page: change <code className="mono">page=1</code> to 2, 3, … and save each page; loading pages one after another is safe.
  </>
)

export function ImportPage() {
  const [unsorted, setUnsorted] = useState<UnsortedItem[]>([])
  const [names, setNames] = useState('')
  const [unsortedError, setUnsortedError] = useState('')
  const load = useCallback(() => {
    api<UnsortedItem[]>('GET', '/api/unsorted').then(setUnsorted, (e) => setUnsortedError(e.message))
  }, [])
  useEffect(load, [load])
  const button = (run: Run, busy: boolean, label: string, path: string, body?: Body, primary = true) => (
    <button className={primary ? 'btn primary' : 'btn'} disabled={busy} onClick={() => run(path, body)}>
      {label}
    </button>
  )

  return (
    <section>
      <h1>Import / Backup</h1>
      <div className="ipanels">
        <BackupPanel />
        <Panel title="HTB catalog and progress">
          {(run, busy) => button(run, busy, 'Import from HTB', '/api/import/htb')}
        </Panel>
        <Panel title="HTB Pro Labs" note="Creates the known Pro Labs with their host and flag counts and links. Existing ones are left alone.">
          {(run, busy) => button(run, busy, 'Import HTB Pro Labs', '/api/import/networks', { platform: 'HTB' })}
        </Panel>
        <Panel title="THM networks" note={saveNote(NETWORKS_URL, 50)}>
          {(run, busy) => (
            <>
              {button(run, busy, 'Import THM networks', '/api/import/thm-networks', {})}
              <JsonFile run={run} busy={busy} path="/api/import/thm-networks" label="Load networks JSON" />
            </>
          )}
        </Panel>
        <Panel title="THM catalog" note={saveNote(CATALOG_URL, 50)}>
          {(run, busy) => (
            <>
              {button(run, busy, 'Import THM catalog', '/api/import/thm-catalog', {})}
              <JsonFile run={run} busy={busy} path="/api/import/thm-catalog" label="Load catalog JSON" />
            </>
          )}
        </Panel>
        <Panel title="THM progress" note={saveNote(COMPLETED_URL, 16)}>
          {(run, busy) => (
            <>
              <textarea
                aria-label="Paste completed room names, one per line"
                placeholder="Paste completed room names, one per line"
                value={names}
                onChange={(e) => setNames(e.target.value)}
                rows={5}
              />
              {button(run, busy, 'Import pasted rooms', '/api/import/thm-progress', { names: names.split('\n').map((n) => n.trim()).filter(Boolean) })}
              {button(run, busy, 'Read from my THM profile', '/api/import/thm-progress', {}, false)}
              <JsonFile run={run} busy={busy} path="/api/import/thm-progress" label="Load completed-rooms JSON" read={readProgressJson} />
            </>
          )}
        </Panel>
      </div>
      <h2 className="uh">Unsorted ({unsorted.length})</h2>
      {unsortedError && <p className="err" role="alert">{unsortedError}</p>}
      {unsorted.length === 0 ? (
        <p className="empty">Nothing unsorted.</p>
      ) : (
        <ul className="unsorted">
          {unsorted.map((u) => (
            <li key={u.id}>
              <span className="mono">{u.sourcePage}</span>
              <span>{u.content}</span>
              <button
                className="btn"
                aria-label={`Delete ${u.sourcePage}`}
                onClick={() =>
                  api('DELETE', `/api/unsorted/${u.id}`).then(
                    () => setUnsorted((l) => l.filter((x) => x.id !== u.id)),
                    (e) => setUnsortedError(e.message),
                  )
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
