import { useCallback, useDeferredValue, useEffect, useState, type FormEvent } from 'react'
import type { ToolListItem } from '../../../shared/types'
import type { Vars } from '../../../shared/placeholders'
import { api } from '../api'
import { Commands } from '../library/Commands'
import { useFlash } from '../library/useFlash'
import { useRoute } from '../router'
import { useTargetContext } from '../shell/TargetBar'
import './library.css'

/** Loads /api/tools and exposes the placeholder values from the context bar. */
function useTools() {
  const { ctx } = useTargetContext()
  const vars: Vars = { TARGET: ctx.target, LHOST: ctx.lhost, LPORT: ctx.lport }
  const [tools, setTools] = useState<ToolListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => api<ToolListItem[]>('GET', '/api/tools').then((t) => { setTools(t); setError(null) }, (e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  return { tools, error, vars, load }
}

export function ToolsPage() {
  const { tools, error, vars, load } = useTools()
  const [query, setQuery] = useState('')
  const route = useRoute().query
  const tool = route.get('tool'), cmd = route.get('cmd')
  useFlash(tools && (tool ? `tool-${tool}` : cmd ? `cmd-${cmd}` : null)) // wait for the list so the anchor exists
  const q = useDeferredValue(query).trim().toLowerCase()
  const hit = (s: string) => s.toLowerCase().includes(q)
  const shown = (tools ?? [])
    .map((t) => ({ t, commands: hit(t.name) ? t.commands : t.commands.filter((c) => hit(c.purpose) || hit(c.template)) }))
    .filter(({ t, commands }) => hit(t.name) || commands.length)
  const [addError, setAddError] = useState<string | null>(null)
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget, data = new FormData(form)
    api<ToolListItem>('POST', '/api/tools', { name: String(data.get('name')).trim(), description: String(data.get('description')) }).then((t) => {
      setAddError(null); form.reset(); setQuery('')
      dispatchEvent(new Event('slingsh0t:stats'))
      return load().then(() => { location.hash = `#/tools?tool=${t.id}` }) // scrolls to and flashes the new tool
    }, (err: Error) => setAddError(err.message))
  }

  return (
    <section className="lib">
      <h1>Tools and commands</h1>
      <input type="search" className="lib-find" value={query} aria-label="Filter tools and commands" placeholder="Filter by tool, purpose or command" onChange={(e) => setQuery(e.target.value)} />
      <form className="cmd-add lib-add" onSubmit={add}>
        <input type="text" name="name" aria-label="Name of a new tool" placeholder="New tool name" required />
        <input type="text" name="description" aria-label="Description of the new tool" placeholder="What it is for (optional)" />
        <div className="acts"><button type="submit" className="tb-btn">Add tool</button></div>
      </form>
      {addError && <p className="err" role="alert">{addError}</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {tools && !shown.length && <p className="empty">{q ? 'No tool or command matches this filter.' : 'No tools yet.'}</p>}
      {shown.map(({ t, commands }) => (
        <article key={t.id} id={`tool-${t.id}`} className="tool">
          <header>
            <h2>{t.name}</h2>
            <span className="mono">{t.shortId}</span>
          </header>
          {t.description && <p>{t.description}</p>}
          <Commands addPath={`/api/tools/${t.id}/commands`} owner={t.name} commands={commands} focusCmd={cmd} vars={vars} searching={!!q} onChanged={load} />
          {t.techniques.length > 0 && (
            <p className="uses">
              Techniques
              {t.techniques.map((x) => <a key={x.id} href={`#/techniques?t=${x.id}`}>{x.name}</a>)}
            </p>
          )}
        </article>
      ))}
    </section>
  )
}
