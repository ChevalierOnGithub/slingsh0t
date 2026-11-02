import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { CREDITS } from '../credits'
import pkg from '../../../package.json'
import reverseSrc from '../shells/reverse.ts?raw'
import { CreditsPage } from './CreditsPage'

test('renders the four sections with every credit as a link', () => {
  render(<CreditsPage />)
  const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(heads).toEqual(['Reverse shell and shellcode references', 'Included third-party code', 'Fonts', 'Libraries'])
  for (const c of CREDITS) expect(screen.getByRole('link', { name: c.name }).getAttribute('href')).toBe(c.url)
})

test('shows a licence notice where one is given', () => {
  const { container } = render(<CreditsPage />)
  const withNotice = CREDITS.filter((c) => c.notice)
  expect(withNotice.length).toBeGreaterThan(0)
  expect(container.querySelectorAll('pre.notice')).toHaveLength(withNotice.length)
  expect(container.querySelector('pre.notice')!.textContent).toBe(withNotice[0].notice)
})

test('every dependency and included script is credited', () => {
  const libs = CREDITS.filter((c) => c.section === 'libraries').map((c) => c.name)
  for (const d of Object.keys(pkg.dependencies)) expect(libs).toContain(d)
  const code = CREDITS.filter((c) => c.section === 'code').map((c) => c.name)
  const included = [...reverseSrc.matchAll(/^\/\/ included: ([^|]+?) \|/gm)].map((m) => m[1])
  expect(included.length).toBeGreaterThan(0)
  for (const n of included) expect(code).toContain(n)
})
