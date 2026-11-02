import { useState } from 'react'
import { useCopy } from '../library/useCopy'

const PYTHONS = ['python3', 'python'] as const
/** The TTY upgrade dance after the spawn, in the order it is typed. Each block copies as one paste. */
const STEPS: { title: string; note?: string; block: string }[] = [
  { title: 'Ctrl + Z', note: 'then in Kali', block: 'stty raw -echo; fg' },
  { title: 'Back in the reverse shell', block: 'reset\nexport SHELL=bash\nexport TERM=xterm-256color\nstty rows <num> columns <cols>' },
]

function Block({ text, name }: { text: string; name: string }) {
  const [label, copy] = useCopy()
  return (
    <div className="sg-lis-cmd">
      <code>{text}</code>
      <button type="button" className="tb-btn" aria-label={`${label} ${name}`} onClick={() => copy(text)}>{label}</button>
      <span className="vh" aria-live="polite">{label === 'Copy' ? '' : label}</span>
    </div>
  )
}

export function Stabilise() {
  const [py, setPy] = useState<(typeof PYTHONS)[number]>('python3')
  return (
    <section className="sg-stab" aria-labelledby="sg-stab-h">
      <h2 id="sg-stab-h" className="sg-lbl">Shell stabilisation</h2>
      <ol>
        <li>
          <b>Spawn a TTY</b><span className="sg-note"> in the reverse shell</span>
          {PYTHONS.map((p) => <button key={p} type="button" className="sg-tag" aria-pressed={p === py} onClick={() => setPy(p)}>{p}</button>)}
          <Block text={`${py} -c 'import pty; pty.spawn("/bin/bash")'`} name="Spawn a TTY" />
        </li>
        {STEPS.map((s) => (
          <li key={s.title}>
            <b>{s.title}</b>{s.note && <span className="sg-note"> {s.note}</span>}
            <Block text={s.block} name={s.title} />
          </li>
        ))}
      </ol>
    </section>
  )
}
