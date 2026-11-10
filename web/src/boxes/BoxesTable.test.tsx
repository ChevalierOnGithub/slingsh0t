// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BoxSummary, Difficulty } from '../../../shared/types'
import { BoxesTable } from './BoxesTable'


const box = (id: number, difficulty: Difficulty = 'Easy'): BoxSummary => ({
  id, shortId: `H-${String(id).padStart(4, '0')}`, platform: 'HTB', name: `Box ${id}`, os: 'Linux',
  difficulty, status: 'not_started', targetIp: null, releaseDate: null, startedAt: null, dns: '', url: '',
})
const bodyRows = () => screen.getAllByRole('row').slice(1)

test('renders at most 100 rows per page', async () => {
  render(<BoxesTable boxes={Array.from({ length: 250 }, (_, i) => box(i + 1))} />)
  expect(bodyRows()).toHaveLength(100)
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(bodyRows()).toHaveLength(50)
})

test('sorting by Difficulty orders Easy < Medium < Hard < Insane', async () => {
  const order: Difficulty[] = ['Hard', 'Insane', 'Easy', 'Medium']
  render(<BoxesTable boxes={order.map((d, i) => box(i + 1, d))} />)
  await userEvent.click(screen.getByRole('button', { name: 'Difficulty' }))
  expect(screen.getByRole('columnheader', { name: 'Difficulty' }).getAttribute('aria-sort')).toBe('ascending')
  expect(bodyRows().map((r) => within(r).getAllByRole('cell')[4].textContent)).toEqual(['Easy', 'Medium', 'Hard', 'Insane'])
  await userEvent.click(screen.getByRole('button', { name: 'Difficulty' }))
  expect(bodyRows().map((r) => within(r).getAllByRole('cell')[4].textContent)).toEqual(['Insane', 'Hard', 'Medium', 'Easy'])
})

test('boxes without a release date sort last in both directions', async () => {
  render(<BoxesTable boxes={[box(1), { ...box(2), releaseDate: '2024-01-01' }, { ...box(3), releaseDate: '2023-01-01' }]} />)
  const ids = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent)
  await userEvent.click(screen.getByRole('button', { name: 'Released' }))
  expect(ids()).toEqual(['H-0003', 'H-0002', 'H-0001'])
  await userEvent.click(screen.getByRole('button', { name: 'Released' }))
  expect(ids()).toEqual(['H-0002', 'H-0003', 'H-0001'])
})
