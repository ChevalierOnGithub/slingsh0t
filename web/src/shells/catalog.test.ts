import { expect, it } from 'vitest'
import { loadCatalog } from './catalog'
import { isFile, language, msfPayload } from './generate'

const c = loadCatalog()
const lists = [c.reverse, c.msfvenom, c.assembled]
const all = lists.flat()
const listenerNames = c.listeners.map(([n]) => n)
const holders = (s: string) => [...s.matchAll(/\{[a-z]+\}/g)].map(m => m[0])

it('returns the same object', () => expect(loadCatalog()).toBe(c))
it('has the full listener set', () => expect(c.listeners.length).toBeGreaterThanOrEqual(19))

it('names are unique per list', () => {
  for (const l of [...lists, c.listeners.map(([n]) => ({ name: n }))]) expect(new Set(l.map(p => p.name)).size).toBe(l.length)
})

it('one-liner payloads use only {ip} {port} {shell}; scripts carry {ip} and {port}', () => {
  for (const p of all) {
    if (p.command === '') continue
    if (p.command.includes('\n')) {
      expect(p.command, p.name).toContain('{ip}')
      expect(p.command, p.name).toContain('{port}')
    } else for (const h of holders(p.command)) expect(['{ip}', '{port}', '{shell}'], p.name).toContain(h)
  }
})

it('listeners use only {ip} {port} {target} {payload}', () => {
  for (const [n, cmd] of c.listeners) for (const h of holders(cmd)) expect(['{ip}', '{port}', '{target}', '{payload}'], n).toContain(h)
})

it('every entry has at least one os', () => expect(all.every(p => p.os.length > 0)).toBe(true))

it('listener links name an existing listener', () => {
  for (const p of all.filter(p => p.listener)) expect(listenerNames, p.name).toContain(p.listener)
})

it('msfvenom and assembled link the msfconsole listener their tags call for', () => {
  for (const p of [...c.msfvenom, ...c.assembled]) {
    const meter = p.tags.includes('meterpreter'), bind = p.tags.includes('bind')
    expect(/meterpreter/.test(msfPayload(p.command)), p.name).toBe(meter)
    expect(p.listener, p.name).toBe(bind ? (meter ? 'msfconsole (meterpreter, bind)' : 'msfconsole (bind)') : (meter ? 'msfconsole (meterpreter)' : 'msfconsole'))
  }
})

it('the four msfconsole listeners carry {payload}; bind ones carry {target} not {ip}', () => {
  const get = (n: string) => c.listeners.find(([x]) => x === n)![1]
  for (const n of ['msfconsole', 'msfconsole (bind)', 'msfconsole (meterpreter)', 'msfconsole (meterpreter, bind)']) {
    const cmd = get(n)
    expect(cmd, n).toContain('{payload}')
    if (n.includes('bind')) { expect(cmd, n).toContain('{target}'); expect(cmd, n).not.toContain('{ip}') }
    else expect(cmd, n).toContain('{ip}')
  }
})

it('shells are the 16 interpreters', () => {
  expect(c.shells).toEqual(['sh', '/bin/sh', 'bash', '/bin/bash', 'cmd', 'powershell', 'pwsh', 'ash', 'bsh', 'csh', 'ksh', 'zsh', 'pdksh', 'tcsh', 'mksh', 'dash'])
})

it('special templates carry {ip} and {port}', () => {
  for (const t of [c.special.ps, c.special.psStderr]) { expect(t).toContain('{ip}'); expect(t).toContain('{port}') }
})

it('has the two Base64 PowerShell entries', () => {
  const names = c.reverse.map(e => e.name)
  expect(names).toContain('PowerShell #1 (Base64)')
  expect(names).toContain('PowerShell #2 (Base64)')
})

it('reverse coverage', () => {
  expect(c.reverse.length).toBeGreaterThanOrEqual(70)
  expect(c.reverse.filter(isFile).length).toBeGreaterThanOrEqual(12)
})

it('reverse entries that need a special catcher link it', () => {
  const pairs: [RegExp, string][] = [[/conpty/i, 'windows ConPty'], [/openssl/i, 'openssl'], [/socat.*tty/i, 'socat (TTY)'], [/powercat/i, 'powercat'], [/udp/i, 'nc (UDP)'], [/^ncat tls/i, 'ncat (TLS)']]
  for (const [re, lis] of pairs) {
    const hits = c.reverse.filter((p) => re.test(p.name))
    expect(hits.length).toBeGreaterThan(0)
    for (const p of hits) expect(p.listener).toBe(lis)
  }
})

it('every reverse name that starts with a known language classifies to it', () => {
  for (const p of c.reverse)
    if (/^(bash|zsh|php|p0wny|powershell|python|nc|ncat|busybox|socat|perl|ruby|java(?!script))/i.test(p.name)) expect(language(p), p.name).not.toBe('Other')
})

it('msfvenom coverage', () => expect(c.msfvenom.length).toBeGreaterThanOrEqual(20))

it('msfvenom entries carry LHOST={ip} LPORT={port} (bind: LPORT only) and a -p', () => {
  for (const p of c.msfvenom) {
    expect(p.command, p.name).toMatch(/-p\s+\S+/)
    expect(p.command, p.name).toMatch(/LPORT=\{port\}/)
    if (p.tags.includes('bind')) expect(p.command, p.name).not.toMatch(/LHOST=/)
    else expect(p.command, p.name).toMatch(/LHOST=\{ip\}/)
  }
})

it('msfvenom carries no -f c/python/csharp shellcode lines (those are Assembled)', () => {
  for (const p of c.msfvenom) expect(p.command, p.name).not.toMatch(/-f (c|python|csharp)\b/)
})

it('assembled coverage and shape', () => {
  expect(c.assembled.length).toBeGreaterThanOrEqual(20)
  for (const p of c.assembled) {
    expect(p.command, p.name).toMatch(/^msfvenom -p \S+ (LHOST=\{ip\} )?LPORT=\{port\}$/)
    expect(p.tags.includes('reverse') || p.tags.includes('bind'), p.name).toBe(true)
    expect(p.tags.includes('x86') || p.tags.includes('x64'), p.name).toBe(true)
    expect(p.tags.includes('reverse'), p.name).toBe(p.command.includes('LHOST='))
    expect(p.command, p.name).not.toMatch(/ -[beinf] /)
  }
})

it('assembled covers every os × arch × kind', () => {
  for (const os of ['windows', 'linux', 'mac'] as const)
    for (const arch of ['x86', 'x64'])
      for (const kind of ['reverse', 'bind'])
        expect(c.assembled.some(p => p.os.includes(os) && p.tags.includes(arch) && p.tags.includes(kind)), `${os} ${arch} ${kind}`).toBe(true)
})
