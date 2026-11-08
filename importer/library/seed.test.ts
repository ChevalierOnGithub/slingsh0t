import { expect, test } from 'vitest'
import { openDb } from '../../server/db'
import { loadSeed, normalTemplate, readSeed, validateSeed, type SeedFile } from './seed'

const files = (data: SeedFile, file = 'x.json') => [{ file, data }]

test('validateSeed catches the mistakes a hand-written file makes', () => {
  const bad: SeedFile = {
    tools: [{ name: 'nmap', commands: [{ purpose: 'x', template: 'nmap {{IP}}', intent: 'scan' as never }] }],
    techniques: [
      { name: 'A', phase: 'Nope' as never, service: 'Bad Slug', applies: 'mac' as never, needs: ['laser' as never], tools: ['ghost'] },
      { name: 'a', phase: 'Recon' },
    ],
  }
  const errors = validateSeed(files(bad))
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('unknown placeholder {{IP}}'),
    expect.stringContaining('bad intent "scan"'),
    expect.stringContaining('bad phase "Nope"'),
    expect.stringContaining('bad service "Bad Slug"'),
    expect.stringContaining('bad applies "mac"'),
    expect.stringContaining('bad have "laser"'),
    expect.stringContaining('unknown tool "ghost"'),
    expect.stringContaining('duplicate name'),
  ]))
})

test('validateSeed rejects near-duplicate commands across files and unknown service slugs', () => {
  const errors = validateSeed([
    { file: 'a.json', data: { tools: [{ name: 'evil-winrm', commands: [{ purpose: 'x', template: "evil-winrm -i {{TARGET}} -u '<user>' -p '<pass>'", intent: 'authenticate' }] }] } },
    { file: 'b.json', data: {
      tools: [{ name: 'Evil-WinRM', commands: [{ purpose: 'y', template: 'evil-winrm -i {{TARGET}} -u <user> -p <pass>', intent: 'pivot' }] }],
      techniques: [{ name: 'Mail', phase: 'Recon', service: 'pop99' }],
    } },
  ])
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('near-duplicate of "evil-winrm -i {{TARGET}} -u \'<user>\' -p \'<pass>\'"'),
    expect.stringContaining('service "pop99" is not any, shell or a SERVICES slug'),
  ]))
})

test('a near-duplicate inside one technique is caught; different literal values are not near-duplicates', () => {
  expect(validateSeed(files({ techniques: [{ name: 'T', phase: 'Recon', commands: [
    { purpose: 'a', template: 'rpcclient -U "" -N {{TARGET}}', intent: 'enumerate' },
    { purpose: 'b', template: "rpcclient -U '' -N {{TARGET}}", intent: 'enumerate' },
  ] }] }))).toEqual([expect.stringContaining('near-duplicate of')])
  expect(validateSeed(files({ tools: [{ name: 'hashcat', commands: [
    { purpose: 'a', template: 'hashcat -m 1000 <hashfile> x', intent: 'tune' },
    { purpose: 'b', template: 'hashcat -m <mode> <hashfile> x', intent: 'tune' },
  ] }] }))).toEqual([])
})

test('a technique command that repeats a linked tool command is a near-duplicate, even when identical', () => {
  const errors = validateSeed(files({
    tools: [{ name: 'rpcclient', commands: [{ purpose: 'a', template: "rpcclient -U '' -N {{TARGET}}", intent: 'enumerate' }] }],
    techniques: [{ name: 'T', phase: 'Recon', tools: ['rpcclient'], commands: [
      { purpose: 'b', template: 'rpcclient -U "" -N {{TARGET}}', intent: 'enumerate' },
      { purpose: 'c', template: "rpcclient -U '' -N {{TARGET}}", intent: 'enumerate' },
    ] }],
  }))
  expect(errors).toEqual([expect.stringContaining('#1: near-duplicate of linked tool rpcclient'), expect.stringContaining('#2: near-duplicate of linked tool rpcclient')])
})

