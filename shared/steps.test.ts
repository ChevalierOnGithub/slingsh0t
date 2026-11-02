import { describe, expect, it } from 'vitest'
import { currentStepId, fmtTime } from './steps'
import type { Step } from './types'

const s = (id: number, position: number, done: boolean, dead = false): Step =>
  ({ id, boxId: 1, hostId: null, phase: 'Recon', position, body: '', seconds: 0, timerStartedAt: null, done, saw: '', think: '', tried: '', got: '', dead })

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

describe('fmtTime', () => {
  it('shows <1m for under a minute, 0m for nothing', () => {
    expect([fmtTime(30), fmtTime(59), fmtTime(0), fmtTime(60)]).toEqual(['<1m', '<1m', '0m', '1m'])
  })
})
