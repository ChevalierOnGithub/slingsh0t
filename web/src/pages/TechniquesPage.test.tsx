// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TechniqueListItem } from '../../../shared/types'
import { ContextProvider } from '../shell/TargetBar'
import { TechniquesPage } from './TechniquesPage'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const techniques: TechniqueListItem[] = [
  { id: 4, shortId: 'TQ-004', name: 'SeBackupPrivilege abuse', phase: 'PrivEsc', description: 'Read any file', position: 1, applies: 'any', service: 'any', needs: [], yields: [], commands: [], uses: [
    { boxId: 3, hostId: null, ownerName: 'Cicada', stepId: 9, phase: 'PrivEsc', ordinal: 2, dead: false },
    { boxId: null, hostId: 5, ownerName: 'WEB01', stepId: 11, phase: 'PrivEsc', ordinal: 1, dead: false },
  ] },
  { id: 1, shortId: 'TQ-001', name: 'Port scanning', phase: 'Recon', description: '', position: 1, applies: 'any', service: 'any', needs: [], yields: [], uses: [], commands: [
    { id: 7, purpose: 'Sweep', template: 'ping {{TARGET}}', procedureKey: null, position: null, intent: '' },
  ] },
]
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  location.hash = '#/techniques'
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? json(200, { ...techniques[0], ...JSON.parse(init.body as string) }) : json(200, url === '/api/techniques' ? techniques : url === '/api/context' ? { target: '10.10.11.35', lhost: '', lport: '', activeBoxId: null } : {}))
  vi.stubGlobal('fetch', fetchMock)
})

test('groups by phase in fixed order, anchors each technique and links its uses to the step', async () => {
  const { container } = render(<ContextProvider><TechniquesPage /></ContextProvider>)
  const link = await screen.findByRole('link', { name: 'Cicada · PrivEsc 2' })
  expect(link.getAttribute('href')).toBe('#/boxes/3?step=9')
  expect(screen.getByRole('link', { name: 'WEB01 · PrivEsc 1' }).getAttribute('href')).toBe('#/hosts/5?step=11')
  expect(container.querySelector('#t-4')?.textContent).toContain('SeBackupPrivilege abuse')
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Recon', 'PrivEsc'])
})

test('?t= scrolls to the technique and highlights it', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  location.hash = '#/techniques?t=4'
  const { container } = render(<ContextProvider><TechniquesPage /></ContextProvider>)
  await waitFor(() => expect(container.querySelector('#t-4')?.classList.contains('flash')).toBe(true))
  expect(scroll.mock.contexts[0]).toBe(container.querySelector('#t-4'))
  delete (Element.prototype as Partial<Element>).scrollIntoView
})

test('editing a description patches it and refreshes the sidebar counts', async () => {
  const user = userEvent.setup()
  const stats = vi.fn()
  addEventListener('slingsh0t:stats', stats)
  render(<ContextProvider><TechniquesPage /></ContextProvider>)
  const desc = await screen.findByLabelText('Description of SeBackupPrivilege abuse')
  await user.type(desc, ' as backup operator')
  await user.tab()
  await waitFor(() => expect(stats).toHaveBeenCalled())
  const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/techniques/4' && i?.method === 'PATCH')!
  expect(JSON.parse(patch[1].body)).toEqual({ description: 'Read any file as backup operator' })
  removeEventListener('slingsh0t:stats', stats)
})

test('a changed description is saved when the page unmounts', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<ContextProvider><TechniquesPage /></ContextProvider>)
  await user.type(await screen.findByLabelText('Description of Port scanning'), 'nmap first')
  unmount()
  await waitFor(() => {
    const patches = fetchMock.mock.calls.filter(([u, i]) => u === '/api/techniques/1' && i?.method === 'PATCH')
    expect(patches.map(([, i]) => JSON.parse(i.body))).toEqual([{ description: 'nmap first' }])
  })
})

test('closing the tab with an unsaved description asks first', async () => {
  const user = userEvent.setup()
  render(<ContextProvider><TechniquesPage /></ContextProvider>)
  const desc = await screen.findByLabelText('Description of Port scanning')
  const unload = () => {
    const e = new Event('beforeunload', { cancelable: true })
    dispatchEvent(e)
    return e.defaultPrevented
  }
  expect(unload()).toBe(false)
  await user.type(desc, 'x')
  expect(unload()).toBe(true)
})

