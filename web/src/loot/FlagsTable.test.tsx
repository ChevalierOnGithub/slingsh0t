// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Flag } from '../../../shared/types'
import { FlagsTable } from './FlagsTable'


test('flag values are masked until revealed', async () => {
  const flag: Flag = { id: 1, label: 'user.txt', value: 'f00dfacecafe', hostId: null, capturedAt: '2026-11-01 04:00:00', scope: { boxId: 3 } }
  const fetchMock = vi.fn(async () => new Response(JSON.stringify([flag]), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<FlagsTable scope={{ boxId: 3 }} />)
  await screen.findByText('user.txt')
  expect(fetchMock).toHaveBeenCalledWith('/api/flags?boxId=3', expect.anything())
  expect(document.body.innerHTML).not.toContain('f00dfacecafe')
  await userEvent.click(screen.getByRole('button', { name: 'Reveal flag user.txt' }))
  expect(screen.getByText('f00dfacecafe')).toBeTruthy()
})

test('adding a flag clears the form and returns focus to its first field', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })))
  render(<FlagsTable scope={{ boxId: 3 }} />)
  await userEvent.type(screen.getByLabelText('Flag value'), 'f00d')
  await userEvent.click(screen.getByRole('button', { name: 'Add flag' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Flag label')))
  expect((screen.getByLabelText('Flag value') as HTMLInputElement).value).toBe('')
})

test('an expected flag shows not yet instead of a secret', async () => {
  const flag: Flag = { id: 1, label: 'DC01 root', value: '', hostId: null, capturedAt: '2026-11-01 04:00:00', scope: { networkId: 3 } }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([flag]), { status: 200 })))
  render(<FlagsTable scope={{ networkId: 3 }} hosts={[]} />)
  expect(await screen.findByText('not yet')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull()
  expect(screen.getByRole('row', { name: /DC01 root/ }).textContent).not.toContain('2026')
})

test('expected flags are added in bulk, one label per line; box scope has no such form', async () => {
  const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify([]), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<FlagsTable scope={{ networkId: 3 }} hosts={[]} />)
  await userEvent.type(screen.getByLabelText('Expected flags, one per line'), 'DC01 root{enter}WEB01 user')
  await userEvent.click(screen.getByRole('button', { name: 'Add expected flags' }))
  await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/flags/bulk' && i?.method === 'POST')).toBe(true))
  const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/flags/bulk')!
  expect(JSON.parse(init!.body as string)).toEqual({ networkId: 3, labels: ['DC01 root', 'WEB01 user'] })
  await waitFor(() => expect((screen.getByLabelText('Expected flags, one per line') as HTMLTextAreaElement).value).toBe(''))
  cleanup()
  render(<FlagsTable scope={{ boxId: 3 }} />)
  expect(screen.queryByLabelText('Expected flags, one per line')).toBeNull()
})

test('Add expected flags skips a blank list and is disabled while posting', async () => {
  let release = () => {}
  const fetchMock = vi.fn(async (u: string) => {
    if (u === '/api/flags/bulk') await new Promise<void>((r) => { release = r })
    return new Response(JSON.stringify([]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<FlagsTable scope={{ networkId: 3 }} hosts={[]} />)
  const button = screen.getByRole('button', { name: 'Add expected flags' })
  await userEvent.type(screen.getByLabelText('Expected flags, one per line'), '  {enter} ')
  await userEvent.click(button)
  expect(fetchMock.mock.calls.some(([u]) => u === '/api/flags/bulk')).toBe(false)
  await userEvent.type(screen.getByLabelText('Expected flags, one per line'), 'DC01 root')
  await userEvent.click(button)
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true))
  release()
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
})

test('two quick Add flag submits send one POST', async () => {
  const fetchMock = vi.fn(async (u: string, i?: RequestInit) => {
    if (i?.method === 'POST') await new Promise(() => {})
    return new Response(JSON.stringify([]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<FlagsTable scope={{ boxId: 3 }} />)
  await userEvent.type(screen.getByLabelText('Flag value'), 'f00d')
  const form = screen.getByLabelText('Flag value').closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
})
