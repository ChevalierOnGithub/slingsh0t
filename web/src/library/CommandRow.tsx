import type { ReactNode } from 'react'
import type { Command } from '../../../shared/types'
import { renderSegments, substitute, type Vars } from '../../../shared/placeholders'
import { useCopy } from './useCopy'
import './commandRow.css'

/** What a command's buttons name it by for screen readers; a purpose-less command uses the start of its template. */
export const cmdName = (cmd: Command) => cmd.purpose || (cmd.template.length > 40 ? `${cmd.template.slice(0, 40)}…` : cmd.template)

/** One command: purpose, live-substituted template, Copy; callers add their own buttons and an error. */
export function CommandRow({ cmd, vars, children, error, id }: { cmd: Command; vars: Vars; children?: ReactNode; error?: string | null; id?: string }) {
  const [copy, doCopy] = useCopy()
  return (
    <li className="tb-cmd" id={id}>
      {cmd.purpose && <small>{cmd.purpose}</small>}
      <div>
        {cmd.procedureKey && cmd.position !== null && <span className="pos">{cmd.position}</span>}
        <code>
          {renderSegments(cmd.template, vars).map((s, i) => (s.sub ? <mark key={i} title={s.sub}>{s.text}</mark> : s.text))}
        </code>
        <button type="button" className="tb-btn" aria-label={`${copy} ${cmdName(cmd)}`} onClick={() => doCopy(substitute(cmd.template, vars))}>{copy}</button>
        {children}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
    </li>
  )
}
