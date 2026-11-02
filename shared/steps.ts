import type { Step } from './types'

export function currentStepId(steps: Step[]): number | null {
  const sorted = [...steps].sort((a, b) => a.position - b.position)
  const cur = sorted.find((s) => !s.done && !s.dead) ?? sorted.at(-1)
  return cur?.id ?? null
}

export const fmtTime = (s: number) => {
  if (s > 0 && s < 60) return '<1m'
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
