import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { PHASES, type Difficulty, type Home, type HomeUnfinished, type HomeWork, type Phase, type Stats } from '../../../shared/types'
import { fmtTime } from '../../../shared/steps'
import { api } from '../api'
import { STATUS_LABEL } from '../status'
import { ago } from './ago'

const TIERS: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Insane']
const RECENT_HREF: Record<string, string> = {
  box: '#/boxes/', host: '#/hosts/', network: '#/networks/', writeup: '#/writeups/', 'network-writeup': '#/writeups/network/', reference: '#/reference/',
}
const search = (q?: string) => dispatchEvent(new CustomEvent('slingsh0t:search', { detail: q }))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function HomePage() {
  const [data, setData] = useState<{ home: Home; stats: Stats } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([api<Home>('GET', '/api/home'), api<Stats>('GET', '/api/stats')])
      .then(([home, stats]) => setData({ home, stats }), (e) => setError(e.message))
  }, [])

  if (error) return <><h1 className="vh">Home</h1><p className="err" role="alert">{error}</p></>
  if (!data) return <><h1 className="vh">Home</h1><p className="empty" role="status">Loading…</p></>
  const { home, stats } = data
  return (
    <div className="home">
      <h1 className="vh">Home</h1>
      <div className="home-top">
        <Working work={home.working} />
        <div className="home-stack">
          <Rooted stats={stats} week={home.rootedThisWeek} />
          <Panel title="Also unfinished">
            <List none="Nothing else unfinished.">
              {home.unfinished.map((u) => <Unfinished key={`${u.kind}-${u.id}`} u={u} />)}
            </List>
          </Panel>
        </div>
      </div>

      <div className="home-search">
        <button type="button" className="home-field" aria-label="Search" onClick={() => search()}>
          Search boxes, writeups, techniques, tools and loot <kbd>Ctrl K</kbd>
        </button>
        {home.searches.map((q) => <button key={q} type="button" className="home-chip" onClick={() => search(q)}>{q}</button>)}
      </div>

      <div className="home-cols">
        <section className="home-lane" aria-labelledby="home-next">
          <h2 id="home-next">Next</h2>
          <Panel title={`Fill the gap: ${home.next.difficulty}`}>
            <p className="home-note">{home.next.reason}</p>
            <List none={`No unstarted ${home.next.difficulty} boxes.`}>
              {home.next.boxes.map((b) => (
                <li key={b.id}><a href={`#/boxes/${b.id}`}>{b.name}</a><span className="home-meta">{b.platform} · {b.os}</span></li>
              ))}
            </List>
          </Panel>
          <Panel title="Networks">
            <List none="No networks started.">
              {home.networks.map((n) => (
                <li key={n.id} className="home-net">
                  <a href={`#/networks/${n.id}`}>{n.name} <span className="home-meta">{n.hostsRooted} / {n.hostsTotal} hosts · {plural(n.flags, 'flag', 'flags')}</span></a>
                  <HostBar rooted={n.hostsRooted} total={n.hostsTotal} />
                </li>
              ))}
            </List>
            {home.networksNotStarted > 0 && <p className="home-note">{plural(home.networksNotStarted, 'network', 'networks')} not started</p>}
          </Panel>
        </section>

        <section className="home-lane" aria-labelledby="home-learned">
          <h2 id="home-learned">Learned</h2>
          <Panel title="Techniques used lately">
            <List none="No techniques logged in the last 30 days.">
              {home.techniques.map((t) => (
                <li key={t.id}><a href={`#/techniques?t=${t.id}`}>{t.name}{' '}<span className="home-meta">{plural(t.count, 'target', 'targets')}</span></a></li>
              ))}
            </List>
          </Panel>
          <Panel title="Dead ends this month">
            <List none="No dead ends in the last 30 days.">
              {home.deadEnds.map((d) => (
                <li key={d.stepId} className="home-dead">
                  <a href={`#/${d.kind === 'box' ? 'boxes' : 'hosts'}/${d.ownerId}?step=${d.stepId}`}>{d.text} <span className="home-meta">· {d.owner}</span></a>
                </li>
              ))}
            </List>
          </Panel>
          <Panel title="Writeups to finish">
            <List none="Every rooted box has its writeup.">
              {home.writeups.items.map((w) => <li key={w.id}><a href={`#/writeups/${w.id}`}>{w.name}</a></li>)}
            </List>
            {home.writeups.more > 0 && <p className="home-note">+{home.writeups.more} more</p>}
          </Panel>
        </section>

        <section className="home-lane" aria-labelledby="home-recent">
          <h2 id="home-recent">Recently opened</h2>
          <div className="home-card">
            <List none="Pages you open show up here.">
              {home.recents.map((r) => (
                <li key={`${r.kind}-${r.ref}`}>
                  <a href={RECENT_HREF[r.kind] + r.ref}><span className="home-pill">{r.kind.replace('-', ' ')}</span> {r.label}</a>
                  <span className="home-meta">{ago(r.openedAt)}</span>
                </li>
              ))}
            </List>
          </div>
        </section>
      </div>
    </div>
  )
}

