import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fileSlug } from '../../../shared/slug'
import type { WorkItem } from '../../../shared/types'
import { api } from '../api'
import { useAutosave } from '../autosave'
import { saveBlob } from '../download'
import { jump, md } from '../box/StepSection'
import { exportHtml } from './exportHtml'
import './report.css'

type Doc = { frontmatter: string; markdown: string }

type Item = Pick<WorkItem, 'id' | 'shortId' | 'name'> & Partial<Pick<WorkItem, 'foothold' | 'privesc' | 'rating'>>

/** The writeup report: summary fields (boxes and hosts only), raw markdown beside its preview, copy and exports. Fetches only while `active`. */
export function Report({ item, ownerPath, active, summary = true }: { item: Item; ownerPath: string; active: boolean; summary?: boolean }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const seq = useRef(0) // only the latest GET may land

  const refetch = useCallback(() => {
    const n = ++seq.current
    api<Doc>('GET', `${ownerPath}/report`).then((d) => { if (n === seq.current) { setDoc(d); setError(null) } }, (e) => n === seq.current && setError(e.message))
  }, [item, ownerPath])
  useEffect(() => { if (active) refetch() }, [active, refetch]) // `item` is new on every reload, so Writeup edits show up here

  const save = (key: 'foothold' | 'privesc' | 'rating') => (text: string) => api('PATCH', ownerPath, { [key]: text }).then(() => refetch())
  const fields = [
    ['Foothold', useAutosave(item.foothold ?? '', save('foothold'), 'foothold')],
    ['Privilege escalation', useAutosave(item.privesc ?? '', save('privesc'), 'privilege escalation')],
    ['Perceived difficulty', useAutosave(item.rating ?? '', save('rating'), 'perceived difficulty')],
  ] as const

  const markdown = doc?.markdown ?? ''
  const html = useMemo(() => md.render(markdown), [markdown])
  const fenced = `---\n${doc?.frontmatter ?? ''}\n---\n\n${markdown}`
  const file = `${item.shortId}-${fileSlug(item.name)}`
  const copy = () => navigator.clipboard.writeText(fenced).then(() => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, (e: Error) => setError(e.message))

  return (
    <div className="report">
      {summary && (
        <div className="summary">
          {fields.map(([label, f]) => (
            <div key={label}>
              <label>{label}<input type="text" value={f.value} onChange={(e) => f.onChange(e.target.value)} onBlur={f.flush} /></label>
              <span className={`save ${f.status === 'Not saved' ? 'bad' : ''}`} role="status">{f.status}</span>
            </div>
          ))}
        </div>
      )}
      <div className="acts">
        <button className="btn" disabled={!doc} onClick={copy}>Copy raw</button>
        <button className="btn" disabled={!doc} onClick={() => saveBlob(`${file}.md`, new Blob([fenced], { type: 'text/markdown' }))}>Export .md</button>
        {/* shortcut: image links stay /api/files/…, which resolve only while the app runs; inline them as data: URIs if exports are read offline. */}
        <button className="btn" disabled={!doc} onClick={() => saveBlob(`${file}.html`, new Blob([exportHtml(item.name, md.render(markdown, { plain: true }))], { type: 'text/html' }))}>Export HTML</button>
        {copied && <span className="save" role="status">Copied</span>}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="panes">
        <div className="raw">
          <textarea readOnly aria-label="Raw Markdown" value={markdown} />
          <small>{markdown.length} chars · {markdown.replace(/\n$/, '').split('\n').length} lines</small>
        </div>
        <div className="md" onClick={jump} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
