import { useEffect, useState, type FormEvent } from 'react'
import { INTENTS, type Command } from '../../../shared/types'
import type { Vars } from '../../../shared/placeholders'
import { api } from '../api'
import { CommandRow, cmdName } from './CommandRow'

const SHOWN = 8
const IntentSelect = ({ label, value }: { label: string; value: string }) => (
  <select name="intent" aria-label={label} defaultValue={value}>
    {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
    <option value="">other</option>
  </select>
)

type Run = (f: () => Promise<unknown>) => Promise<string | null>

/** A tool's or technique's commands with inline edit and delete, plus an add form (posted to addPath); a search lists every match flat. */
export function Commands({ addPath, owner, commands, focusCmd, vars, searching, onChanged }: {
  addPath: string; owner: string; commands: Command[]; focusCmd: string | null; vars: Vars; searching: boolean; onChanged(): void
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
    run(() => api('POST', addPath, { purpose: String(data.get('purpose')).trim(), template: String(data.get('template')), intent: String(data.get('intent')) }))
      .then((err) => { setError(err); if (!err) { setPicked(String(data.get('intent'))); form.reset() } })
  }

  return (
    <>
      {!searching && groups.length > 0 && (
        <div className="intents" role="group" aria-label={`Intents for ${owner}`}>
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
        <input type="text" name="purpose" aria-label={`Purpose of a new ${owner} command`} placeholder="What it does" />
        <textarea name="template" aria-label={`New ${owner} command`} rows={1} placeholder="Command, with {{TARGET}} {{LHOST}} {{LPORT}}" required />
        <IntentSelect label={`Intent of a new ${owner} command`} value="" />
        <div className="acts"><button type="submit" className="tb-btn" aria-label={`Add command to ${owner}`}>Add command</button></div>
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
