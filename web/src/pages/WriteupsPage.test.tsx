// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WriteupsPage } from './WriteupsPage'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const serve = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))

test('lists boxes and networks with written steps; the name and the row open the report', async () => {
  serve([
    { kind: 'box', id: 4, shortId: 'H-0004', name: 'Lame', platform: 'HTB', status: 'rooted', filledSteps: 3, totalSteps: 5, updatedAt: '2026-10-30T12:00:00.000Z' },
    { kind: 'network', id: 3, shortId: 'N-0003', name: 'Dante', platform: 'HTB', status: '1/2 hosts', filledSteps: 1, totalSteps: 2, updatedAt: '2026-11-01 10:00:00' },
  ])
  render(<WriteupsPage />)
  expect((await screen.findByRole('link', { name: 'Lame' })).getAttribute('href')).toBe('#/writeups/4')
  expect(screen.getByRole('link', { name: 'Dante' }).getAttribute('href')).toBe('#/writeups/network/3')
  const cells = screen.getAllByRole('cell').map((c) => c.textContent)
  expect(cells).toEqual(['H-0004', 'Lame', 'HTB', 'Rooted', '3/5', '2026-10-30', 'N-0003', 'Dante', 'HTB', '1/2 hosts', '1/2', '2026-11-01'])
  screen.getByText('Rooted').click()
  expect(location.hash).toBe('#/writeups/4')
  screen.getByText('1/2 hosts').click()
  expect(location.hash).toBe('#/writeups/network/3')
  location.hash = ''
})

test('says how to get a first writeup when there are none', async () => {
  serve([])
  render(<WriteupsPage />)
  expect(await screen.findByText("No writeups yet. Write a step on any box or network host and it shows up here.")).toBeTruthy()
})

test('Export all downloads the zip', async () => {
  const row = { kind: 'box', id: 1, shortId: 'H-1', name: 'A', platform: 'HTB', status: 'rooted', filledSteps: 1, totalSteps: 1, updatedAt: '2026-10-30' }
  const f = vi.fn(async () => new Response(JSON.stringify([row, { ...row, id: 2, shortId: 'H-2' }])))
  vi.stubGlobal('fetch', f)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('URL',Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
  render(<WriteupsPage />)
  ;(await screen.findByRole('button', { name: 'Export all (.zip)' })).click()
  await waitFor(() => expect(f).toHaveBeenCalledWith('/api/export/writeups.zip', expect.objectContaining({ method: 'GET' })))
})

test('no Export all button without writeups', async () => {
  serve([])
  render(<WriteupsPage />)
  await screen.findByText(/No writeups yet/)
  expect(screen.queryByRole('button', { name: 'Export all (.zip)' })).toBeNull()
})
