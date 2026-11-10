import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { AD_TAG, PHASES, type Attachment, type Context, type Step, type WorkItem } from '../../../shared/types'
import { substitute } from '../../../shared/placeholders'
import { slugger } from '../../../shared/slug'
import { api, upload } from '../api'
import { reportLost, useAutosave } from '../autosave'
import { useTargetContext } from '../shell/TargetBar'
import { Editor } from './Editor'

export type Mode = 'live' | 'markdown' | 'split'
/** A Toolbox insert request for one step; the parent clears it once applied. */
export type Insert = { stepId: number; template: string }

export const md = new MarkdownIt({ html: false, linkify: true })
// A click in the live preview must not navigate the app tab away; `#` hrefs (in-page anchors, `#/` app routes) stay in this tab.
md.renderer.rules.link_open = (tokens, i, opts, _env, self) => {
  if (!String(tokens[i].attrGet('href')).startsWith('#')) {
    tokens[i].attrSet('target', '_blank')
    tokens[i].attrSet('rel', 'noopener noreferrer')
  }
  return self.renderToken(tokens, i, opts)
}
// Every code block gets a Copy button; `jump` handles the click, so the markup stays plain HTML. `env.plain` (the HTML export) skips it.
for (const rule of ['fence', 'code_block'] as const) {
  const base = md.renderer.rules[rule]!
  md.renderer.rules[rule] = (tokens, i, opts, env, self) =>
    env?.plain ? base(tokens, i, opts, env, self) : `<div class="codeblock">${base(tokens, i, opts, env, self)}<button type="button" class="copycode" aria-label="Copy code block">Copy</button></div>`
}
// GitHub-style heading ids, so a report's `[x](#machines)` links resolve.
md.core.ruler.push('heading_ids', (state) => {
  const slug = slugger()
  state.tokens.forEach((t, i) => { if (t.type === 'heading_open') t.attrSet('id', slug(state.tokens[i + 1].content)) })
})
/**
 * onClick for a rendered `md` preview. A code block's Copy button copies its text (the DOM is innerHTML, so the label is flipped in place);
 * the app routes on location.hash, so an in-page anchor scrolls within this preview instead of reaching the router.
 */
export const jump = (e: MouseEvent<HTMLElement>) => {
  const copy = (e.target as Element).closest('button.copycode')
  if (copy && e.currentTarget.contains(copy)) {
    e.stopPropagation() // a live-mode preview opens the editor on click; copying is not editing
    const text = copy.parentElement?.querySelector('pre')?.textContent?.replace(/\n$/, '') ?? ''
    navigator.clipboard.writeText(text).then(() => {
      copy.textContent = 'Copied'
      setTimeout(() => { copy.textContent = 'Copy' }, 1500)
    }, () => { copy.textContent = 'Copy failed' })
    return
  }
  const a = (e.target as Element).closest('a[href^="#"]:not([href^="#/"])') // `#/…` is an app route: let the router have it
  if (!a || !e.currentTarget.contains(a)) return
  e.preventDefault()
  const raw = a.getAttribute('href')!.slice(1)
  let id = raw // markdown-it percent-encodes non-ASCII slugs; a malformed escape falls back to the raw fragment
  try { id = decodeURIComponent(raw) } catch { /* keep raw */ }
  const target = [...e.currentTarget.querySelectorAll('[id]')].find((el) => el.id === id) // inside this preview only: other previews reuse ids
  target?.scrollIntoView()
}
const SAVE_DELAY = 800
const LOOP = [
  ['saw', 'Saw', "What's there"],
  ['think', 'Think', 'What it probably means'],
  ['tried', 'Tried', 'What you ran (tools, by name)'],
  ['got', 'Got', 'What came of it'],
] as const
/** Tells the shell to refetch its counts (steps, writeups, statuses). */
export const statsChanged = () => dispatchEvent(new Event('slingsh0t:stats'))
/** API base for a box or host: /api/boxes/1, /api/hosts/3. */
export const ownerPath = (item: WorkItem) => `/api/${item.kind === 'box' ? 'boxes' : 'hosts'}/${item.id}`

/** The bar's TARGET for the active box or host, else the item's own stored IP. */
export const targetOf = (item: Pick<WorkItem, 'id' | 'kind' | 'targetIp'>, ctx: Pick<Context, 'target' | 'activeBoxId' | 'activeHostId'>) =>
  (item.kind === 'box' ? ctx.activeBoxId : ctx.activeHostId) === item.id ? ctx.target : (item.targetIp ?? '')

export const imageMarkdown = (a: { key: string; name: string }) => `![${a.name.replace(/[[\]()]/g, '')}](/api/files/${a.key})`

