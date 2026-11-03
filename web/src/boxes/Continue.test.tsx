// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { BoxSummary } from '../../../shared/types'
import { Continue, continueList } from './Continue'

const ctx = vi.hoisted(() => ({ activeBoxId: null as number | null }))
vi.mock('../shell/TargetBar', () => ({ useTargetContext: () => ({ ctx, update: vi.fn(), error: null }) }))

const box = (id: number, status: BoxSummary['status'], startedAt: string | null, extra: Partial<BoxSummary> = {}): BoxSummary => ({
  id, shortId: `H-000${id}`, platform: 'HTB', name: `Box${id}`, os: 'Linux', difficulty: 'Easy', status,
  targetIp: null, totalSeconds: 0, releaseDate: null, dns: '', url: '', startedAt, ...extra,
})

test('continueList puts the active box first, then in-progress by startedAt, max 4', () => {
  const boxes = [
    box(1, 'in_progress', '2026-01-01'), box(2, 'user_flag', '2026-03-01'), box(3, 'in_progress', null),
    box(4, 'in_progress', '2026-02-01'), box(5, 'not_started', null), box(6, 'in_progress', '2026-04-01'),
  ]
  expect(continueList(boxes, 5).map((b) => b.id)).toEqual([5, 6, 2, 4])
  expect(continueList(boxes, 2).map((b) => b.id)).toEqual([2, 6, 4, 1])
  expect(continueList(boxes, null).map((b) => b.id)).toEqual([6, 2, 4, 1])
  expect(continueList([box(7, 'rooted', null)], 7)).toEqual([])
})

test('renders nothing when there is nothing to continue', () => {
  ctx.activeBoxId = null
  const { container } = render(<Continue boxes={[box(1, 'not_started', null), box(2, 'rooted', null)]} />)
  expect(container.firstChild).toBeNull()
})

test('renders links with id, name, status and time', () => {
  ctx.activeBoxId = null
  render(<Continue boxes={[box(4, 'in_progress', '2026-01-01', { name: 'Lame', shortId: 'H-0004', totalSeconds: 3900 })]} />)
  const link = screen.getByRole('navigation', { name: 'Continue' }).querySelector('a')!
  expect(link.getAttribute('href')).toBe('#/boxes/4')
  for (const t of ['H-0004', 'Lame', 'In progress', '1h 5m']) expect(link.textContent).toContain(t)
})
