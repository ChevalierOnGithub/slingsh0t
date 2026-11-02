import type { Asm, Catalog, Encoding, Format, Os, Payload, Tab, Wrap } from './types'

const ALL_ENC: Encoding[] = ['raw', 'url', 'base64', 'bashb64', 'psenc']
const ALL_WRAP: Wrap[] = ['direct', 'bash', 'cmd']

export function fill(cmd: string, v: { ip: string; port: string; shell: string }): string {
  let out = cmd
  for (const k of ['ip', 'port', 'shell'] as const) if (v[k]) out = out.split(`{${k}}`).join(v[k])
  return out
}

export const ASM_DEFAULTS: Asm = { badChars: '\\x00', encoder: '', iterations: 1, nops: 0, format: 'c' }
export const FORMATS: Format[] = ['c', 'python', 'csharp', 'powershell', 'hex', 'raw']
export const ENCODERS: { name: string; arch: 'x86' | 'x64' | 'any' }[] = [
  { name: 'x86/shikata_ga_nai', arch: 'x86' }, { name: 'x86/call4_dword_xor', arch: 'x86' },
  { name: 'x86/fnstenv_mov', arch: 'x86' }, { name: 'x86/countdown', arch: 'x86' },
  { name: 'x64/zutto_dekiru', arch: 'x64' }, { name: 'x64/xor_dynamic', arch: 'x64' }, { name: 'x64/xor', arch: 'x64' },
  { name: 'cmd/powershell_base64', arch: 'any' }, { name: 'generic/none', arch: 'any' },
]
export const encodersFor = (p: Payload) => ENCODERS.filter(e => e.arch === 'any' || p.tags.includes(e.arch))

export function parseBadChars(input: string): string | null {
  const s = input.replace(/\s+/g, '').replace(/\\x|0x/gi, '')
  if (!/^([0-9a-f]{2})*$/i.test(s)) return null
  return (s.match(/../g) ?? []).map(b => '\\x' + b.toLowerCase()).join('')
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(n) || lo))

export function asmFlags(p: Payload, a: Asm): string {
  const bad = parseBadChars(a.badChars)
  const enc = encodersFor(p).some(e => e.name === a.encoder) ? a.encoder : ''
  const iters = enc ? clamp(a.iterations, 1, 20) : 1
  const nops = clamp(a.nops, 0, 4096)
  return [bad && `-b '${bad}'`, enc && `-e ${enc}`, iters > 1 && `-i ${iters}`, nops > 0 && `-n ${nops}`, `-f ${a.format}`]
    .filter(Boolean).map(s => ' ' + s).join('')
}

export const isFile = (p: Payload) => p.command.includes('\n')

type Lang = 'Bash' | 'PHP' | 'PowerShell' | 'Python' | 'nc/ncat' | 'Perl' | 'Ruby' | 'Java' | 'Other'
const LANGS: [RegExp, Lang][] = [
  [/^(bash|zsh)/, 'Bash'], [/^(php|p0wny)/, 'PHP'], [/^(powershell|windows conpty)/, 'PowerShell'],
  [/^python/, 'Python'], [/^(nc|ncat|busybox nc|sqlite3 nc|rustcat|socat|telnet|openssl|curl)/, 'nc/ncat'],
  [/^perl/, 'Perl'], [/^ruby/, 'Ruby'], [/^java(?!script)/, 'Java'],
]
export const LANGUAGES: Lang[] = [...LANGS.map(([, l]) => l), 'Other']
export function language(p: Payload): Lang {
  const n = p.name.toLowerCase()
  return LANGS.find(([re]) => re.test(n))?.[1] ?? 'Other'
}

