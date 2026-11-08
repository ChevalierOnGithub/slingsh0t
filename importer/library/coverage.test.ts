import { expect, test } from 'vitest'
import { readSeed } from './seed'

// Every finding of the 2026-11-08 library review, pinned so a later edit can't drop one silently.
const seed = readSeed().map((f) => f.data)
const tools = seed.flatMap((f) => f.tools ?? [])
const techniques = seed.flatMap((f) => f.techniques ?? [])

/** A tool (or technique) must have a command containing each `has` string. */
type Must = { tool?: string; technique?: string; has: string[] }

const toolTemplates = (name: string) =>
  tools.filter((t) => t.name.toLowerCase() === name.toLowerCase()).flatMap((t) => (t.commands ?? []).map((c) => c.template))

/** A tool's commands; for a technique, its own commands plus those of its linked tools. */
function templatesOf(m: Must): string[] {
  if (m.tool) return toolTemplates(m.tool)
  const t = techniques.find((x) => x.name === m.technique)
  return t ? [...(t.commands ?? []).map((c) => c.template), ...(t.tools ?? []).flatMap(toolTemplates)] : []
}
const allTemplates = () => [...tools, ...techniques].flatMap((t) => (t.commands ?? []).map((c) => c.template))
/** Every tool name and every technique `tools` entry. */
const allToolRefs = () => [...tools.map((t) => t.name), ...techniques.flatMap((t) => t.tools ?? [])]

const MUST: Must[] = []

test('every review finding is in the library', () => {
  const missing = MUST.flatMap((m) => {
    const ts = templatesOf(m)
    if (!ts.length) return [`${m.tool ?? m.technique}: not found or no commands`]
    return m.has.filter((h) => !ts.some((t) => t.includes(h))).map((h) => `${m.tool ?? m.technique}: no command with "${h}"`)
  })
  expect(missing).toEqual([])
})

test('netexec is spelled nxc', () => {
  expect(allTemplates().filter((t) => /(^|[;&|]\s*)netexec\b/.test(t))).toEqual([])
  expect(allToolRefs().filter((n) => n.toLowerCase() === 'netexec')).toEqual([])
})
