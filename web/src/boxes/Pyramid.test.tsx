// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from '@testing-library/react'
import type { BoxStatus, BoxSummary, Difficulty } from '../../../shared/types'
import { Pyramid } from './Pyramid'


const box = (id: number, difficulty: Difficulty, status: BoxStatus): BoxSummary => ({
  id, shortId: `H-${id}`, platform: 'HTB', name: `Box ${id}`, os: 'Linux',
  difficulty, status, targetIp: null, totalSeconds: 0, releaseDate: null, startedAt: null, dns: '', url: '',
})

test('renders 3 filled + 1 outlined cell for fixture', () => {
  const { container } = render(<Pyramid boxes={[
    box(1, 'Easy', 'rooted'), box(2, 'Easy', 'rooted'), box(3, 'Hard', 'rooted'),
    box(4, 'Medium', 'in_progress'), box(5, 'Easy', 'not_started'), box(6, 'Insane', 'user_flag'),
  ]} />)
  expect(container.querySelectorAll('.cell.filled')).toHaveLength(3)
  expect(container.querySelectorAll('.cell.outlined')).toHaveLength(1)
})
