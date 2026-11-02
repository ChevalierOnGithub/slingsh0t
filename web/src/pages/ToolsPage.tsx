import { useCallback, useDeferredValue, useEffect, useState, type FormEvent } from 'react'
import { INTENTS, type Command, type ToolListItem } from '../../../shared/types'
import type { Vars } from '../../../shared/placeholders'
import { api } from '../api'
import { CommandRow, cmdName } from '../library/CommandRow'
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
  const load = useCallback(() => { api<ToolListItem[]>('GET', '/api/tools').then((t) => { setTools(t); setError(null) }, (e) => setError(e.message)) }, [])
  useEffect(load, [load])
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

  return (
    <section className="lib">
      <h1>Tools and commands</h1>
      <input type="search" className="lib-find" value={query} aria-label="Filter tools and commands" placeholder="Filter by tool, purpose or command" onChange={(e) => setQuery(e.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      {tools && !shown.length && <p className="empty">{q ? 'No tool or command matches this filter.' : 'No tools yet.'}</p>}
      {shown.map(({ t, commands }) => (
        <article key={t.id} id={`tool-${t.id}`} className="tool">
          <header>
            <h2>{t.name}</h2>
            <span className="mono">{t.shortId}</span>
          </header>
          {t.description && <p>{t.description}</p>}
          <ToolCommands toolId={t.id} toolName={t.name} commands={commands} focusCmd={cmd} vars={vars} searching={!!q} onChanged={load} />
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

const SHOWN = 8
const IntentSelect = ({ label, value }: { label: string; value: string }) => (
  <select name="intent" aria-label={label} defaultValue={value}>
    {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
    <option value="">other</option>
  </select>
)

type Run = (f: () => Promise<unknown>) => Promise<string | null>

/** A tool's commands with inline edit and delete, plus an add form; a search lists every match flat. */
function ToolCommands({ toolId, toolName, commands, focusCmd, vars, searching, onChanged }: {
  toolId: number; toolName: string; commands: Command[]; focusCmd: string | null; vars: Vars; searching: boolean; onChanged(): void
}) {
  const [error, setError] = useState<string | null>(null)
  // A ?cmd= deep link opens the group (and the fold) holding that command.
  const target = commands.find((c) => String(c.id) === focusCmd)
  const [picked, setPicked] = useState<string | null>(target?.intent ?? null)
  const [showAll, setShowAll] = useState(() => !!target && commands.filter((c) => c.intent === target.intent).indexOf(target) >= SHOWN)
  // Same for a ?cmd= change while this page stays mounted (the lazy seeds above only cover a fresh mount).
  useEffect(() => {
    if (!target) return
    setPicked(target.intent)
    if (commands.filter((c) => c.intent === target.intent).indexOf(target) >= SHOWN) setShowAll(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id])
  const groups = [...INTENTS, ''].map((i) => ({ intent: i, cmds: commands.filter((c) => c.intent === i) })).filter((g) => g.cmds.length)
  const current = groups.find((g) => g.intent === picked) ?? groups[0]
  const shown = searching ? commands : current ? (showAll ? current.cmds : current.cmds.slice(0, SHOWN)) : []
  // Resolves to the error message, or null on success.
  const run: Run = async (f) => {
    try {
      await f()
      onChanged()
      dispatchEvent(new Event('slingsh0t:stats'))
      return null
    } catch (e) {
      return (e as Error).message
    }
  }
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    run(() => api('POST', `/api/tools/${toolId}/commands`, { purpose: String(data.get('purpose')).trim(), template: String(data.get('template')), intent: String(data.get('intent')) }))
      .then((err) => { setError(err); if (!err) { setPicked(String(data.get('intent'))); form.reset() } })
  }

  return (
    <>
      {!searching && groups.length > 0 && (
        <div className="intents" role="group" aria-label={`Intents for ${toolName}`}>
          {groups.map((g) => (
            <button key={g.intent} type="button" aria-pressed={g === current} onClick={() => { setPicked(g.intent); setShowAll(false) }}>
              {g.intent || 'other'} {g.cmds.length}
            </button>
          ))}
        </div>
      )}
      <ul className="tb-cmds">
        {shown.map((c) => <EditableCommand key={c.id} cmd={c} vars={vars} run={run} onSaved={setPicked} />)}
      </ul>
      {!searching && current && !showAll && current.cmds.length > SHOWN && (
        <button type="button" className="tb-btn" onClick={() => setShowAll(true)}>show all {current.cmds.length}</button>
      )}
      <form className="cmd-add" onSubmit={add}>
        <input type="text" name="purpose" aria-label={`Purpose of a new ${toolName} command`} placeholder="What it does" />
        <textarea name="template" aria-label={`New ${toolName} command`} rows={1} placeholder="Command, with {{TARGET}} {{LHOST}} {{LPORT}}" required />
        <IntentSelect label={`Intent of a new ${toolName} command`} value="" />
        <div className="acts"><button type="submit" className="tb-btn" aria-label={`Add command to ${toolName}`}>Add command</button></div>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
    </>
  )
}

function EditableCommand({ cmd, vars, run, onSaved }: { cmd: Command; vars: Vars; run: Run; onSaved(intent: string): void }) {
  const [editing, setEditing] = useState(false)
  const [left, setLeft] = useState(false) // just left edit mode: Edit takes focus back
  const [error, setError] = useState<string | null>(null)
  const name = cmdName(cmd)
  const leave = () => { setEditing(false); setLeft(true) }
  if (!editing)
    return (
      <CommandRow cmd={cmd} vars={vars} error={error} id={`cmd-${cmd.id}`}>
        <button type="button" className="tb-btn" aria-label={`Edit command ${name}`} autoFocus={left} onClick={() => { setError(null); setEditing(true) }}>Edit</button>
        <button type="button" className="tb-btn bad" aria-label={`Delete command ${name}`} onClick={() => confirm('Delete this command?') && run(() => api('DELETE', `/api/commands/${cmd.id}`)).then(setError)}>
          Delete
        </button>
      </CommandRow>
    )
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    run(() => api('PATCH', `/api/commands/${cmd.id}`, { purpose: String(data.get('purpose')).trim(), template: String(data.get('template')), intent: String(data.get('intent')) }))
      .then((err) => { setError(err); if (!err) { onSaved(String(data.get('intent'))); leave() } })
  }
  return (
    <li className="tb-cmd edit">
      <form onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && leave()}>
        <input type="text" name="purpose" aria-label={`Purpose of command ${name}`} defaultValue={cmd.purpose} placeholder="What it does" />
        <textarea name="template" aria-label={`Command ${name}`} defaultValue={cmd.template} rows={Math.max(1, cmd.template.split('\n').length)} required autoFocus />
        <IntentSelect label={`Intent of command ${name}`} value={cmd.intent} />
        <div className="acts">
          <button type="submit" className="tb-btn">Save</button>
          <button type="button" className="tb-btn" onClick={leave}>Cancel</button>
        </div>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
    </li>
  )
}