const EXTS: [RegExp, string][] = [
  [/^(php|p0wny)/, 'php'], [/^powershell/, 'ps1'], [/^python/, 'py'], [/^perl/, 'pl'], [/^ruby/, 'rb'],
  [/^java(?!script)/, 'java'], [/^c#/, 'cs'], [/^c(\s|$)/, 'c'], [/^(javascript|node\.js)/, 'js'],
  [/^go(lang)?(\s|$)/, 'go'], [/^lua/, 'lua'], [/^dart/, 'dart'], [/^crystal/, 'cr'], [/^haskell/, 'hs'],
  [/^vlang/, 'v'], [/^groovy/, 'groovy'], [/^rust/, 'rs'], [/^jsp/, 'jsp'], [/^(bash|zsh)/, 'sh'],
]
export function fileName(p: Payload, tab: Tab): string {
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const ext = tab === 'reverse' && isFile(p) ? EXTS.find(([re]) => re.test(p.name.toLowerCase()))?.[1] : undefined
  return `${slug}.${ext ?? 'txt'}`
}

export function allowed(p: Payload, tab: Tab): { encodings: Encoding[]; wraps: Wrap[] } {
  // msfvenom and shellcode commands run on the attack box, so encoding or wrapping them for a target makes no sense
  return isFile(p) || tab !== 'reverse' ? { encodings: ['raw'], wraps: ['direct'] } : { encodings: ALL_ENC, wraps: ALL_WRAP }
}

function b64Bytes(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const b64 = (s: string) => b64Bytes(new TextEncoder().encode(s))
function b64Utf16(s: string): string {
  const b = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[i * 2] = c & 255; b[i * 2 + 1] = c >> 8 }
  return b64Bytes(b)
}

export function buildPayload(
  p: Payload, tab: Tab,
  o: { ip: string; port: string; shell: string; encoding: Encoding; wrap: Wrap; asm: Asm },
  special: Catalog['special'],
): string {
  const a = allowed(p, tab)
  const enc = a.encodings.includes(o.encoding) ? o.encoding : 'raw'
  const wrap = a.wraps.includes(o.wrap) ? o.wrap : 'direct'
  let cmd: string
  if (p.name === 'PowerShell #1 (Base64)') cmd = 'powershell -e ' + b64Utf16(fill(special.ps, o))
  else if (p.name === 'PowerShell #2 (Base64)') cmd = 'powershell -e ' + b64Utf16(fill(special.psStderr, o))
  else cmd = fill(p.command, o) + (tab === 'assembled' ? asmFlags(p, o.asm) : '')

  if (enc !== 'bashb64' && enc !== 'psenc') {
    if (wrap === 'bash') cmd = `bash -c '${cmd.replace(/'/g, `'\\''`)}'`
    else if (wrap === 'cmd') cmd = `cmd /c ${cmd}`
  }
  switch (enc) {
    case 'url': return encodeURIComponent(cmd).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    case 'base64': return b64(cmd)
    case 'bashb64': return `echo ${b64(cmd)} | base64 -d | bash`
    case 'psenc': return 'powershell -e ' + b64Utf16(cmd)
    default: return cmd
  }
}

export const msfPayload = (cmd: string) => /\s-p\s+([A-Za-z0-9/_]+)/.exec(cmd)?.[1] ?? ''

export function listenerCommand(tpl: string, v: { ip: string; port: string; target: string; payload: string }): string {
  let out = tpl
  for (const k of ['ip', 'port', 'target', 'payload'] as const) if (v[k]) out = out.split(`{${k}}`).join(v[k])
  return out
}

export function filterPayloads(
  list: Payload[],
  f: { text: string; os: Os | 'all'; lang: string | null; tag: string | null; oneLinersOnly: boolean },
): Payload[] {
  const t = f.text.toLowerCase()
  return list.filter(p =>
    p.name.toLowerCase().includes(t) &&
    (f.os === 'all' || !p.os.length || p.os.includes(f.os)) &&
    (!f.lang || language(p) === f.lang) &&
    (!f.tag || p.tags.includes(f.tag)) &&
    !(f.oneLinersOnly && isFile(p)))
}
