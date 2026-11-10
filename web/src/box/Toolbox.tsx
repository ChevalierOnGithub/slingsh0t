import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AD_TAG, HAVES, INTENTS, SERVICES, type BoxService, type Command, type Have, type TechniqueNode, type Toolbox as ToolboxData, type ToolNode, type WorkItem } from '../../../shared/types'
import type { Vars } from '../../../shared/placeholders'
import { servicesInText, uniqServices } from '../../../shared/services'
import { toolOf } from '../../../shared/steps'
import { api } from '../api'
import { useAutosave } from '../autosave'
import { CommandRow, cmdName } from '../library/CommandRow'
import { useTargetContext } from '../shell/TargetBar'
import { ownerPath, targetOf } from './StepSection'
import './toolbox.css'

type Run = (f: () => Promise<unknown>) => Promise<void>

export function Toolbox({ item, currentStepId, onInsert, onChanged }: {
  item: WorkItem
  currentStepId: number | null
  onInsert(template: string): void
  onChanged(): void
}) {
  const { ctx } = useTargetContext()
  const vars: Vars = { TARGET: targetOf(item, ctx), LHOST: ctx.lhost, LPORT: ctx.lport, DNS: item.dns }
  const [data, setData] = useState<ToolboxData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [thisBox, setThisBox] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [addingService, setAddingService] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const rooted = item.status === 'rooted'

  // Overlapping loads (status flips, quick edits): only the newest may set data; a good load clears an old load error.
  const seq = useRef(0)
  const load = useCallback(() => {
    const n = ++seq.current
    return api<ToolboxData>('GET', `/api/toolbox?${item.kind}Id=${item.id}`)
      .then((d) => { if (n === seq.current) { setData(d); setError(null) } }, (e) => n === seq.current && setError(e.message))
  }, [item.id, item.kind])
  // Rooting, a step added or deleted, and the AD tag all change what the server returns, so refetch on them too.
  useEffect(() => { load() }, [load, item.status, item.steps.length, item.tags.includes(AD_TAG)])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      search.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const run: Run = async (f) => {
    try {
      await f()
      setError(null)
      load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // "<phase>", or "<phase> <ordinal>" in position order once a phase has more than one step.
  const stepLabel = new Map<number, string>()
  const seen: Record<string, number> = {}
  const perPhase: Record<string, number> = {}
  for (const s of item.steps) perPhase[s.phase] = (perPhase[s.phase] ?? 0) + 1
  for (const s of [...item.steps].sort((a, b) => a.position - b.position))
    stepLabel.set(s.id, perPhase[s.phase] > 1 ? `${s.phase} ${(seen[s.phase] = (seen[s.phase] ?? 0) + 1)}` : s.phase)
  const dead = item.steps.filter((s) => s.dead).sort((a, b) => a.position - b.position)
  const current = item.steps.find((s) => s.id === currentStepId)
  const herePhase = current?.phase
  const loop = current ? [current.saw.trim() && `saw: ${current.saw.trim()}`, current.tried.trim() && `tried: ${current.tried.trim()}`].filter(Boolean).join(' · ') : ''
  const have = haveOf(item)
  // What status alone implies: those pills show pressed and can't be toggled.
  const fromStatus = haveOf({ ...item, haves: [] })
  // A bare Saw word adds nothing when the box already has that service on some port.
  // Nor does it when another step's Saw gave that name a port.
  const offered = uniqServices(item.steps.flatMap((s) => servicesInText(s.saw)))
    .filter((s) => !item.services.some((b) => b.name === s.name && (b.port === s.port || s.port === null)))
    .filter((s, _, all) => s.port !== null || !all.some((o) => o.name === s.name && o.port !== null))
  const shelves = data ? shelvesOf(item, data.phases.flatMap((p) => p.techniques)) : []

  const q = query.trim().toLowerCase()
  // Next up lists only unused techniques, so it steps aside while searching or scoped to this box.
  const upNext = item.services.length && !q && !thisBox ? nextUp(shelves, have, item) : []
  // React only writes `open` when the prop changes, so a shelf the owner closed would keep its matches hidden.
  const shelfRef = useRef<HTMLElement>(null)
  const searching = !!q
  useEffect(() => {
    if (searching) shelfRef.current?.querySelectorAll<HTMLDetailsElement>('details.tb-shelf').forEach((d) => { d.open = true })
  }, [searching])
  const hit = (s: string) => s.toLowerCase().includes(q)
  const cmdHit = (c: Command) => hit(c.purpose) || hit(c.template)
  const toolHit = (t: ToolNode) => hit(t.name) || t.commands.some(cmdHit)
  const techHit = (t: TechniqueNode) => hit(t.name) || t.commands.some(cmdHit) || t.tools.some(toolHit)

  // A failed follow-up write reloads first (and awaits it, so the reload's success can't clear the error run sets next).
  const reloadAndThrow = async (err: unknown) => { await load(); throw err }
  const appendTried = (stepId: number, name: string) => api('POST', `/api/steps/${stepId}/tried`, { name }).catch(reloadAndThrow)
  const onCopy = (text: string) => { const n = toolOf(text); if (!rooted && currentStepId !== null && n) run(() => appendTried(currentStepId, n)) }

  // A shelf add only creates; the new technique turns up in Next up for the owner to mark.
  const addTechnique = (service: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
    if (!name) return
    run(async () => {
      await api('POST', '/api/techniques', { name, phase: herePhase ?? 'Recon', service })
      setAdding(null)
    })
  }

  const saveServices = (services: BoxService[]) => run(() => api('PATCH', ownerPath(item), { services }))
  const addService = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const name = String(f.get('name') ?? '').trim().toLowerCase()
    const port = String(f.get('port') ?? '').trim()
    if (!name) return
    run(async () => {
      await api('PATCH', ownerPath(item), { services: uniqServices([...item.services, { name, port: port ? Number(port) : null }]) })
      setAddingService(false)
    })
  }
  const toggleHave = (h: Have) => run(() => api('PATCH', ownerPath(item), { haves: item.haves.includes(h) ? item.haves.filter((x) => x !== h) : [...item.haves, h] }))

  // One tool names itself; several would flood the Tried line, so the technique's name stands in.
  const markUsed = (t: TechniqueNode, stepId: number) => run(async () => {
    await api('POST', '/api/technique-uses', { techniqueId: t.id, stepId })
    await appendTried(stepId, t.tools.length === 1 ? t.tools[0].name : t.name)
  })

  return (
    <section className="toolbox" aria-label="Toolbox">
      <div className="tb-svc">
        <ul aria-label="Services">
          {item.services.map((s) => (
            <li key={`${s.name}:${s.port}`}>
              <span>{s.name}{s.port ? ` :${s.port}` : ''}</span>
              <button type="button" aria-label={`Remove ${s.name}${s.port ? ` :${s.port}` : ''}`} onClick={() => saveServices(item.services.filter((x) => x !== s))}>×</button>
            </li>
          ))}
        </ul>
        {addingService ? (
          <form className="tb-add" onSubmit={addService} onKeyDown={(e) => e.key === 'Escape' && setAddingService(false)}>
            <input type="text" name="name" list="tb-services" aria-label="Service name" placeholder="service" required autoFocus />
            <datalist id="tb-services">{SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
            <input type="number" name="port" min={1} max={65535} aria-label="Port" placeholder="port" />
            <button type="submit" className="tb-btn">Add</button>
          </form>
        ) : <button type="button" className="tb-addbtn" onClick={() => setAddingService(true)}>+ service</button>}
      </div>
      {offered.length > 0 && (
        <p className="tb-from">
          add from Saw:
          {offered.map((s) => {
            const label = `${s.name}${s.port ? ` :${s.port}` : ''}`
            return <button key={label} type="button" className="tb-link" aria-label={`Add ${label}`} onClick={() => saveServices(uniqServices([...item.services, s]))}>{label}</button>
          })}
        </p>
      )}
      {loop && <p className="tb-saw">{loop}</p>}
      <div className="tb-have" role="group" aria-label="You have">
        <span>you have:</span>
        {HAVES.map((h) => (
          <button key={h} type="button" aria-pressed={have.has(h)} disabled={fromStatus.has(h)} title={fromStatus.has(h) ? 'from status' : undefined} onClick={() => toggleHave(h)}>{h}</button>
        ))}
      </div>

      <OpenThreads item={item} />
      {dead.length > 0 && (
        <section className="tb-dead" aria-label="Dead ends">
          {dead.map((s) => (
            <a key={s.id} href={`#/${item.kind === 'box' ? 'boxes' : 'hosts'}/${item.id}?step=${s.id}`}>
              {stepLabel.get(s.id)} — {s.saw.trim() || s.tried.trim() || 'no notes'}
            </a>
          ))}
        </section>
      )}

      <div>
        <label className="tb-find">
          <input ref={search} type="search" value={query} aria-label="Find a technique, tool or command" placeholder="Find a technique, tool or command" onChange={(e) => setQuery(e.target.value)} />
          <kbd aria-hidden>/</kbd>
        </label>
        <div className="tb-scope" role="group" aria-label="Scope">
          <button type="button" aria-pressed={thisBox} onClick={() => setThisBox(true)}>This {item.kind}</button>
          <button type="button" aria-pressed={!thisBox} onClick={() => setThisBox(false)}>All techniques</button>
        </div>
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      {!item.services.length ? <p className="tb-hint">Add the services you found to get a Next up list.</p>
        : upNext.length > 0 && (
          <section className="tb-next" aria-label="Next up">
            <h3>Next up</h3>
            {upNext.map((t) => (
              <TechRow key={t.id} t={t} item={item} vars={vars} currentStepId={currentStepId} stepLabel={stepLabel} toolHit={null} searching={false} onInsert={onInsert} onCopy={onCopy} run={run} markUsed={markUsed} />
            ))}
          </section>
        )}

      <section className="tb-tree" aria-label="Shelves" ref={shelfRef}>
        {shelves.map(({ key, title, ports, techniques }) => {
          const matched = techniques.filter((t) => (!thisBox || t.uses.length) && techHit(t))
          if (!matched.length && (q || thisBox)) return null
          const hidden = q || revealed.has(key) ? [] : matched.filter((t) => !applicable(t, item))
          const used = techniques.filter((t) => t.uses.length).length
          const lockedN = techniques.filter((t) => !t.uses.length && locked(t, have) && applicable(t, item)).length
          return (
            <details key={key} className="tb-shelf" open={!!q || key !== OTHER}>
              <summary>
                <b>{title}</b>
                {ports && <small>{ports}</small>}
                <span className="tb-count">{techniques.length > 0 && `${used} of ${techniques.length} used`}{lockedN > 0 && ` · ${lockedN} locked`}</span>
                {!rooted && key !== OTHER && (
                  <button type="button" className="tb-addbtn" aria-label={`Add a technique to ${title}`} onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    // Open a collapsed shelf so the input shows; never closes an open one.
                    ;(e.currentTarget.closest('details') as HTMLDetailsElement).open = true
                    setAdding(key)
                  }}>+ add</button>
                )}
              </summary>
              <div className="tb-inner">
                {matched.filter((t) => !hidden.includes(t)).map((t) => (
                  <TechRow key={t.id} t={t} item={item} vars={vars} currentStepId={currentStepId} stepLabel={stepLabel} toolHit={q ? toolHit : null} searching={!!q} onInsert={onInsert} onCopy={onCopy} run={run} markUsed={markUsed} lock={t.uses.length ? undefined : locked(t, have)} />
                ))}
                {hidden.length > 0 && (
                  <p className="tb-hidden">
                    {`+${hidden.length} hidden: ${hidden.map((t) => t.name).join(', ')} `}
                    <button type="button" className="tb-link tb-show" onClick={() => setRevealed(new Set(revealed).add(key))}>show</button>
                  </p>
                )}
                {!rooted && adding === key && (
                  <form className="tb-add" onSubmit={addTechnique(key)}>
                    <input type="text" name="name" aria-label={`New technique in ${title}`} placeholder="Technique name" required autoFocus onKeyDown={(e) => e.key === 'Escape' && setAdding(null)} />
                    <button type="submit" className="tb-btn">Add</button>
                  </form>
                )}
              </div>
            </details>
          )
        })}
      </section>
    </section>
  )
}