test("lists a technique's tool-less commands, copyable", async () => {
  const user = userEvent.setup()
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const { container } = render(<ContextProvider><TechniquesPage /></ContextProvider>)
  await screen.findByText('10.10.11.35', { selector: 'mark' })
  expect(container.querySelector('#t-1 #cmd-7')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Copy Sweep' }))
  expect(writeText).toHaveBeenCalledWith('ping 10.10.11.35')
})

test('?cmd=<id> flashes that command', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  location.hash = '#/techniques?cmd=7'
  const { container } = render(<ContextProvider><TechniquesPage /></ContextProvider>)
  await waitFor(() => expect(container.querySelector('#cmd-7')?.classList.contains('flash')).toBe(true))
  delete (Element.prototype as Partial<Element>).scrollIntoView
})

test('applies select PATCHes', async () => {
  const user = userEvent.setup()
  render(<ContextProvider><TechniquesPage /></ContextProvider>)
  await user.selectOptions(await screen.findByLabelText('Applies to for Port scanning'), 'windows')
  const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/techniques/1' && i?.method === 'PATCH')!
  expect(JSON.parse(patch[1].body)).toEqual({ applies: 'windows' })
  await waitFor(() => expect((screen.getByLabelText('Applies to for Port scanning') as HTMLSelectElement).value).toBe('windows'))
})

test('move down PUTs the phase order and reorders the list', async () => {
  const user = userEvent.setup()
  const second: TechniqueListItem = { id: 8, shortId: 'TQ-008', name: 'Banner grabbing', phase: 'Recon', description: '', position: 2, applies: 'any', service: 'any', needs: [], yields: [], uses: [], commands: [] }
  const recon = [techniques[1], second]
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json(200, [second, { ...techniques[1], position: 2 }])
      : json(200, url === '/api/techniques' ? [...recon, techniques[0]] : url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null } : {}))
  render(<ContextProvider><TechniquesPage /></ContextProvider>)
  const first = await screen.findByRole('button', { name: 'Move Port scanning down' })
  expect(screen.getByRole('button', { name: 'Move Port scanning up' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Move Banner grabbing down' })).toHaveProperty('disabled', true)
  await user.click(first)
  const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/techniques/order' && i?.method === 'PUT')!
  expect(JSON.parse(put[1].body)).toEqual({ ids: [8, 1] })
  await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Banner grabbing', 'Port scanning', 'SeBackupPrivilege abuse']))
})

test('a failed reorder shows the error', async () => {
  const user = userEvent.setup()
  const second: TechniqueListItem = { id: 8, shortId: 'TQ-008', name: 'Banner grabbing', phase: 'Recon', description: '', position: 2, applies: 'any', service: 'any', needs: [], yields: [], uses: [], commands: [] }
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json(500, { error: 'nope' }) : json(200, url === '/api/techniques' ? [techniques[1], second] : url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null } : {}))
  render(<ContextProvider><TechniquesPage /></ContextProvider>)
  await user.click(await screen.findByRole('button', { name: 'Move Port scanning down' }))
  expect((await screen.findByRole('alert')).textContent).toContain('nope')
})

const smb: TechniqueListItem = { id: 9, shortId: 'TQ-009', name: 'Null session', phase: 'Recon', description: '', position: 2, applies: 'any', service: 'smb', needs: [], yields: [], uses: [], commands: [] }
const renderWith = (list: TechniqueListItem[]) => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? json(200, { ...list.find((x) => url.endsWith(`/${x.id}`))!, ...JSON.parse(init.body as string) })
      : json(200, url === '/api/techniques' ? list : url === '/api/context' ? { target: '', lhost: '', lport: '', activeBoxId: null } : {}))
  render(<ContextProvider><TechniquesPage /></ContextProvider>)
}

