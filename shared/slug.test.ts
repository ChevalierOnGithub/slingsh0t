import { expect, test } from 'vitest'
import { headingSlug, slugger } from './slug'
test('github-style slugs', () => {
  expect(headingSlug('Machines')).toBe('machines')
  expect(headingSlug('  DC01 (Domain Controller) ')).toBe('dc01-domain-controller')
  expect(headingSlug("What didn't work")).toBe('what-didnt-work')
  expect(headingSlug('web-01_x')).toBe('web-01x')
})
test('repeats get a counter', () => {
  const s = slugger()
  expect([s('WEB01'), s('Flags'), s('WEB01'), s('WEB01')]).toEqual(['web01', 'flags', 'web01-1', 'web01-2'])
})