/** Whether a technique can apply to this item; a used one always does, and an unknown OS hides nothing. */
function applicable(t: TechniqueNode, item: WorkItem) {
  const os = item.os.toLowerCase()
  if (t.uses.length) return true
  if (t.applies === 'linux') return !os.includes('windows')
  if (t.applies === 'windows') return !os.includes('linux')
  if (t.applies === 'ad') return item.tags.includes(AD_TAG)
  return true
}

/** What the item holds: the ticked haves, plus a shell from a user flag and a shell and admin from root. */
function haveOf(item: WorkItem) {
  const have = new Set<Have>(item.haves)
  if (item.status === 'user_flag' || item.status === 'rooted') have.add('shell')
  if (item.status === 'rooted') have.add('admin')
  return have
}

/** A technique filed under `shell` needs a shell even when its list leaves it out. */
const needsOf = (t: TechniqueNode): Have[] => t.service === 'shell' && !t.needs.includes('shell') ? [...t.needs, 'shell'] : t.needs

/** The first need the item lacks; undefined when unlocked. */
const locked = (t: TechniqueNode, have: Set<Have>) => needsOf(t).find((n) => !have.has(n))

// Not a slug, so it can't clash with a box service's shelf key.
const OTHER = '*'
type Shelf = { key: string; title: string; ports: string; techniques: TechniqueNode[] }

