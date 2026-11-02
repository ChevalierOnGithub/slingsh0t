// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Stabilise } from './Stabilise'


test('lists the three stabilisation steps and copies a block as one paste', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(<Stabilise />)
  expect(screen.getByRole('heading', { name: 'Shell stabilisation' })).toBeTruthy()
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  await userEvent.click(screen.getByRole('button', { name: 'Copy Ctrl + Z' }))
  expect(writeText).toHaveBeenCalledWith('stty raw -echo; fg')
  await userEvent.click(screen.getByRole('button', { name: 'Copy Spawn a TTY' }))
  expect(writeText).toHaveBeenLastCalledWith("python3 -c 'import pty; pty.spawn(\"/bin/bash\")'")
  expect(screen.getByRole('button', { name: 'python3' }).getAttribute('aria-pressed')).toBe('true')
  await userEvent.click(screen.getByRole('button', { name: 'python' }))
  await userEvent.click(screen.getByRole('button', { name: /Spawn a TTY/ })) // still reads "Copied" from the first click
  expect(writeText).toHaveBeenLastCalledWith("python -c 'import pty; pty.spawn(\"/bin/bash\")'")
  expect(screen.getByText(/stty rows <num> columns <cols>/)).toBeTruthy()
})
