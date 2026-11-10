// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Phase, Step } from '../../../shared/types'
import { currentStepId } from '../../../shared/steps'
import { AttackPath } from './AttackPath'

const step = (id: number, phase: Phase, dead = false): Step =>
  ({ id, boxId: 1, hostId: null, phase, position: id, body: '', done: false, saw: '', think: '', tried: '', got: '', dead })
test('a dead end is marked and skipped by the current-step outline', () => {
  const steps = [step(1, 'Recon', true), step(2, 'Initial Access')]
  render(<AttackPath steps={steps} currentStepId={currentStepId(steps)} />)
  const [a, b] = screen.getAllByRole('listitem')
  expect(a.classList.contains('dead')).toBe(true)
  expect(a.getAttribute('aria-current')).toBeNull()
  expect(b.getAttribute('aria-current')).toBe('step')
})
test('segments are equal and ordered by position', () => {
  render(
    <AttackPath
      steps={[step(3, 'PrivEsc'), step(1, 'Recon'), step(2, 'Initial Access')]}
      currentStepId={3}
    />,
  )
  const [a, b, c] = screen.getAllByRole('listitem')
  expect([a, b, c].map((li) => li.style.flexGrow)).toEqual(['', '', ''])
  expect(a.textContent).toBe('Recon')
  expect(b.textContent).toBe('Initial Access')
  expect(c.textContent).toBe('PrivEsc')
  expect(c.getAttribute('aria-current')).toBe('step')
})
