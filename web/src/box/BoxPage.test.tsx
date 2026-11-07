// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BoxDetail } from '../../../shared/types'
import { BoxPage } from './BoxPage'

vi.mock('./Editor', () => ({ Editor: () => null }))
vi.mock('./Toolbox', () => ({
  Toolbox: (p: { onInsert(t: string): void }) => <button onClick={() => p.onInsert('whoami')}>Insert</button>,
}))
vi.mock('../shell/TargetBar', () => ({
  useTargetContext: () => ({ ctx: { target: '', lhost: '', lport: '', activeBoxId: null }, update: vi.fn(), error: null }),
}))

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const boxOf = (id: number, stepId: number) => ({
  id, kind: 'box', shortId: 'H-0001', platform: 'HTB', name: `Box ${id}`, os: 'Linux', difficulty: 'Easy', status: 'in_progress',
  targetIp: null, totalSeconds: 0, releaseDate: null, dns: '', url: '', tags: [], nextStep: '', notes: '', foothold: '', privesc: '', rating: '', noWriteup: false, startedAt: null, rootedAt: null, uses: [], services: [], haves: [],
  steps: [{ id: stepId, boxId: id, hostId: null, phase: 'Recon', position: 0, body: '', seconds: 0, timerStartedAt: null, done: false, saw: '', think: '', tried: '', got: '', dead: false }],
}) as BoxDetail

test('a toolbox insert is applied exactly once, even after the box remounts', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? json({}) : json(url.endsWith('/1') ? boxOf(1, 5) : boxOf(2, 9)),
  )
  vi.stubGlobal('fetch', fetchMock)
  const inserts = () => fetchMock.mock.calls.filter(([url, i]) => i?.method === 'PATCH' && url === '/api/steps/5')

  // No key here on purpose: the same BoxPage instance switching boxes is the worst case.
  const { rerender } = render(<BoxPage id={1} />)
  await userEvent.click(await screen.findByText('Insert'))
  await waitFor(() => expect(inserts()).toHaveLength(1))
  rerender(<BoxPage id={2} />)
  await screen.findByText('Box 2')
  rerender(<BoxPage id={1} />)
  await screen.findByText('Box 1')
  await new Promise((r) => setTimeout(r, 1000))
  expect(inserts()).toHaveLength(1)
  expect(JSON.parse(inserts()[0][1]!.body as string)).toEqual({ body: '\n```bash\nwhoami\n```\n' })
})

test('unsaved notes are saved when the page unmounts without a blur', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'PATCH' ? {} : boxOf(1, 5)))
  vi.stubGlobal('fetch', fetchMock)
  const { unmount } = render(<BoxPage id={1} />)
  await userEvent.click(await screen.findByRole('tab', { name: 'Notes' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'admin:hunter2')
  unmount()
  const saves = () => fetchMock.mock.calls.filter(([url, i]) => i?.method === 'PATCH' && url === '/api/boxes/1')
  await waitFor(() => expect(saves()).toHaveLength(1))
  expect(JSON.parse(saves()[0][1]!.body as string)).toEqual({ notes: 'admin:hunter2' })
})

test('?step= scrolls to that step and outlines it for 2 s', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(boxOf(1, 5))))
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  location.hash = '#/boxes/1'
  render(<BoxPage id={1} />)
  await screen.findByText('Box 1')
  // Fake timers only after loading (RTL's async utils need real ones); the hash change then arms the highlight.
  vi.useFakeTimers()
  try {
    act(() => {
      location.hash = '#/boxes/1?step=5'
      dispatchEvent(new HashChangeEvent('hashchange'))
    })
    const sect = document.getElementById('step_5')!
    expect(scroll.mock.contexts[0]).toBe(sect)
    expect(sect.classList.contains('flash')).toBe(true)
    vi.advanceTimersByTime(1999)
    expect(sect.classList.contains('flash')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(sect.classList.contains('flash')).toBe(false)
  } finally {
    vi.useRealTimers()
    location.hash = ''
    delete (Element.prototype as Partial<Element>).scrollIntoView
  }
})

