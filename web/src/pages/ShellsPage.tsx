import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useCopy } from '../library/useCopy'
import { Stabilise } from '../shells/Stabilise'
import { useTargetContext } from '../shell/TargetBar'
import { TabList, tabPanel } from '../tabs'
import { loadCatalog } from '../shells/catalog'
import { allowed, ASM_DEFAULTS, buildPayload, encodersFor, fileName, filterPayloads, FORMATS, isFile, language, LANGUAGES, listenerCommand, msfPayload, parseBadChars } from '../shells/generate'
import type { Asm, Encoding, Format, Os, Payload, Tab, Wrap } from '../shells/types'
import './library.css'
import '../shells/shells.css'

const KEY = 'slingsh0t:shells'
const TABS: Record<string, Tab> = { Reverse: 'reverse', MSFVenom: 'msfvenom', Assembled: 'assembled' }
const OSES: [Os | 'all', string][] = [['all', 'All'], ['linux', 'Linux'], ['windows', 'Windows'], ['mac', 'macOS']]
const MSF_TAGS = ['staged', 'stageless', 'meterpreter']
const ENCODINGS: [Encoding, string][] = [['raw', 'RAW'], ['url', 'URL'], ['base64', 'BASE64'], ['bashb64', 'BASH B64'], ['psenc', 'PS ENC']]
const WRAPS: [Wrap, string][] = [['direct', 'Direct'], ['bash', 'bash -c'], ['cmd', 'cmd /c']]

type Saved = {
  tab: Tab; picked: Record<Tab, string>; shell: string; encoding: Encoding; wrap: Wrap
  listener: string | null // override for the current payload only; null: the entry's listener, else nc
  os: Os | 'all'; lang: string | null; tag: string | null; oneLinersOnly: boolean; text: string; asm: Asm
}
const CLEAR = { text: '', os: 'all', lang: null, tag: null, oneLinersOnly: false } as const
const DEFAULTS: Saved = { tab: 'reverse', picked: { reverse: '', msfvenom: '', assembled: '' }, shell: 'bash', encoding: 'raw', wrap: 'direct', listener: null, ...CLEAR, asm: ASM_DEFAULTS }

// A stored value is kept only if it has its default's type (null defaults take a string or null).
const fit = <T,>(d: T, v: unknown): T => ((d === null ? v === null || typeof v === 'string' : v !== null && typeof v === typeof d) ? (v as T) : d)
const fitAll = <T extends object>(d: T, v: unknown): T =>
  Object.fromEntries(Object.entries(d).map(([k, x]) => [k, fit(x, (v as Record<string, unknown> | null)?.[k])])) as T

function load(): Saved {
  try {
    const s = fitAll(DEFAULTS, JSON.parse(localStorage.getItem(KEY) ?? '{}'))
    const asm = fitAll(ASM_DEFAULTS, s.asm)
    return {
      ...s, tab: Object.values(TABS).includes(s.tab) ? s.tab : 'reverse', picked: fitAll(DEFAULTS.picked, s.picked), listener: null, // per-payload override: never restored
      asm: { ...asm, format: FORMATS.includes(asm.format) ? asm.format : ASM_DEFAULTS.format },
    }
  } catch {
    return DEFAULTS
  }
}

type Entry = { key: string; p: Payload }
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isWarn = (t: string) => t.startsWith('{') // a placeholder nobody filled

// shortcut: marks every occurrence of each text, so a short port like 80 also lights up elsewhere; mark during fill if that bothers.
function highlight(text: string, marks: string[]) {
  const m = marks.filter(Boolean).sort((a, b) => b.length - a.length)
  const parts = m.length ? text.split(new RegExp(`(${m.map(escape).join('|')})`)) : [text]
  return parts.map((t, i) => (i % 2 ? <mark key={i} className={isWarn(t) ? 'warn' : undefined}>{t}</mark> : t))
}

/** Toggle buttons that pick one value; `off` lists values that can't be picked right now. */
function Seg<T extends string>({ label, opts, value, off = [], onPick }: { label: string; opts: [T, string][]; value: T; off?: T[]; onPick(v: T): void }) {
  return (
    <div className="sg-opt" role="group" aria-label={label}>
      {opts.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} disabled={off.includes(v)} onClick={() => onPick(v)}>{text}</button>
      ))}
    </div>
  )
}

