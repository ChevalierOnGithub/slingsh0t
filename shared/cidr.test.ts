import { describe, expect, it } from 'vitest'
import { cidrContains, isCidr } from './cidr'

describe('cidr contains', () => {
  it('matches within a /24 only', () => {
    expect(cidrContains('10.10.110.0/24', '10.10.110.100')).toBe(true)
    expect(cidrContains('10.10.110.0/24', '10.10.111.1')).toBe(false)
  })
  it('/32 is exact, /0 is everything', () => {
    expect(cidrContains('10.0.0.5/32', '10.0.0.5')).toBe(true)
    expect(cidrContains('10.0.0.5/32', '10.0.0.6')).toBe(false)
    expect(cidrContains('0.0.0.0/0', '255.255.255.255')).toBe(true)
  })
  it('rejects invalid input', () => {
    expect(isCidr('10.0.0.0/33')).toBe(false)
    expect(isCidr('10.0.0/24')).toBe(false)
    expect(isCidr('10.0.0.256/24')).toBe(false)
    expect(isCidr('10.0.0.0')).toBe(false)
    expect(isCidr('010.0.0.0/24')).toBe(false)
    expect(isCidr('10.0.0.0/08')).toBe(false)
    expect(isCidr('0.0.0.0/0')).toBe(true)
    expect(isCidr('10.0.0.0/24')).toBe(true)
    expect(cidrContains('10.0.0.0/33', '10.0.0.1')).toBe(false)
    expect(cidrContains('10.0.0.0/24', 'nope')).toBe(false)
  })
})
