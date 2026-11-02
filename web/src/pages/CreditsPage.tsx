import { CREDITS, type Credit } from '../credits'
import './library.css'

const SECTIONS: [Credit['section'], string][] = [
  ['references', 'Reverse shell and shellcode references'], ['code', 'Included third-party code'], ['fonts', 'Fonts'], ['libraries', 'Libraries'],
]

export function CreditsPage() {
  return (
    <section className="lib">
      <h1>Credits</h1>
      {SECTIONS.map(([section, heading]) => (
        <div key={section}>
          <h2>{heading}</h2>
          <ul>
            {CREDITS.filter((c) => c.section === section).map((c) => (
              <li key={c.name}>
                <a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a> — {c.what} · {c.licence}
                {c.notice && <pre className="notice">{c.notice}</pre>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