function Panel({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return <section className={className ? `home-card ${className}` : 'home-card'}><h2>{title}</h2>{children}</section>
}

function List({ none, children }: { none: string; children: ReactNode[] }) {
  return children.length ? <ul className="home-list">{children}</ul> : <p className="home-note">{none}</p>
}

/** Phases before the current one done, the current one highlighted, the rest to do; Persistence only when the item has it. */
function PhaseBar({ current, persistence, labels }: { current: Phase | null; persistence: boolean; labels?: boolean }) {
  const list = PHASES.filter((p) => p !== 'Persistence' || persistence)
  const at = current ? list.indexOf(current) : -1
  return (
    <ol className="home-phases" aria-label={`Phase: ${current ?? 'not started'}`}>
      {list.map((p, i) => <li key={p} className={i < at ? 'done' : i === at ? 'now' : undefined}>{labels && p}</li>)}
    </ol>
  )
}

function Working({ work }: { work: HomeWork | null }) {
  if (!work) {
    return (
      <Panel title="Working on" className="home-work">
        <p className="home-note">Nothing on the go. <a href="#/boxes">Browse boxes</a></p>
      </Panel>
    )
  }
  const path = `#/${work.kind === 'box' ? 'boxes' : 'hosts'}/${work.id}`
  const facts = [work.currentPhase, work.stepNumber && `step ${work.stepNumber}`, work.totalSeconds > 0 && `${fmtTime(work.totalSeconds)} spent`,
    work.lastWorked && `last worked ${ago(work.lastWorked)}`].filter(Boolean)
  return (
    <Panel title="Working on" className="home-work">
      <span className="home-status">{STATUS_LABEL[work.status]}</span>
      <div className="home-name">
        <h3>{work.name}</h3>
        {work.network && <span className="home-pill">{work.network}</span>}
        {work.platform && <span className="home-pill">{work.platform}</span>}
        {work.difficulty && <span className="home-pill" style={{ color: `var(--${work.difficulty.toLowerCase()})` }}>{work.difficulty}</span>}
        {work.os && <span className="home-pill">{work.os}</span>}
      </div>
      {facts.length > 0 && <p className="home-note">{facts.join(' · ')}</p>}
      <PhaseBar current={work.currentPhase} persistence={work.persistence} labels />
      {work.step && (
        <dl className="home-loop">
          {(['saw', 'think', 'tried', 'got'] as const).map((k) => (
            <div key={k}><dt>{k[0].toUpperCase() + k.slice(1)}</dt><dd className={work.step![k].trim() ? undefined : 'none'}>{work.step![k].trim() || 'nothing yet'}</dd></div>
          ))}
        </dl>
      )}
      {work.openThreads.trim() && <p className="home-threads"><span>Open threads:</span> {work.openThreads}</p>}
      <div className="home-acts">
        <a className="btn primary" href={path}>Resume</a>
        <a className="btn" href={`${path}?tab=Notes`}>Notes</a>
      </div>
    </Panel>
  )
}

function Rooted({ stats, week }: { stats: Stats; week: number }) {
  const tier = (d: Difficulty) => stats.rooted.HTB[d] + stats.rooted.THM[d]
  const widest = Math.max(1, ...TIERS.map(tier))
  return (
    <Panel title="Rooted">
      <p className="home-total"><b>{stats.totals.HTB.rooted + stats.totals.THM.rooted}</b> <span>{week} this week</span></p>
      <ul className="home-bars" aria-label="Rooted by difficulty">
        {TIERS.map((d) => (
          <li key={d} style={{ '--c': `var(--${d.toLowerCase()})`, '--w': `${(tier(d) / widest) * 100}%` } as CSSProperties}>
            <span>{d}</span><i aria-hidden="true" /><span>{tier(d)}</span>
          </li>
        ))}
      </ul>
      <p className="home-platforms"><span>HTB {stats.totals.HTB.rooted}/{stats.totals.HTB.total}</span><span>THM {stats.totals.THM.rooted}/{stats.totals.THM.total}</span></p>
    </Panel>
  )
}

/** A network's hosts rooted out of its total, as a filled bar; the text beside it carries the numbers. */
function HostBar({ rooted, total }: { rooted: number; total: number }) {
  return <i className="home-hostbar" aria-hidden="true" style={{ '--w': `${(rooted / Math.max(1, total)) * 100}%` } as CSSProperties} />
}

function Unfinished({ u }: { u: HomeUnfinished }) {
  return (
    <li className="home-row">
      <div>
        <a href={`#/${u.kind === 'box' ? 'boxes' : 'networks'}/${u.id}`}>{u.name}</a>
        {u.difficulty ? <span className="home-pill" style={{ color: `var(--${u.difficulty.toLowerCase()})` }}>{u.difficulty}</span> : u.kind === 'network' && <span className="home-pill">Network</span>}
        {u.hosts ? <><span className="home-meta">{u.hosts.rooted} / {u.hosts.total} hosts</span><HostBar {...u.hosts} /></>
          : <PhaseBar current={u.currentPhase} persistence={u.persistence} />}
      </div>
      <span className="home-meta">{[u.status && STATUS_LABEL[u.status], u.lastWorked && ago(u.lastWorked)].filter(Boolean).join(' · ')}</span>
    </li>
  )
}
