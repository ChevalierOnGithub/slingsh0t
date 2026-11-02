import { expect, test } from 'vitest'
import { matchPages, PAGES } from './pages'

const labels = (q: string) => matchPages(q).map((p) => p.label)

test('matches page keywords by prefix', () => {
  expect(labels('reverse shell php')).toEqual(['Reverse shells'])
  expect(labels('msfvenom')).toEqual(['Reverse shells'])
  expect(labels('cred')).toEqual(['Loot', 'Credits'])
  expect(labels('creds')).toEqual([])
})

test("short words don't match pages", () => {
  expect(labels('ph')).toEqual([])
})

test('every page href is a hash route', () => {
  for (const p of PAGES) expect(p.href.startsWith('#/')).toBe(true)
})

test('credits is the last palette page', () => {
  expect(PAGES.at(-1)).toMatchObject({ label: 'Credits', href: '#/credits' })
  expect(labels('licence')).toEqual(['Credits'])
})
