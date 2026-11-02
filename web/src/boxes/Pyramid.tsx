import type { CSSProperties } from 'react'
import type { BoxSummary, Difficulty, Platform } from '../../../shared/types'

const ROWS: Difficulty[] = ['Insane', 'Hard', 'Medium', 'Easy']
const PLATFORMS: Platform[] = ['HTB', 'THM']

// Rooted boxes fill the pyramid; in-progress boxes (the ones queued next) sit outlined after them.
export function Pyramid({ boxes }: { boxes: BoxSummary[] }) {
  return (
    <div className="pyramids">
      {PLATFORMS.map((p) => (
        <section key={p} className="pyramid" aria-label={`${p} pyramid`}>
          <h2>{p}</h2>
          {ROWS.map((d) => {
            const mine = boxes.filter((b) => b.platform === p && b.difficulty === d)
            const rooted = mine.filter((b) => b.status === 'rooted')
            const next = mine.filter((b) => b.status === 'in_progress')
            return (
              <div key={d} className="prow" style={{ '--c': `var(--${d.toLowerCase()})` } as CSSProperties}>
                <span className="plabel">{d}</span>
                <div className="cells">
                  {rooted.map((b) => <a key={b.id} className="cell filled" href={`#/boxes/${b.id}`} title={`${b.shortId} ${b.name}`} aria-label={`${b.name}, rooted`} />)}
                  {next.map((b) => <a key={b.id} className="cell outlined" href={`#/boxes/${b.id}`} title={`${b.shortId} ${b.name}`} aria-label={`${b.name}, in progress`} />)}
                </div>
                <span className="pcount">{rooted.length}{next.length > 0 && <small> +{next.length}</small>}</span>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
