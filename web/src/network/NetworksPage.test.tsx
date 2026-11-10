// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NetworkForm, NetworksPage } from './NetworksPage'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
    init?.method === 'POST' ? { id: 7 }
      : url === '/api/network-presets' ? [{ id: 'htb-dante', platform: 'HTB', name: 'Dante', hostsInScope: 14, flagsInScope: 26, source: 'x', tags: ['Active Directory'], url: 'https://app.hackthebox.com/prolabs/overview/dante' },
        { id: 'thm-holo', platform: 'THM', name: 'Holo', hostsInScope: null, flagsInScope: null, source: 'y' }]
      : [{ id: 2, shortId: 'N-002', platform: 'THM', name: 'Wreath', hostsInScope: null, flagsInScope: null, hostsFound: 3, hostsOwned: 1, flagsCaptured: 2, credentials: 0 }],
  ), { status: init?.method === 'POST' ? 201 : 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); location.hash = '' })

test('lists networks with host and flag counts', async () => {
  render(<NetworksPage />)
  const row = (await screen.findByRole('link', { name: 'Wreath' })).closest('tr')!
  expect(row.textContent).toBe('N-002WreathTHM13not set2not set')
})

test('a preset fills the form; the owner can still edit it before adding', async () => {
  render(<NetworksPage />)
  await userEvent.selectOptions(await screen.findByLabelText('Preset'), 'Dante')
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dante')
  expect((screen.getByLabelText('Hosts in scope') as HTMLInputElement).value).toBe('14')
  await userEvent.selectOptions(screen.getByLabelText('Preset'), 'Holo')
  expect((screen.getByLabelText('Platform') as HTMLSelectElement).value).toBe('THM')
  await userEvent.type(screen.getByLabelText('Hosts in scope'), '9')
  await userEvent.click(screen.getByRole('button', { name: 'Add network' }))
  await waitFor(() => expect(location.hash).toBe('#/networks/7'))
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(post[0]).toBe('/api/networks')
  expect(JSON.parse(post[1].body)).toEqual({ platform: 'THM', name: 'Holo', hostsInScope: 9, flagsInScope: null, tags: [], entry: '', presetId: 'thm-holo' })
})

test('a preset ticks Active Directory and sends its id', async () => {
  render(<NetworksPage />)
  await userEvent.selectOptions(await screen.findByLabelText('Preset'), 'Dante')
  expect((screen.getByLabelText('Active Directory') as HTMLInputElement).checked).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Add network' }))
  await waitFor(() => expect(location.hash).toBe('#/networks/7'))
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(JSON.parse(post[1].body)).toEqual({ platform: 'HTB', name: 'Dante', hostsInScope: 14, flagsInScope: 26, tags: ['Active Directory'], entry: '', presetId: 'htb-dante' })
})

test('Manual entry keeps typed fields; tags and the Active Directory box are sent', async () => {
  render(<NetworksPage />)
  await userEvent.selectOptions(await screen.findByLabelText('Preset'), 'Dante')
  await userEvent.type(screen.getByLabelText('Flags in scope'), '7')
  await userEvent.selectOptions(screen.getByLabelText('Preset'), 'Manual entry')
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dante')
  expect((screen.getByLabelText('Flags in scope') as HTMLInputElement).value).toBe('267')
  expect((screen.getByLabelText('Active Directory') as HTMLInputElement).checked).toBe(true) // kept from the Dante preset
  await userEvent.type(screen.getByLabelText('Other tags'), 'Pro Lab, , pivoting')
  await userEvent.click(screen.getByRole('button', { name: 'Add network' }))
  await waitFor(() => expect(location.hash).toBe('#/networks/7'))
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(JSON.parse(post[1].body).tags).toEqual(['Active Directory', 'Pro Lab', 'pivoting'])
  expect(JSON.parse(post[1].body)).not.toHaveProperty('presetId')
})

test('double-clicking Add network posts once', async () => {
  render(<NetworksPage />)
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'POST' && (await held), base(url, init)))
  await userEvent.type(await screen.findByLabelText('Name'), 'Lab')
  await userEvent.dblClick(screen.getByRole('button', { name: 'Add network' }))
  release()
  await waitFor(() => expect(location.hash).toBe('#/networks/7'))
  expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
})

test('a throwing onSubmit still re-enables the form', async () => {
  const onSubmit = vi.fn(async () => { throw new Error('boom') })
  // the rejection is the caller's to handle; keep it from failing the run
  const swallow = () => {}
  process.on('unhandledRejection', swallow)
  try {
    render(<NetworkForm submitLabel="Save network" onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Lab')
    const save = screen.getByRole('button', { name: 'Save network' }) as HTMLButtonElement
    await userEvent.click(save)
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    expect(onSubmit).toHaveBeenCalledTimes(2)
  } finally {
    process.off('unhandledRejection', swallow)
  }
})
