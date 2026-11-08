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

const MUST: Must[] = [
  // Task 2: the impacket suite
  { tool: 'impacket-psexec', has: ['-hashes :<hash>', '-k -no-pass'] },
  { tool: 'impacket-wmiexec', has: ['-hashes :<hash>'] },
  { tool: 'impacket-smbexec', has: ['-hashes :<hash>'] },
  { tool: 'impacket-atexec', has: ["'whoami'", '-hashes :<hash>'] },
  { tool: 'impacket-dcomexec', has: ['-object MMC20'] },
  { tool: 'impacket-smbclient', has: ['impacket-smbclient <domain>/<user>:<pass>@{{TARGET}}', '-hashes :<hash>'] },
  { tool: 'impacket-mssqlclient', has: ['-windows-auth', '-hashes :<hash>'] },
  { tool: 'impacket-secretsdump', has: ['-just-dc', '-ntds ntds.dit', 'impacket-secretsdump <domain>/<user>:<pass>@{{TARGET}}'] },
  { tool: 'impacket-lookupsid', has: ['guest@{{TARGET}} -no-pass'] },
  { tool: 'impacket-samrdump', has: ['impacket-samrdump {{TARGET}}'] },
  { tool: 'impacket-rpcdump', has: ['-port 135', 'MS-RPRN'] },
  { tool: 'impacket-DumpNTLMInfo', has: ['impacket-DumpNTLMInfo {{TARGET}}'] },
  { tool: 'impacket-GetADUsers', has: ['-all'] },
  { tool: 'impacket-GetNPUsers', has: ['-usersfile', '<domain>/<user>:<pass> -request'] },
  { tool: 'impacket-GetUserSPNs', has: ['-request', '-hashes :<hash>'] },
  { tool: 'impacket-findDelegation', has: ['impacket-findDelegation'] },
  { tool: 'impacket-Get-GPPPassword', has: ['-xmlfile', '@{{TARGET}}'] },
  { tool: 'impacket-GetLAPSPassword', has: ['impacket-GetLAPSPassword'] },
  { tool: 'impacket-dacledit', has: ['-action read', '-rights FullControl', '-rights DCSync'] },
  { tool: 'impacket-owneredit', has: ['-new-owner'] },
  { tool: 'impacket-changepasswd', has: ['-newpass', '-reset -altuser'] },
  { tool: 'impacket-addcomputer', has: ['-computer-name'] },
  { tool: 'impacket-rbcd', has: ['-delegate-from'] },
  { tool: 'impacket-getST', has: ['-impersonate administrator -dc-ip {{TARGET}}', 'SLG$'] },
  { tool: 'impacket-getTGT', has: ['-hashes :<hash>', '<domain>/<user>:<pass> -dc-ip'] },
  { tool: 'impacket-ticketer', has: ['-spn <spn>', '-extra-sid <sid>-519'] },
  { tool: 'impacket-ticketConverter', has: ['.kirbi <file>.ccache', '.ccache <file>.kirbi'] },
  { tool: 'impacket-describeTicket', has: ['.ccache'] },
  { tool: 'impacket-raiseChild', has: ['impacket-raiseChild'] },
  { tool: 'impacket-reg', has: ['backup -o', 'Winlogon'] },
  { tool: 'impacket-services', has: [' list'] },
  { tool: 'impacket-smbserver', has: ['-smb2support'] },
  { tool: 'impacket-ntlmrelayx', has: ['--delegate-access', "-c '<command>'"] },
  { tool: 'impacket-dpapi', has: ['masterkey', 'credential'] },
  { technique: 'Abuse RBCD to impersonate on a host', has: ['impacket-addcomputer'] },
  { technique: 'Forge a golden ticket (domain is done)', has: ['impacket-lookupsid'] },
  { technique: 'Pivot across a domain trust', has: ['impacket-raiseChild', '-extra-sid'] },
  { technique: 'RPC enumeration', has: ['impacket-rpcdump'] },
]

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

test('every impacket-* tool is defined only in 05-impacket.json', () => {
  const elsewhere = readSeed().flatMap(({ file, data }) => (data.tools ?? []).filter((t) => /^impacket-/i.test(t.name) && file !== '05-impacket.json').map((t) => `${file}: ${t.name}`))
  expect(elsewhere).toEqual([])
  expect(new Set(tools.filter((t) => /^impacket-/i.test(t.name)).map((t) => t.name)).size).toBe(34)
})