/** Runs a mutation then reloads the box, keeping the last error for display. */
export function useAct(reload: () => void) {
  const [error, setError] = useState<string | null>(null)
  const act = async (f: () => Promise<unknown>) => {
    try {
      await f()
      setError(null)
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return [act, error] as const
}

export function StepSection({ step, item, mode, ordinal, insert, onInserted, onUp, onDown, reload, moveError = null }: {
  step: Step; item: WorkItem; mode: Mode; ordinal: number; insert: Insert | null; onInserted(): void
  onUp: (() => void) | null; onDown: (() => void) | null; reload(): void; moveError?: string | null
}) {
  const { ctx } = useTargetContext()
  const [body, setBody] = useState(step.body)
  const [status, setStatus] = useState<'Saved' | 'Saving…' | 'Not saved'>('Saved')
  const [editing, setEditing] = useState(false)
  const [act, error] = useAct(reload)
  const bodyRef = useRef(step.body)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const seq = useRef(0) // id of the latest edit; only its save may settle the status
  const dirty = useRef(false)
  const savedBody = useRef(step.body)
  const label = `${step.phase} ${ordinal} writeup`
  const labelRef = useRef(label) // the unmount flush outlives the render; report under the latest label
  labelRef.current = label
  const send = (key: string) => (v: string) => api('PATCH', `/api/steps/${step.id}`, { [key]: v }).then(() => { reload(); if (!step[key as 'saw'].trim() !== !v.trim()) statsChanged() }) // reload: the toolbox reads item.steps; the writeups count only changes when a line goes between blank and filled
  const lines = [
    useAutosave(step.saw, send('saw'), `Saw of ${step.phase} ${ordinal}`),
    useAutosave(step.think, send('think'), `Think of ${step.phase} ${ordinal}`),
    useAutosave(step.tried, send('tried'), `Tried of ${step.phase} ${ordinal}`),
    useAutosave(step.got, send('got'), `Got of ${step.phase} ${ordinal}`),
  ]
  // One shown status, worst wins; a line's 'Unsaved' reads as Saved since its blur flush is pending.
  const all = [status, ...lines.map((l) => l.status)]
  const shown = all.includes('Saving…') ? 'Saving…' : all.includes('Not saved') ? 'Not saved' : 'Saved'

  /** Resolves to the error message when the save failed. */
  const save = async (text: string, n: number) => {
    try {
      await api('PATCH', `/api/steps/${step.id}`, { body: text })
      // The writeups count is boxes with a non-blank step body.
      if (!savedBody.current.trim() !== !text.trim()) statsChanged()
      savedBody.current = text
      if (n !== seq.current) return
      dirty.current = false
      setStatus('Saved')
    } catch (e) {
      if (n === seq.current) setStatus('Not saved')
      return (e as Error).message || 'unknown error'
    }
  }
  const edit = (text: string) => {
    if (text === bodyRef.current) return // CodeMirror echoes an adopted body back as a change; it isn't an edit
    const n = ++seq.current
    bodyRef.current = text
    dirty.current = true
    setBody(text)
    setStatus('Saving…')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(text, n), SAVE_DELAY)
  }
  // Warn before closing the tab with unsaved text; flush it when the section goes away (navigation, delete).
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => dirty.current && e.preventDefault()
    addEventListener('beforeunload', guard)
    return () => {
      removeEventListener('beforeunload', guard)
      clearTimeout(timer.current)
      if (dirty.current) save(bodyRef.current, seq.current).then((err) => err && reportLost(labelRef.current, err))
    }
  }, [])
  // A reload (window focus, another tab's edit) brings a newer body; adopt it unless the user has unsaved text.
  useEffect(() => {
    if (dirty.current || step.body === savedBody.current) return
    savedBody.current = bodyRef.current = step.body
    setBody(step.body)
  }, [step.body])
  useEffect(() => setEditing(false), [mode]) // back in Live preview, a section shows its preview, not a stale editor
  const shut = step.done || step.dead
  const [open, setOpen] = useState(!shut) // a done or dead step starts collapsed; the header toggle opens or closes any step
  useEffect(() => setOpen(!shut), [shut]) // only a change in collapsed-ness re-collapses: Done on a reopened dead end leaves it open
  useEffect(() => {
    if (insert?.stepId !== step.id) return
    edit(`${bodyRef.current}\n\`\`\`bash\n${insert.template}\n\`\`\`\n`)
    onInserted()
  }, [insert])

  // The bar's TARGET is fresher than item.targetIp, which only updates on the next reload.
  const target = targetOf(item, ctx)
  const html = useMemo(() => md.render(substitute(body, { TARGET: target, LHOST: ctx.lhost, LPORT: ctx.lport, DNS: item.dns })), [body, target, ctx.lhost, ctx.lport, item.dns])
  const preview = (
    <div className="md" onClick={jump} dangerouslySetInnerHTML={{ __html: html || '<p class="blank">Nothing written yet.</p>' }} />
  )
  const attach = (file: File) => act(async () => {
    const a = await upload<Attachment>(`/api/steps/${step.id}/attachments`, file, file.name || 'pasted.png')
    edit(`${bodyRef.current.replace(/\n*$/, '')}\n\n${imageMarkdown(a)}\n`)
  })
  const editor = <Editor value={body} onChange={edit} label={label} autoFocus={mode === 'live'} />

  return (
    <section className={`sect ${step.done ? 'done' : ''} ${step.dead ? 'dead' : ''}`} id={`step_${step.id}`}
      onPaste={(e) => {
        const f = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
        if (f && !e.clipboardData.getData('text/plain')) { e.preventDefault(); attach(f) }
      }}>
      <header>
        <button type="button" className="phase" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${step.phase} ${ordinal}`} onClick={() => setOpen((o) => !o)}>
          {step.phase}<span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        <label className="tick">
          <input type="checkbox" checked={step.done} aria-label={`${step.phase} ${ordinal} done`} onChange={(e) => act(() => api('PATCH', `/api/steps/${step.id}`, { done: e.target.checked }))} />
          Done
        </label>
        <label className="tick">
          <input type="checkbox" checked={step.dead} aria-label={`${step.phase} ${ordinal} dead end`} onChange={(e) => act(() => api('PATCH', `/api/steps/${step.id}`, { dead: e.target.checked }))} />
          Dead end
        </label>
        <select aria-label={`Phase of ${step.phase} ${ordinal}`} value={step.phase}
          onChange={(e) => act(() => api('PATCH', `/api/steps/${step.id}`, { phase: e.target.value }).then(statsChanged))}>
          {PHASES.filter((p) => p !== 'Persistence' || step.phase === p || item.tags.includes(AD_TAG)).map((p) => <option key={p}>{p}</option>)}
        </select>
        <span className={`save ${shown === 'Not saved' ? 'bad' : ''}`} role="status">{shown}</span>
        <div className="ctl">
          <label className="ghost">Attach image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Attach image" className="vh" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach(f) }} /></label>
          <button className="ghost" onClick={() => act(async () => {
            clearTimeout(timer.current) // save the text typed in the last 800 ms before the list reloads
            const err = dirty.current && await save(bodyRef.current, seq.current)
            if (err) {
              timer.current = setTimeout(() => save(bodyRef.current, seq.current), SAVE_DELAY) // keep trying to save the text
              throw new Error(err) // no new step until the text is saved
            }
            await api('POST', `/api/steps/${step.id}/duplicate`)
            statsChanged()
          })}>Repeat phase</button>
          <button className="ghost" aria-label="Move up" title="Move up" disabled={!onUp} onClick={() => onUp?.()}>↑</button>
          <button className="ghost" aria-label="Move down" title="Move down" disabled={!onDown} onClick={() => onDown?.()}>↓</button>
          <button
            className="ghost bad"
            disabled={item.steps.length <= 1}
            onClick={() => confirm(`Delete ${step.phase} step ${ordinal} and its writeup?`) && act(async () => {
              clearTimeout(timer.current) // a debounced save landing after the delete would only 404
              try {
                await api('DELETE', `/api/steps/${step.id}`)
              } catch (e) {
                if (dirty.current) timer.current = setTimeout(() => save(bodyRef.current, seq.current), SAVE_DELAY) // the step stayed; keep its text
                throw e
              }
              dirty.current = false // the text went with the step; nothing to flush
              statsChanged()
            })}
          >
            Delete
          </button>
        </div>
      </header>
      {(error ?? moveError) && <p className="err" role="alert">{error ?? moveError}</p>}
      {open && (
        <div className="loop">
          {LOOP.map(([key, name, hint], i) => (
            <label key={key}>
              <span>{name}</span>
              <input type="text" aria-label={`${name} of ${step.phase} ${ordinal}`} placeholder={hint} value={lines[i].value} onChange={(e) => lines[i].onChange(e.target.value)} onBlur={lines[i].flush} />
            </label>
          ))}
        </div>
      )}
      {open && mode === 'markdown' && editor}
      {open && mode === 'split' && <div className="split">{editor}{preview}</div>}
      {open && mode === 'live' && (editing ? (
        <div onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setEditing(false)}>{editor}</div>
      ) : (
        <div className="live" tabIndex={0} role="group" aria-label={`${label}, click to edit`} onClick={() => setEditing(true)} onFocus={(e) => e.target === e.currentTarget && setEditing(true)}>
          {preview}
        </div>
      ))}
    </section>
  )
}
