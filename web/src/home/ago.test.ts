import { expect, test } from 'vitest'
import { ago } from './ago'

const now = Date.parse('2026-11-06T12:00:00.000Z')
const before = (ms: number) => new Date(now - ms).toISOString()
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

test.each([
  [0, 'just now'],
  [59_999, 'just now'],
  [-5 * MIN, 'just now'], // clock skew: a future stamp is not "-5m ago"
  [MIN, '1m ago'],
  [5 * MIN, '5m ago'],
  [59 * MIN, '59m ago'],
  [HOUR, '1h ago'],
  [3 * HOUR, '3h ago'],
  [23 * HOUR + 59 * MIN, '23h ago'],
  [DAY, 'yesterday'],
  [2 * DAY - 1, 'yesterday'],
  [2 * DAY, '2 days ago'],
  [4 * DAY, '4 days ago'],
  [13 * DAY, '13 days ago'],
  [14 * DAY, '2 weeks ago'],
  [29 * DAY, '4 weeks ago'],
  [30 * DAY, '1 month ago'],
  [59 * DAY, '1 month ago'],
  [60 * DAY, '2 months ago'],
  [400 * DAY, '13 months ago'],
])('%i ms ago reads %s', (ms, label) => {
  expect(ago(before(ms), now)).toBe(label)
})

test('defaults to the current time', () => {
  expect(ago(new Date().toISOString())).toBe('just now')
})