/** One shelf per box service in the box's order, then any service, after a shell, and a catch-all for the rest. */
function shelvesOf(item: WorkItem, techniques: TechniqueNode[]): Shelf[] {
  const names = [...new Set(item.services.map((s) => s.name))].filter((n) => n !== 'any' && n !== 'shell')
  const on = (keep: (service: string) => boolean) => techniques.filter((t) => keep(t.service))
  const other = on((s) => s !== 'any' && s !== 'shell' && !names.includes(s))
  return [
    ...names.map((name) => ({
      key: name, title: name, techniques: on((s) => s === name),
      ports: item.services.filter((s) => s.name === name && s.port).map((s) => `:${s.port}`).join(' '),
    })),
    { key: 'any', title: 'any service', ports: '', techniques: on((s) => s === 'any') },
    { key: 'shell', title: 'after a shell', ports: '', techniques: on((s) => s === 'shell') },
    ...(other.length ? [{ key: OTHER, title: 'other services', ports: '', techniques: other }] : []),
  ]
}

/** The box-level Open threads field; its own component so typing doesn't re-render the shelves. */
function OpenThreads({ item }: { item: WorkItem }) {
  const next = useAutosave(item.nextStep, (nextStep) => api('PATCH', ownerPath(item), { nextStep }), 'open threads')
  return (
    <>
      <label className="tb-threads">
        <span>Open threads</span>
        <textarea value={next.value} rows={2} placeholder="One per line: what you still want to pull on" onChange={(e) => next.onChange(e.target.value)} onBlur={next.flush} />
      </label>
      {next.error && <p className="err" role="alert">{next.error}</p>}
    </>
  )
}

