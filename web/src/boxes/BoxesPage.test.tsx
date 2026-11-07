// @vitest-environment jsdom
import { expect, onTestFinished, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoxesPage } from './BoxesPage'

vi.mock('../shell/TargetBar', () => ({ useTargetContext: () => ({ ctx: { activeBoxId: null }, update: vi.fn(), error: null }) }))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

test('empty list shows empty state; submitting form posts the box and navigates', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? json(201, { id: 7 }) : json(200, []),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(<BoxesPage />)
  expect(await screen.findByText("No boxes yet. Add the box you're working on.")).toBeTruthy()

  await userEvent.selectOptions(screen.getByLabelText('Platform'), 'HTB')
  await userEvent.type(screen.getByLabelText('Name'), 'Cicada')
  await userEvent.type(screen.getByLabelText('OS'), 'Windows')
  await userEvent.selectOptions(screen.getByLabelText('Difficulty'), 'Easy')
  await userEvent.click(screen.getByLabelText('Active Directory'))
  await userEvent.click(screen.getByRole('button', { name: 'Add box' }))

  await waitFor(() => expect(location.hash).toBe('#/boxes/7'))
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(JSON.parse(post[1]!.body as string)).toEqual({
    platform: 'HTB', name: 'Cicada', os: 'Windows', difficulty: 'Easy', tags: ['Active Directory'],
  })
})

test('board status select patches the box and reverts when the server refuses', async () => {
  location.hash = '#/boxes?view=board'
  const box = { id: 3, shortId: 'H-0003', platform: 'HTB', name: 'Sea', os: 'Linux', difficulty: 'Easy', status: 'in_progress', targetIp: null, totalSeconds: 0, releaseDate: null }
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? json(500, { error: 'disk full' }) : json(200, [box]),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(<BoxesPage />)
  await userEvent.selectOptions(await screen.findByLabelText('Status of Sea'), 'rooted')

  const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
  expect(patch[0]).toBe('/api/boxes/3')
  expect(JSON.parse(patch[1]!.body as string)).toEqual({ status: 'rooted' })
  expect((await screen.findByRole('alert')).textContent).toBe('disk full')
  expect((screen.getByLabelText('Status of Sea') as HTMLSelectElement).value).toBe('in_progress')
  expect(document.activeElement).toBe(screen.getByLabelText('Status of Sea'))
  location.hash = ''
})

test('a board move keeps focus on the card select, keeps it visible in a collapsed column, and refreshes stats', async () => {
  location.hash = '#/boxes?view=board'
  const mk = (id: number, status: string) => ({ id, shortId: `H-${id}`, platform: 'HTB', name: `Box ${id}`, os: 'Linux', difficulty: 'Easy', status, targetIp: null, totalSeconds: 0, releaseDate: null })
  const boxes = [...Array.from({ length: 13 }, (_, i) => mk(i + 1, 'not_started')), mk(99, 'in_progress')]
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => json(200, init?.method === 'PATCH' ? {} : boxes)))
  const onStats = vi.fn()
  addEventListener('slingsh0t:stats', onStats)
  render(<BoxesPage />)
  expect(screen.queryByLabelText('Status of Box 13')).toBeNull()

  await userEvent.selectOptions(await screen.findByLabelText('Status of Box 99'), 'not_started')
  const select = screen.getByLabelText('Status of Box 99') as HTMLSelectElement
  expect(select.value).toBe('not_started')
  expect(document.activeElement).toBe(select)
  await waitFor(() => expect(onStats).toHaveBeenCalledTimes(1))

  // Pressing Show all releases the moved card (it no longer pins itself into the first 12), so focus lands on
  // the first card that was hidden: Box 13.
  await userEvent.click(screen.getByRole('button', { name: 'Show all 14' }))
  expect(document.activeElement).toBe(screen.getByLabelText('Status of Box 13'))
  removeEventListener('slingsh0t:stats', onStats)
  location.hash = ''
})

const mk = (id: number, extra: object = {}) => ({ id, shortId: `H-${id}`, platform: 'HTB', name: `Box ${id}`, os: 'Linux', difficulty: 'Easy', status: 'not_started', targetIp: null, totalSeconds: 0, releaseDate: null, ...extra })

test('shows a loading line until the list arrives', async () => {
  let done!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { done = r })))
  render(<BoxesPage />)
  expect(screen.getByRole('status').textContent).toBe('Loading boxes…')
  done(json(200, []))
  expect(await screen.findByText(/No boxes yet/)).toBeTruthy()
  expect(screen.queryByText('Loading boxes…')).toBeNull()
})