export function ShellsPage() {
  const cat = loadCatalog()
  const { ctx } = useTargetContext()
  const [s, setS] = useState(load)
  const set = (patch: Partial<Saved>) => setS((v) => ({ ...v, ...patch }))
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private window: nothing is remembered */ } }, [s])
  const setAsm = (patch: Partial<Asm>) => setS((v) => ({ ...v, asm: { ...v.asm, ...patch } }))
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const slash = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== '/' || t.closest?.('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      search.current?.focus()
    }
    addEventListener('keydown', slash)
    return () => removeEventListener('keydown', slash)
  }, [])
  const [copy, doCopy] = useCopy()
  const [lisCopy, doLisCopy] = useCopy()

  const tab = s.tab
  const label = Object.keys(TABS).find((k) => TABS[k] === tab)!
  const all: Entry[] = cat[tab].map((p) => ({ key: p.name, p }))
  const keep = new Set(filterPayloads(all.map((e) => e.p), {
    text: s.text, os: s.os, lang: tab === 'reverse' ? s.lang : null, tag: tab === 'msfvenom' ? s.tag : null, oneLinersOnly: tab === 'reverse' && s.oneLinersOnly,
  }))
  const shown = all.filter((e) => keep.has(e.p))
  const sel = all.find((e) => e.key === s.picked[tab]) ?? all[0] // unpicked or gone after a catalog update
  const pick = (key: string) => set({ picked: { ...s.picked, [tab]: key }, listener: null })
  const focusIdx = Math.max(0, shown.indexOf(sel)) // one tab stop, even when the selected chip is filtered out
  const chipKeys = (e: KeyboardEvent) => {
    const i = focusIdx // from the chip holding the tab stop, which is the first one when the selected chip is hidden
    const to = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: shown.length - 1 } as Record<string, number>)[e.key]
    if (to === undefined || !shown.length) return
    e.preventDefault()
    const n = (to + shown.length) % shown.length
    pick(shown[n].key)
    document.getElementById(`sg-chip-${n}`)?.focus()
  }

  const p = sel.p
  const shell = cat.shells.includes(s.shell) ? s.shell : 'bash' // a stored shell the catalog no longer lists
  const ok = allowed(p, tab)
  const enc = ok.encodings.includes(s.encoding) ? s.encoding : 'raw'
  const selfWrap = enc === 'bashb64' || enc === 'psenc' // these formats wrap on their own
  const wrap = !selfWrap && ok.wraps.includes(s.wrap) ? s.wrap : 'direct'
  const encs = encodersFor(p)
  const encoder = encs.some((e) => e.name === s.asm.encoder) ? s.asm.encoder : '' // a remembered encoder for another arch shows as Auto
  const text = buildPayload(p, tab, { ip: ctx.lhost, port: ctx.lport, shell, encoding: enc, wrap, asm: s.asm }, cat.special)
  const name = fileName(p, tab)
  const placeholderEncoded = (!ctx.lhost || !ctx.lport) && (enc !== 'raw' || p.name === 'PowerShell #1 (Base64)' || p.name === 'PowerShell #2 (Base64)')

  const lisName = s.listener ?? p.listener ?? 'nc'
  const lis = cat.listeners.find(([n]) => n === lisName) ?? cat.listeners[0]
  const lisCmd = listenerCommand(lis[1], { ip: ctx.lhost, port: ctx.lport, target: ctx.target, payload: msfPayload(tab === 'reverse' ? '' : p.command) })

  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url)) // after the click has started the download
  }
  const chip = (e: Entry) => {
    const i = shown.indexOf(e)
    return (
      <button key={e.key} id={`sg-chip-${i}`} type="button" role="radio" className="sg-chip" aria-checked={e === sel} tabIndex={i === focusIdx ? 0 : -1} onClick={() => pick(e.key)}>
        <span>{e.p.name}</span>{isFile(e.p) && <small>File</small>}
      </button>
    )
  }

  return (
    <section className="lib sg">
      <h1>Reverse shells</h1>
      <p className="sg-ctx">
        <span>LHOST <b>{ctx.lhost || '—'}</b></span>
        <span>LPORT <b>{ctx.lport || '—'}</b></span>
        <span className="sg-hint">{ctx.lhost && ctx.lport ? 'Edit them in the target bar' : 'Set LHOST and LPORT in the target bar'}</span>
      </p>
      <TabList id="sg" tabs={Object.keys(TABS)} current={label} onSelect={(t) => set({ tab: TABS[t], listener: null })} />
      {Object.keys(TABS).map((t) => (
        <div key={t} {...tabPanel('sg', t, label)}>
          {t === label && (
            <>
              <div className="sg-find">
                <input ref={search} type="search" className="lib-find" aria-label="Search payloads" placeholder="/ Search payloads (e.g. php, socat)"
                  value={s.text} onChange={(e) => set({ text: e.target.value })} />
                <Seg label="OS" opts={OSES} value={s.os} onPick={(os) => set({ os })} />
                {tab === 'reverse' && (
                  <div className="sg-tags" role="group" aria-label="Language">
                    {LANGUAGES.map((l) => (
                      <button key={l} type="button" className="sg-tag" aria-pressed={s.lang === l} onClick={() => set({ lang: s.lang === l ? null : l })}>{l}</button>
                    ))}
                    <button type="button" className="sg-tag" aria-pressed={s.oneLinersOnly} onClick={() => set({ oneLinersOnly: !s.oneLinersOnly })}>One-liners only</button>
                  </div>
                )}
                {tab === 'msfvenom' && (
                  <div className="sg-tags" role="group" aria-label="Tags">
                    {MSF_TAGS.map((g) => (
                      <button key={g} type="button" className="sg-tag" aria-pressed={s.tag === g} onClick={() => set({ tag: s.tag === g ? null : g })}>{g}</button>
                    ))}
                  </div>
                )}
              </div>

              {shown.length ? (
                <div className="sg-grid" role="radiogroup" aria-label="Payloads" onKeyDown={chipKeys}>
                  {shown.map(chip)}
                </div>
              ) : (
                <p className="sg-grid sg-none">
                  No payloads match <button type="button" className="btn" onClick={() => { set(CLEAR); search.current?.focus() }}>Clear filters</button>
                </p>
              )}

              <div className="sg-panel">
                <div className="sg-head">
                  <h2>{p.name}</h2>
                  {p.os.map((o) => <span key={o} className="sg-pill">{OSES.find(([v]) => v === o)?.[1]}</span>)}
                  {tab === 'reverse' && <span className="sg-pill">{language(p)}</span>}
                  {tab === 'msfvenom' && p.tags.map((g) => <span key={g} className="sg-pill">{g}</span>)}
                  <span className="sg-sp" />
                  {tab === 'assembled' ? (
                    <>
                      <label className="sg-lbl">Bad chars
                        <input type="text" value={s.asm.badChars} aria-invalid={parseBadChars(s.asm.badChars) === null} onChange={(e) => setAsm({ badChars: e.target.value })} />
                      </label>
                      <label className="sg-lbl">Encoder
                        <select value={encoder} onChange={(e) => setAsm({ encoder: e.target.value })}>
                          <option value="">Auto</option>
                          {encs.map((e) => <option key={e.name}>{e.name}</option>)}
                        </select>
                      </label>
                      {encoder && (
                        <label className="sg-lbl">Iterations
                          <input type="number" min={1} max={20} value={s.asm.iterations} onChange={(e) => setAsm({ iterations: Number(e.target.value) })} />
                        </label>
                      )}
                      <label className="sg-lbl">NOP sled
                        <input type="number" min={0} max={4096} value={s.asm.nops} onChange={(e) => setAsm({ nops: Number(e.target.value) })} />
                      </label>
                      <label className="sg-lbl">Format
                        <select value={s.asm.format} onChange={(e) => setAsm({ format: e.target.value as Format })}>
                          {FORMATS.map((f) => <option key={f}>{f}</option>)}
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      {p.command.includes('{shell}') && (
                        <label className="sg-lbl">Shell
                          <select value={shell} onChange={(e) => set({ shell: e.target.value })}>
                            {cat.shells.map((sh) => <option key={sh}>{sh}</option>)}
                          </select>
                        </label>
                      )}
                      {tab === 'reverse' && (
                        <>
                          <span className="sg-lbl">Encoding</span>
                          <Seg label="Encoding" opts={ENCODINGS} value={enc} off={ENCODINGS.map(([v]) => v).filter((v) => !ok.encodings.includes(v))} onPick={(encoding) => set({ encoding })} />
                          <span className="sg-lbl">Wrap</span>
                          <Seg label="Wrap" opts={WRAPS} value={wrap} off={WRAPS.map(([v]) => v).filter((v) => v !== 'direct' && (selfWrap || !ok.wraps.includes(v)))} onPick={(w) => set({ wrap: w })} />
                        </>
                      )}
                    </>
                  )}
                  <button type="button" className="btn" onClick={save}>Save .{name.split('.').pop()}</button>
                  <button type="button" className="btn primary" onClick={() => doCopy(text)}>{copy === 'Copy' ? 'Copy payload' : copy}</button>
                  <span className="vh" aria-live="polite">{copy === 'Copy' ? '' : copy}</span>
                </div>
                <pre className="sg-code">{highlight(text, enc === 'raw' ? [ctx.lhost, ctx.lport, '{ip}', '{port}'] : [])}</pre>
                {placeholderEncoded && <p className="err" role="status">LHOST/LPORT is empty: the encoded payload contains the placeholder.</p>}
              </div>

              <div className="sg-lis">
                <span className="sg-lbl">Listener</span>
                {cat.listeners.map(([n]) => (
                  <button key={n} type="button" className="sg-tag" aria-pressed={n === lis[0]} onClick={() => set({ listener: n })}>{n}</button>
                ))}
                <div className="sg-lis-cmd">
                  <code>{highlight(lisCmd, [ctx.lhost, ctx.lport, ctx.target, '{ip}', '{port}', '{target}', '{payload}'])}</code>
                  <button type="button" className="tb-btn" aria-label={`${lisCopy} listener`} onClick={() => doLisCopy(lisCmd)}>{lisCopy}</button>
                  <span className="vh" aria-live="polite">{lisCopy === 'Copy' ? '' : lisCopy}</span>
                </div>
              </div>
              <Stabilise />
            </>
          )}
        </div>
      ))}
    </section>
  )
}
