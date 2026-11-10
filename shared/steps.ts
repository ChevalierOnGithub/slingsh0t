import type { Step } from './types'

export function currentStepId(steps: Step[]): number | null {
  const sorted = [...steps].sort((a, b) => a.position - b.position)
  const cur = sorted.find((s) => !s.done && !s.dead) ?? sorted.at(-1)
  return cur?.id ?? null
}

/** The tool a pasted command runs: skips sudo and VAR=val prefixes, drops any path (/ or \) and a Windows .exe. */
export const toolOf = (cmd: string): string => {
  const t = cmd.trim().split(/\s+/).filter(Boolean)
  while (t.length && (t[0] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]))) t.shift()
  return (t[0]?.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '')
}