test('the filter bar narrows by name/ID, platform, difficulty, OS and status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(200, [
    mk(1, { name: 'Lame' }), mk(2, { name: 'Cicada', os: 'Windows', difficulty: 'Medium' }), mk(3, { name: 'Room', platform: 'THM', status: 'rooted' }),
  ])))
  render(<BoxesPage />)
  expect(await screen.findByText('2 of 3 boxes')).toBeTruthy() // rooted boxes are hidden until asked
  expect(screen.queryByText('Room')).toBeNull()
  await userEvent.selectOptions(screen.getByLabelText('Filter by status'), '')
  expect(await screen.findByText('3 boxes')).toBeTruthy()
  await userEvent.type(screen.getByLabelText('Filter by name or ID'), 'h-2')
  expect(await screen.findByText('1 of 3 boxes')).toBeTruthy()
  await userEvent.clear(screen.getByLabelText('Filter by name or ID'))
  for (const [label, value, left] of [['Filter by platform', 'THM', 'Room'], ['Filter by difficulty', 'Medium', 'Cicada'], ['Filter by OS', 'Windows', 'Cicada'], ['Filter by status', 'rooted', 'Room']]) {
    await userEvent.selectOptions(screen.getByLabelText(label), value)
    await waitFor(() => expect(screen.getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual([expect.stringContaining(left)]))
    await userEvent.selectOptions(screen.getByLabelText(label), '')
  }
})

test('the board shows rooted boxes; opening a box from the list makes it the Working on box', async () => {
  location.hash = '#/boxes?view=board'
  const stats = vi.fn()
  addEventListener('slingsh0t:stats', stats)
  onTestFinished(() => removeEventListener('slingsh0t:stats', stats))
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => json(200, init?.method === 'PUT' ? {} : [mk(1), mk(3, { name: 'Room', status: 'rooted' })]))
  vi.stubGlobal('fetch', fetchMock)
  render(<BoxesPage />)
  expect(await screen.findByText('2 boxes')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: 'Room' }))
  await waitFor(() => expect(stats).toHaveBeenCalledTimes(1)) // the target bar re-reads the context
  const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!
  expect(put[0]).toBe('/api/context')
  expect(JSON.parse(put[1]!.body as string)).toEqual({ activeBoxId: 3 })
})

test('a failed add shows its error by the Add box button', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => init?.method === 'POST' ? json(400, { error: 'invalid difficulty' }) : json(200, [])))
  render(<BoxesPage />)
  await userEvent.type(await screen.findByLabelText('Name'), 'x')
  await userEvent.type(screen.getByLabelText('OS'), 'y')
  await userEvent.click(screen.getByRole('button', { name: 'Add box' }))
  const err = await screen.findByText('invalid difficulty')
  expect(err.closest('form')).toBe(screen.getByRole('button', { name: 'Add box' }).closest('form'))
})

test('after a board move, focusing something else stops the select from taking focus back', async () => {
  location.hash = '#/boxes?view=board'
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => json(200, init?.method === 'PATCH' ? {} : [mk(1), mk(2)])))
  render(<BoxesPage />)
  await userEvent.selectOptions(await screen.findByLabelText('Status of Box 1'), 'in_progress')
  expect(document.activeElement).toBe(screen.getByLabelText('Status of Box 1'))
  await userEvent.click(screen.getByLabelText('Filter by name or ID'))
  ;(document.activeElement as HTMLElement).blur() // focus on <body> again, as after a remount
  fireEvent.dragOver(screen.getByRole('region', { name: 'Rooted' })) // any board re-render
  expect(document.activeElement).not.toBe(screen.getByLabelText('Status of Box 1'))
  location.hash = ''
})

test('adding a box announces stats before navigating', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => init?.method === 'POST' ? json(201, { id: 8 }) : json(200, [])))
  location.hash = ''
  let hashAtStats: string | null = null
  const onStats = () => { hashAtStats = location.hash }
  addEventListener('slingsh0t:stats', onStats)
  render(<BoxesPage />)
  await screen.findByText("No boxes yet. Add the box you're working on.")
  await userEvent.selectOptions(screen.getByLabelText('Platform'), 'HTB')
  await userEvent.type(screen.getByLabelText('Name'), 'Sea')
  await userEvent.type(screen.getByLabelText('OS'), 'Linux')
  await userEvent.selectOptions(screen.getByLabelText('Difficulty'), 'Easy')
  await userEvent.click(screen.getByRole('button', { name: 'Add box' }))
  await waitFor(() => expect(location.hash).toBe('#/boxes/8'))
  removeEventListener('slingsh0t:stats', onStats)
  expect(hashAtStats).not.toBeNull()
  expect(hashAtStats).not.toBe('#/boxes/8')
  location.hash = ''
})

test('the Boxes page carries the Table / Board / Pyramid view switch, current view marked', async () => {
  location.hash = '#/boxes?view=board'
  vi.stubGlobal('fetch', vi.fn(async () => json(200, [])))
  render(<BoxesPage />)
  const views = screen.getByRole('navigation', { name: 'Boxes view' })
  const links = Array.from(views.querySelectorAll('a'))
  expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Table', '#/boxes?view=table'], ['Board', '#/boxes?view=board'], ['Pyramid', '#/boxes?view=pyramid']])
  expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null])
  location.hash = ''
})
