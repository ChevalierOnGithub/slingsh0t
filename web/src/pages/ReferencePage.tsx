import { useEffect, useRef, useState } from 'react'
import type { ReferencePage as Page } from '../../../shared/types'
import { api } from '../api'
import { reportLost } from '../autosave'
import { recordRecent } from '../recents'
import { Editor } from '../box/Editor'
import { jump, md } from '../box/StepSection'
import '../box/box.css' // .md typography
import './library.css'

export function ReferencePage({ id }: { id?: number }) {
  const [pages, setPages] = useState<Page[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { api<Page[]>('GET', '/api/reference').then(setPages, (e) => setError(e.message)) }, [])
  // Edits made in another tab show up when this one is focused again.
  useEffect(() => {
    const reload = () => {
      const at = saves.current
      api<Page[]>('GET', '/api/reference').then((ps) => { if (saves.current === at) setPages(ps) }, () => {})
    }
    addEventListener('focus', reload)
    return () => removeEventListener('focus', reload)
  }, [])
  const saves = useRef(0) // bumped by every completed save, so an older reload can be told apart
  const page = pages?.find((p) => p.id === id)
  useEffect(() => { if (page) recordRecent('reference', page.id, page.title) }, [page?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="lib">
      <h1>Reference</h1>
      {error && <p className="err" role="alert">{error}</p>}
      {pages && !pages.length && <p className="empty">No reference pages yet.</p>}
      {pages && pages.length > 0 && (
        <div className="ref">
          <nav aria-label="Reference pages">
            {pages.map((p) => <a key={p.id} href={`#/reference/${p.id}`} aria-current={p.id === id ? 'page' : undefined}>{p.title}</a>)}
          </nav>
          {page ? (
            <View key={page.id} page={page} onSaved={(saved) => { saves.current++; setPages((ps) => ps!.map((p) => (p.id === saved.id ? saved : p))) }} />
          ) : (
            <p className="empty">{id ? 'That page does not exist.' : 'Pick a page to read it.'}</p>
          )}
        </div>
      )}
    </section>
  )
}

function View({ page, onSaved }: { page: Page; onSaved(p: Page): void }) {
  const [editing, setEditing] = useState(false)
  const [left, setLeft] = useState(false) // just left edit mode: the Edit button takes focus back
  const [title, setTitle] = useState(page.title)
  const [body, setBody] = useState(page.body)
  const [error, setError] = useState<string | null>(null)
  const saved = useRef({ title: page.title, body: page.body })
  const latest = useRef(saved.current)
  latest.current = { title, body }
  const same = (a: typeof saved.current, b: typeof saved.current) => a.title === b.title && a.body === b.body
  const dirty = () => !same(latest.current, saved.current)
  const inflight = useRef<{ sent: typeof saved.current; p: Promise<void> } | null>(null) // a Save still on its way when the page unmounts

  // A newer copy from the server replaces a page with nothing unsaved and not being edited.
  useEffect(() => {
    if (dirty() || editing) return
    saved.current = { title: page.title, body: page.body }
    setTitle(page.title)
    setBody(page.body)
  }, [page, editing]) // editing: a copy skipped while editing is taken once editing ends clean

  const put = (sent = latest.current) => {
    const p = (async () => {
      const r = await api<Page>('PUT', `/api/reference/${page.id}`, sent)
      saved.current = sent
      onSaved(r)
      dispatchEvent(new Event('slingsh0t:stats'))
    })()
    const mine = (inflight.current = { sent, p })
    const clear = () => { if (inflight.current === mine) inflight.current = null }
    p.then(clear, clear)
    return p
  }
  const save = async () => {
    if (!dirty()) return cancel()
    try {
      await put()
      setError(null)
      setEditing(false)
      setLeft(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const cancel = () => {
    setTitle(saved.current.title)
    setBody(saved.current.body)
    setEditing(false)
    setLeft(true)
    setError(null)
  }
  // Warn before closing the tab with unsaved edits; save them when the page goes away (navigation).
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => dirty() && e.preventDefault()
    addEventListener('beforeunload', guard)
    return () => {
      removeEventListener('beforeunload', guard)
      // A blank title falls back to the saved one instead of failing the save. A Save of this text still in flight is not re-sent, only watched.
      const { title, body } = latest.current
      const lost = (e: unknown) => reportLost(saved.current.title, (e as Error).message)
      if (inflight.current && same(inflight.current.sent, latest.current)) inflight.current.p.catch(lost)
      else if (dirty()) put({ title: title.trim() ? title : saved.current.title, body }).catch(lost)
    }
  }, [])

  return (
    <article>
      <header>
        {editing ? <input type="text" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} /> : <h2>{page.title}</h2>}
        {editing ? (
          <>
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={cancel}>Cancel</button>
          </>
        ) : (
          <button className="btn" autoFocus={left} onClick={() => setEditing(true)}>Edit</button>
        )}
      </header>
      {error && <p className="err" role="alert">Not saved: {error}</p>}
      {editing ? (
        <Editor value={body} onChange={setBody} label={`${page.title} markdown`} autoFocus />
      ) : (
        <div className="md" onClick={jump} dangerouslySetInnerHTML={{ __html: md.render(page.body) || '<p class="blank">This page is empty.</p>' }} />
      )}
    </article>
  )
}