test('service select and needs pills PATCH', async () => {
  const user = userEvent.setup()
  renderWith(techniques)
  await user.selectOptions(await screen.findByLabelText('Service for Port scanning'), 'smb')
  const body = (n: number) => JSON.parse(fetchMock.mock.calls.filter(([u, i]) => u === '/api/techniques/1' && i?.method === 'PATCH')[n][1].body)
  expect(body(0)).toEqual({ service: 'smb' })
  const needs = within(screen.getByRole('group', { name: 'Needs for Port scanning' }))
  await user.click(needs.getByRole('button', { name: 'creds' }))
  expect(body(1)).toEqual({ needs: ['creds'] })
  await waitFor(() => expect(needs.getByRole('button', { name: 'creds' })).toHaveProperty('ariaPressed', 'true'))
})

test('filter chips narrow the list', async () => {
  const user = userEvent.setup()
  renderWith([...techniques, smb])
  const chips = within(await screen.findByRole('group', { name: 'Filter' }))
  await user.click(chips.getByRole('button', { name: 'smb' }))
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Null session'])
  await user.click(chips.getByRole('button', { name: 'all' }))
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3)
})

test('arrows disabled under a service filter, enabled under a phase filter', async () => {
  const user = userEvent.setup()
  renderWith([techniques[1], smb])
  const chips = within(await screen.findByRole('group', { name: 'Filter' }))
  await user.click(chips.getByRole('button', { name: 'Recon' }))
  expect(screen.getByRole('button', { name: 'Move Port scanning down' })).toHaveProperty('disabled', false)
  await user.click(chips.getByRole('button', { name: 'smb' }))
  expect(screen.getByRole('button', { name: 'Move Null session up' })).toHaveProperty('disabled', true)
  await user.click(chips.getByRole('button', { name: 'all' }))
  await user.click(chips.getByRole('button', { name: 'smb' }))
  expect(screen.getByRole('button', { name: 'Move Null session down' })).toHaveProperty('disabled', true)
})

test('used on marks dead ends', async () => {
  const dead = { ...techniques[0], uses: [{ boxId: 3, hostId: null, ownerName: 'Lame', stepId: 2, phase: 'PrivEsc' as const, ordinal: 1, dead: true }] }
  renderWith([dead])
  expect(await screen.findByRole('link', { name: 'Lame · PrivEsc 1 (dead end)' })).toBeTruthy()
})

const patches = (id: number) => fetchMock.mock.calls.filter(([u, i]) => u === `/api/techniques/${id}` && i?.method === 'PATCH').map(([, i]) => JSON.parse(i.body))

test('other… then a slug and Enter PATCHes and closes the input', async () => {
  const user = userEvent.setup()
  renderWith(techniques)
  const sel = await screen.findByLabelText('Service for Port scanning') as HTMLSelectElement
  await user.selectOptions(sel, 'other')
  await user.type(screen.getByLabelText('Other service for Port scanning'), 'nfs{Enter}')
  await waitFor(() => expect(screen.queryByLabelText('Other service for Port scanning')).toBeNull())
  expect(patches(1)).toEqual([{ service: 'nfs' }])
  expect(sel.value).toBe('nfs')
})

test('an invalid slug is not sent and is flagged', async () => {
  const user = userEvent.setup()
  renderWith(techniques)
  await user.selectOptions(await screen.findByLabelText('Service for Port scanning'), 'other')
  const input = screen.getByLabelText('Other service for Port scanning')
  await user.type(input, 'Bad Slug')
  await user.tab()
  expect(patches(1)).toEqual([])
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('lowercase letters, digits and dashes')).toBeTruthy()
})

test('other… then a listed service closes the input', async () => {
  const user = userEvent.setup()
  renderWith(techniques)
  const sel = await screen.findByLabelText('Service for Port scanning') as HTMLSelectElement
  await user.selectOptions(sel, 'other')
  await user.selectOptions(sel, 'smb')
  expect(patches(1)).toEqual([{ service: 'smb' }])
  expect(screen.queryByLabelText('Other service for Port scanning')).toBeNull()
  await waitFor(() => expect(sel.value).toBe('smb'))
})

test('a service outside the list shows as its own selected option', async () => {
  renderWith([{ ...techniques[1], service: 'zzz' }])
  expect((await screen.findByLabelText('Service for Port scanning') as HTMLSelectElement).value).toBe('zzz')
})