test('a status change refreshes the shell stats only after it succeeds', async () => {
  let fail = true
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' && fail ? new Response(JSON.stringify({ error: 'nope' }), { status: 400 }) : json(boxOf(1, 5)),
  ))
  const stats = vi.fn()
  addEventListener('slingsh0t:stats', stats)
  try {
    render(<BoxPage id={1} />)
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'user_flag')
    await screen.findByText('nope')
    expect(stats).not.toHaveBeenCalled()
    fail = false
    await userEvent.click(screen.getByText('Mark rooted'))
    await waitFor(() => expect(stats).toHaveBeenCalledTimes(1))
  } finally {
    removeEventListener('slingsh0t:stats', stats)
  }
})

test('a box with no steps offers the default steps', async () => {
  let box = { ...boxOf(1, 5), steps: [] as BoxDetail['steps'] }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/boxes/1/default-steps') box = boxOf(1, 5)
    return json(box)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<BoxPage id={1} />)
  await screen.findByText(/No steps yet/)
  await userEvent.click(screen.getByText('Start with the default steps'))
  await waitFor(() => expect(document.getElementById('step_5')).not.toBeNull())
  expect(screen.queryByText(/No steps yet/)).toBeNull()
})

test('a half-typed Loot form survives a switch to Writeup and back', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.startsWith('/api/credentials') ? [] : boxOf(1, 5))))
  render(<BoxPage id={1} />)
  await userEvent.click(await screen.findByRole('tab', { name: 'Loot' }))
  await userEvent.type(await screen.findByLabelText('User'), 'svc_web')
  await userEvent.click(screen.getByRole('tab', { name: 'Writeup' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Loot' }))
  expect((screen.getByLabelText('User') as HTMLInputElement).value).toBe('svc_web')
})

test('tabs: one tab stop, arrow keys move and select, panels are labelled by their tab', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    json(url.startsWith('/api/credentials') || url.startsWith('/api/flags') ? [] : boxOf(1, 5))))
  render(<BoxPage id={1} />)
  const writeup = await screen.findByRole('tab', { name: 'Writeup' })
  expect(writeup.tabIndex).toBe(0)
  expect(screen.getByRole('tab', { name: 'Notes' }).tabIndex).toBe(-1)
  writeup.focus()
  await userEvent.keyboard('{ArrowRight}')
  const notes = screen.getByRole('tab', { name: 'Notes' })
  expect(document.activeElement).toBe(notes)
  expect(notes.getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel', { name: 'Notes' })).toBeTruthy()
  await userEvent.keyboard('{End}')
  expect(screen.getByRole('tab', { name: 'Flags' }).getAttribute('aria-selected')).toBe('true')
  await userEvent.keyboard('{ArrowRight}')
  expect(document.activeElement).toBe(writeup)
})

test('a step link switches to the Writeup tab', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(boxOf(1, 5))))
  let hiddenAtScroll: Element | null | undefined
  Element.prototype.scrollIntoView = function (this: Element) { hiddenAtScroll = this.closest('[hidden]') }
  location.hash = '#/boxes/1'
  try {
    render(<BoxPage id={1} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Notes' }))
    expect(screen.queryByRole('tabpanel', { name: 'Writeup' })).toBeNull()
    act(() => {
      location.hash = '#/boxes/1?step=5'
      dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByRole('tabpanel', { name: 'Writeup' })).toBeTruthy()
    expect(hiddenAtScroll).toBeNull() // the step is scrolled to after its panel is shown
  } finally {
    location.hash = ''
    delete (Element.prototype as Partial<Element>).scrollIntoView
  }
})