test('loadSeed keeps technique uses whose technique still exists, by name, with tool ids remapped', () => {
  const db = openDb(':memory:')
  const seed: SeedFile = {
    tools: [{ name: 'smbclient', commands: [{ purpose: 'x', template: 'smbclient -L {{TARGET}}', intent: 'enumerate' }] }],
    techniques: [{ name: 'Share enumeration', phase: 'Recon', tools: ['smbclient'] }, { name: 'Gone', phase: 'Recon' }],
  }
  loadSeed(db, files(seed))
  db.exec("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('BX-0001', 'HTB', 'b', 'Easy'); INSERT INTO steps (box_id, phase, position) VALUES (1, 'Recon', 0)")
  const tq = (n: string) => (db.prepare('SELECT id FROM techniques WHERE name = ?').get(n) as { id: number }).id
  const tl = (db.prepare("SELECT id FROM tools WHERE name = 'smbclient'").get() as { id: number }).id
  db.prepare('INSERT INTO technique_uses (technique_id, step_id, tool_ids) VALUES (?, 1, ?)').run(tq('Share enumeration'), JSON.stringify([tl, 999]))
  db.prepare('INSERT INTO technique_uses (technique_id, step_id, tool_ids) VALUES (?, 1, NULL)').run(tq('Gone'))
  const next: SeedFile = { tools: [{ name: 'nmap' }, ...seed.tools!], techniques: [{ name: 'Port scanning', phase: 'Recon' }, seed.techniques![0]] }
  expect(loadSeed(db, files(next)).uses).toEqual({ kept: 1, dropped: 1 })
  const tl2 = (db.prepare("SELECT id FROM tools WHERE name = 'smbclient'").get() as { id: number }).id
  expect(db.prepare('SELECT technique_id, step_id, tool_ids FROM technique_uses').all()).toEqual([{ technique_id: tq('Share enumeration'), step_id: 1, tool_ids: JSON.stringify([tl2]) }])
})

test('normalTemplate ignores quoting, case, blank names, spacing and the netexec spelling', () => {
  expect(normalTemplate(`netexec  smb {{TARGET}} -u '<user>' -p "<pass>"`)).toBe(normalTemplate('nxc smb {{TARGET}} -u <USER> -p <password>'))
})

test('loadSeed wipes the library and loads tools, techniques, links and commands in file order', () => {
  const db = openDb(':memory:')
  db.exec("INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-0001', 'Old', 'Recon'); INSERT INTO tools (short_id, name) VALUES ('TL-0001', 'old')")
  const seed: SeedFile = {
    tools: [{ name: 'nmap', description: 'scanner', commands: [{ purpose: 'quick', template: 'nmap -sC -sV {{TARGET}}', intent: 'enumerate' }, { purpose: 'dup', template: 'nmap -sC -sV {{TARGET}}', intent: 'enumerate' }] }],
    techniques: [
      { name: 'Port scanning', phase: 'Recon', tools: ['nmap'], yields: ['version', 'version'] },
      { name: 'Directory discovery', phase: 'Recon', service: 'http', needs: ['web app'], commands: [{ purpose: 'dirs', template: 'ffuf -u http://{{DNS}}/FUZZ', intent: 'enumerate' }] },
      { name: 'Sudo abuse', phase: 'PrivEsc', service: 'shell', applies: 'linux', needs: ['shell'], yields: ['admin'], when: 'sudo -l shows something' },
    ],
  }
  expect(loadSeed(db, files(seed))).toEqual({ techniques: 3, tools: 1, commands: 2, uses: { kept: 0, dropped: 0 } })
  expect(db.prepare("SELECT name, phase, position, service, applies, needs, yields, description FROM techniques ORDER BY id").all()).toEqual([
    { name: 'Port scanning', phase: 'Recon', position: 1, service: 'any', applies: 'any', needs: '[]', yields: '["version"]', description: '' },
    { name: 'Directory discovery', phase: 'Recon', position: 2, service: 'http', applies: 'any', needs: '["web app"]', yields: '[]', description: '' },
    { name: 'Sudo abuse', phase: 'PrivEsc', position: 1, service: 'shell', applies: 'linux', needs: '["shell"]', yields: '["admin"]', description: 'sudo -l shows something' },
  ])
  expect(db.prepare('SELECT name, description FROM tools').all()).toEqual([{ name: 'nmap', description: 'scanner' }])
  expect(db.prepare('SELECT COUNT(*) AS n FROM technique_tools').get()).toEqual({ n: 1 })
  expect(db.prepare('SELECT intent, tool_id IS NULL AS own FROM commands ORDER BY id').all()).toEqual([{ intent: 'enumerate', own: 0 }, { intent: 'enumerate', own: 1 }])
  expect(db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE kind = 'technique'").get()).toEqual({ n: 3 })
})

test('the shipped seed files are valid', () => {
  const seed = readSeed()
  expect(seed.length).toBeGreaterThan(0)
  expect(validateSeed(seed)).toEqual([])
})
