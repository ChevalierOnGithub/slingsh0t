export type Vars = { TARGET?: string; LHOST?: string; LPORT?: string; DNS?: string }
export type Segment = { text: string; sub?: 'TARGET' | 'LHOST' | 'LPORT' | 'DNS' }

// Shared /g regex is safe only because matchAll clones it (lastIndex never leaks); don't call RE.exec/test directly.
const RE =/(\\)?\{\{(TARGET|LHOST|LPORT|DNS)\}\}/g

export function renderSegments(template: string, vars: Vars): Segment[] {
  const out: Segment[] = []
  const plain = (text: string) => {
    const last = out[out.length - 1]
    if (last && !last.sub) last.text += text
    else if (text) out.push({ text })
  }
  let i = 0
  for (const m of template.matchAll(RE)) {
    plain(template.slice(i, m.index))
    i = m.index + m[0].length
    const key = m[2] as keyof Vars
    if (m[1]) plain(`{{${key}}}`) // escaped: drop the backslash, keep literal
    else if (vars[key]) out.push({ text: vars[key], sub: key })
    else plain(m[0])
  }
  plain(template.slice(i))
  return out
}

export const substitute = (template: string, vars: Vars): string =>
  renderSegments(template, vars).map((s) => s.text).join('')