test('window focus reloads the item', async () => {
  const fetchMock = vi.fn(async (_url: string) => json(boxOf(1, 5)))
  vi.stubGlobal('fetch', fetchMock)
  render(<BoxPage id={1} />)
  await screen.findByText('Box 1')
  const gets = () => fetchMock.mock.calls.filter(([url]) => url === '/api/boxes/1').length
  const before = gets()
  act(() => { dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(gets()).toBe(before + 1))
})

test('the DNS name beside the box name autosaves on blur', async () => {
  const calls: [string, RequestInit | undefined][] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push([url, init]); return json(init?.method === 'PATCH' ? { ...boxOf(1, 5), dns: 'lame.htb' } : boxOf(1, 5)) }))
  render(<BoxPage id={1} />)
  const dns = await screen.findByLabelText('DNS name')
  await userEvent.type(dns, 'lame.htb')
  await userEvent.tab()
  await waitFor(() => expect(calls.some(([u, i]) => u === '/api/boxes/1' && i?.method === 'PATCH' && JSON.parse(String(i.body)).dns === 'lame.htb')).toBe(true))
})

test('Delete box asks first, then deletes and opens the boxes list', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json(boxOf(1, 5)))
  vi.stubGlobal('fetch', fetchMock)
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  render(<BoxPage id={1} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Delete box' }))
  expect(confirm).toHaveBeenCalledWith("Delete Box 1 with its steps, notes, credentials and flags? This can't be undone.")
  const deletes = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'DELETE').map(([u]) => u)
  expect(deletes()).toEqual([])
  confirm.mockReturnValue(true)
  await userEvent.click(screen.getByRole('button', { name: 'Delete box' }))
  await waitFor(() => expect(location.hash).toBe('#/boxes'))
  expect(deletes()).toEqual(['/api/boxes/1'])
  location.hash = ''
})


test('?tab=Notes opens on Notes; an unknown tab falls back to Writeup', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(boxOf(1, 5))))
  location.hash = '#/boxes/1?tab=Notes'
  const { unmount } = render(<BoxPage id={1} />)
  expect((await screen.findByRole('tab', { name: 'Notes' })).getAttribute('aria-selected')).toBe('true')
  unmount()
  location.hash = '#/boxes/1?tab=Nope'
  render(<BoxPage id={1} />)
  expect((await screen.findByRole('tab', { name: 'Writeup' })).getAttribute('aria-selected')).toBe('true')
  location.hash = ''
})

test('records the box as recent once per id after it loads', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? new Response(null, { status: 204 }) : json(boxOf(1, 5)))
  vi.stubGlobal('fetch', fetchMock)
  const posts = () => fetchMock.mock.calls.filter(([u, i]) => u === '/api/recents' && i?.method === 'POST')
  render(<BoxPage id={1} />)
  await screen.findByText('Box 1')
  act(() => { dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(posts()).toHaveLength(1))
  expect(JSON.parse(posts()[0][1]!.body as string)).toEqual({ kind: 'box', ref: '1', label: 'Box 1' })
})

test('?step= beats ?tab= on first load', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(boxOf(1, 5))))
  location.hash = '#/boxes/1?tab=Notes&step=5'
  render(<BoxPage id={1} />)
  expect((await screen.findByRole('tab', { name: 'Writeup' })).getAttribute('aria-selected')).toBe('true')
  location.hash = ''
})

test('No writeup on the Writeup tab patches the box and shows the saved state', async () => {
  let box = boxOf(1, 5)
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' && url === '/api/boxes/1') box = { ...box, ...JSON.parse(init.body as string) }
    return json(box)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<BoxPage id={1} />)
  const tick = await screen.findByRole('checkbox', { name: 'No writeup' })
  expect((tick as HTMLInputElement).checked).toBe(false)
  await userEvent.click(tick)
  const patch = fetchMock.mock.calls.find(([url, i]) => i?.method === 'PATCH' && url === '/api/boxes/1')!
  expect(JSON.parse(patch[1]!.body as string)).toEqual({ noWriteup: true })
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'No writeup' }) as HTMLInputElement).checked).toBe(true))
})
