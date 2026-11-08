import { SERVICES } from './types'
import type { BoxService } from './types'

const known = (name: string) => (SERVICES as readonly string[]).includes(name)

// nmap's service names for our slugs
const ALIAS = new Map(Object.entries({
  'microsoft-ds': 'smb', 'netbios-ssn': 'smb', domain: 'dns', 'kerberos-sec': 'kerberos', 'ms-wbt-server': 'rdp',
  'ms-sql-s': 'mssql', 'ssl/http': 'http', 'http-proxy': 'http', 'http-alt': 'http',
  msrpc: 'rpc', pop3s: 'pop3', 'ssl/pop3': 'pop3', imaps: 'imap', 'ssl/imap': 'imap', mongod: 'mongodb', 'asf-rmcp': 'ipmi', docker: 'docker-api',
}))
/** Our slug for a parsed name; nmap calls WinRM http (or wsman) on 5985/5986. */
const normal = (name: string, port: number) =>
  (port === 5985 || port === 5986) && (name === 'http' || name === 'wsman') ? 'winrm' : ALIAS.get(name) ?? name

/** One entry per name+port, first wins; keeps only name and port. */
export const uniqServices = (xs: BoxService[]): BoxService[] =>
  [...new Map(xs.map((s) => [`${s.name}:${s.port}`, { name: s.name, port: s.port }])).values()]

/** Services a Saw line names: `80/tcp open http`, `22 ssh`, `http:80` / `http/80`, or a bare SERVICES word (port null). */
export function servicesInText(text: string): BoxService[] {
  const t = text.toLowerCase()
  const found: BoxService[] = []
  const parsed = new Set<string>() // names as written, so `5985/tcp open http` doesn't also add a bare http
  const add = (raw: string, port: string, min = 1) => {
    const name = normal(raw, +port)
    if (known(name) && +port >= min && +port <= 65535) { found.push({ name, port: +port }); parsed.add(raw) }
  }
  // a port is a whole number: never an IP's last octet (`10.10.10.5 http`) nor the tail of a longer number
  for (const m of t.matchAll(/(?<![\d.])(\d{1,5})\/(?:tcp|udp)\s+(?:open\s+)?((?:ssl\/)?[a-z][a-z0-9-]*)/g)) add(m[2], m[1])
  // below 20 it's a count in prose (`found 3 smb shares`), not a port
  for (const m of t.matchAll(/(?<![\d.])(\d{1,5})\s+([a-z][a-z0-9-]*)/g)) add(m[2], m[1], 20)
  for (const m of t.matchAll(/([a-z][a-z0-9-]*)[:/](\d{1,5})(?!\d)/g)) add(m[1], m[2])
  // a bare word counts only as a whole slug (not `https`, `smb2`, `ssh-hostkey`) and only when no port was found for it
  for (const name of SERVICES)
    if (!found.some((s) => s.name === name) && !parsed.has(name) && new RegExp(`(?<![a-z0-9-])${name}(?![a-z0-9-])`).test(t)) found.push({ name, port: null })
  return uniqServices(found)
}
