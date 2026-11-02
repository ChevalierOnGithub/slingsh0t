// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Phase, Step } from '../../../shared/types'
import { currentStepId } from '../../../shared/steps'
import { AttackPath } from './AttackPath'

const step = (id: number, phase: Phase, seconds: number, timerStartedAt: number | null = null, dead = false): Step =>
  ({ id, boxId: 1, hostId: null, phase, position: id, body: '', seconds, timerStartedAt, done: false, saw: '', think: '', tried: '', got: '', dead })
test('a dead end is marked and skipped by the current-step outline', () => {
  const steps = [step(1, 'Recon', 0, null, true), step(2, 'Initial Access', 0)]
  render(<AttackPath steps={steps} currentStepId={currentStepId(steps)} />)
  const [a, b] = screen.getAllByRole('listitem')
  expect(a.classList.contains('dead')).toBe(true)
  expect(a.getAttribute('aria-current')).toBeNull()
  expect(b.getAttribute('aria-current')).toBe('step')
})
test('segments are equal whatever the time spent; spent and running steps are marked', () => {
  render(
    <AttackPath
      steps={[step(3, 'PrivEsc', 0, 1_800_000_000), step(1, 'Recon', 1200), step(2, 'Initial Access', 2100)]}
      currentStepId={3}
    />,
  )
  const [a, b, c] = screen.getAllByRole('listitem')
  expect([a, b, c].map((li) => li.style.flexGrow)).toEqual(['', '', ''])
  expect([a, b, c].map((li) => li.classList.contains('spent'))).toEqual([true, true, true])
  expect(a.textContent).toBe('Recon')
  expect(b.textContent).toBe('Initial Access')
  expect(c.textContent).toBe('PrivEsc')
  expect(c.getAttribute('aria-current')).toBe('step')
})