/** The first five unused, unlocked, applicable techniques on the box's own shelves, in shelf order. */
function nextUp(shelves: Shelf[], have: Set<Have>, item: WorkItem) {
  return shelves.filter((s) => s.key !== OTHER).flatMap((s) => s.techniques)
    .filter((t) => !t.uses.length && !locked(t, have) && applicable(t, item)).slice(0, 5)
}

/** The inline command: the technique's own first, else the first tool command by intent, untagged last. */
function goTo(t: TechniqueNode): Command | undefined {
  const cmds = t.tools.flatMap((x) => x.commands)
  return t.commands[0] ?? [...INTENTS, ''].map((i) => cmds.find((c) => c.intent === i)).find(Boolean)
}

function TechRow({ t, item, vars, currentStepId, stepLabel, toolHit, searching, onInsert, onCopy, run, markUsed, lock }: {
  t: TechniqueNode
  item: WorkItem
  vars: Vars
  currentStepId: number | null
  stepLabel: Map<number, string>
  toolHit: ((t: ToolNode) => boolean) | null
  searching: boolean
  onInsert(template: string): void
  onCopy(text: string): void
  run: Run
  markUsed(t: TechniqueNode, stepId: number): void
  lock?: Have
}) {
  const [open, setOpen] = useState(searching)
  // A search opens every matching row; clearing it leaves the rows as they are.
  useEffect(() => { if (searching) setOpen(true) }, [searching])
  const canMark = item.status !== 'rooted' && item.steps.length > 0
  const inline = goTo(t)
  const deadEnd = t.uses.some((u) => item.steps.some((s) => s.dead && s.id === u.stepId))
  return (
    <div className={`tb-row${open ? ' open' : ''}`}>
      <div className="tb-head">
        <button type="button" aria-expanded={open} aria-label={t.name} onClick={() => setOpen(!open)}>
          <i aria-hidden />
          <b>{t.name}</b>
          {t.tools.length > 0 && <span className="tools">{t.tools[0].name}{t.tools.length > 1 && ` +${t.tools.length - 1}`}</span>}
        </button>
        {lock && <span className="pill lock">needs {lock}</span>}
        {deadEnd ? <span className="pill dead">tried · dead end</span>
          : t.uses.some((u) => u.stepId === currentStepId) ? <span className="pill used">used · here</span>
          : t.uses.length ? <span className="pill used">used · {stepLabel.get(t.uses[0].stepId)}</span>
          : canMark && !open && (
            <button type="button" className="tb-btn" aria-label={`Mark used: ${t.name}`} onClick={() => markUsed(t, currentStepId ?? item.steps[0].id)}>Mark used</button>
          )}
      </div>
      {inline && <Commands commands={[inline]} vars={vars} onInsert={onInsert} onCopy={onCopy} />}
      {open && (
        <>
          {t.description && <p className="tb-desc">{t.description}</p>}
          <Commands commands={t.commands.slice(1)} vars={vars} onInsert={onInsert} onCopy={onCopy} />
          {t.tools.map((tl) => (
            <details key={tl.id} className="tb-tool" open={!toolHit || toolHit(tl)}>
              <summary>{tl.name}</summary>
              <Commands commands={tl.commands} vars={vars} onInsert={onInsert} onCopy={onCopy} />
            </details>
          ))}
          <div className="tb-uses">
            {t.uses.map((u) => (
              <span key={u.id}>
                Used in {stepLabel.get(u.stepId)}
                <button type="button" className="tb-link" aria-label={`Remove ${t.name} from ${stepLabel.get(u.stepId)}`} onClick={() => run(() => api('DELETE', `/api/technique-uses/${u.id}`))}>Remove</button>
              </span>
            ))}
            {canMark && (
              <form onSubmit={(e) => {
                e.preventDefault()
                markUsed(t, Number(new FormData(e.currentTarget).get('step')))
              }}>
                <select name="step" aria-label={`Step for ${t.name}`} key={currentStepId} defaultValue={currentStepId ?? undefined}>
                  {item.steps.map((s) => <option key={s.id} value={s.id}>{stepLabel.get(s.id)}</option>)}
                </select>
                <button type="submit" className="tb-btn" aria-label={`Mark used: ${t.name}`}>Mark used</button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Commands({ commands, vars, onInsert, onCopy }: { commands: Command[]; vars: Vars; onInsert(t: string): void; onCopy(t: string): void }) {
  if (!commands.length) return null
  return (
    <ul className="tb-cmds">
      {commands.map((c) => (
        <CommandRow key={c.id} cmd={c} vars={vars} onCopy={onCopy}>
          <button type="button" className="tb-btn" aria-label={`Insert ${cmdName(c)}`} onClick={() => onInsert(c.template)}>Insert</button>
        </CommandRow>
      ))}
    </ul>
  )
}
