// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AD_TAG, type BoxDetail, type Command, type TechniqueNode, type Toolbox as ToolboxData } from '../../../shared/types'
import { ContextProvider } from '../shell/TargetBar'
import { Toolbox } from './Toolbox'

const NMAP = 'nmap -p- --min-rate 1400 {{TARGET}}'
const cmd = (id: number, purpose: string, template: string, intent: Command['intent'] = ''): Command => ({ id, purpose, template, procedureKey: null, position: null, intent })
const tech = (o: Partial<TechniqueNode>): TechniqueNode => ({ id: 4, shortId: 'TQ-004', name: 'RDP checks', phase: 'Recon', description: '', position: 3, applies: 'any', service: 'any', needs: [], yields: [], commands: [], tools: [], uses: [], ...o })

// Recon: any (nmap), http (needs a web app), smb, ldap (no shelf on this box); PrivEsc: after a shell.
const fixture: ToolboxData = {
  phases: [
    {
      phase: 'Recon',
      techniques: [
        tech({ id: 1, shortId: 'TQ-001', name: 'Port and service scanning', position: 1, yields: ['version'], tools: [{ id: 1, shortId: 'TL-001', name: 'nmap', commands: [cmd(1, 'All TCP ports', NMAP, 'discover')] }] }),
        tech({ id: 3, shortId: 'TQ-003', name: 'Web enumeration', position: 2, service: 'http', needs: ['web app'], tools: ['ffuf', 'gobuster', 'nikto'].map((name, i) => ({ id: 10 + i, shortId: `TL-01${i}`, name, commands: [] })) }),
        tech({ id: 8, shortId: 'TQ-008', name: 'SMB shares', position: 3, service: 'smb', yields: ['creds'] }),
        tech({ id: 9, shortId: 'TQ-009', name: 'LDAP dump', position: 4, service: 'ldap', needs: ['creds'] }),
      ],
    },
    {
      phase: 'PrivEsc',
      techniques: [tech({
        id: 2, shortId: 'TQ-002', name: 'SeBackupPrivilege abuse', phase: 'PrivEsc', position: 1, service: 'shell', yields: ['admin'],
        commands: [{ id: 2, purpose: 'Dump SAM hive', template: 'reg save hklm\\sam C:\\temp\\sam', procedureKey: 'backup', position: 1, intent: 'dump' }],
      })],
    },
  ],
}
const box = {
  id: 7, kind: 'box', status: 'in_progress', nextStep: '', uses: [], tags: [], os: 'Linux', haves: [],
  services: [{ name: 'http', port: 80 }, { name: 'smb', port: 445 }, { name: 'ssh', port: 22 }],
  steps: [
    { id: 11, boxId: 7, phase: 'Recon', position: 1, body: 'done', seconds: 0, timerStartedAt: null, done: false, saw: '', think: '', tried: '', got: '', dead: false },
    { id: 12, boxId: 7, phase: 'PrivEsc', position: 2, body: '', seconds: 0, timerStartedAt: null, done: false, saw: '', think: '', tried: '', got: '', dead: false },
  ],
} as unknown as BoxDetail

let fetchMock: ReturnType<typeof vi.fn>
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/context') return json(200, { target: '10.10.11.35', lhost: '10.10.14.7', lport: '4444', activeBoxId: 7 })
    if (url === '/api/toolbox?boxId=7') return json(200, fixture)
    if (url === '/api/techniques' && init?.method === 'POST') return json(201, { id: 50, ...JSON.parse(init.body as string) })
    if (url === '/api/technique-uses' && init?.method === 'POST') return json(201, { id: 99, ...JSON.parse(init.body as string), toolIds: null })
    return json(200, {})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { delete (navigator as { clipboard?: unknown }).clipboard })

const setup = (props: Partial<Parameters<typeof Toolbox>[0]> = {}) => {
  const user = userEvent.setup()
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const onInsert = vi.fn()
  const onChanged = vi.fn()
  const ui = (p: typeof props) => (
    <ContextProvider>
      <Toolbox item={box} currentStepId={12} onInsert={onInsert} onChanged={onChanged} {...p} />
    </ContextProvider>
  )
  const { rerender } = render(ui(props))
  return { user, writeText, onInsert, onChanged, rerender: (p: typeof props) => rerender(ui(p)) }
}

const row = async (template: string) => (await screen.findByText(template, { exact: false })).closest('li') as HTMLElement
const posts = (url: string) => fetchMock.mock.calls.filter(([u, i]) => u === url && i?.method === 'POST').map(([, i]) => JSON.parse(i.body))
const patches = () => fetchMock.mock.calls.filter(([u, i]) => u === '/api/boxes/7' && i?.method === 'PATCH').map(([, i]) => JSON.parse(i.body))
const serve = (data: ToolboxData) => fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
  url === '/api/toolbox?boxId=7' ? json(200, data) : url === '/api/context' ? json(200, { target: '', lhost: '', lport: '', activeBoxId: 7 }) : json(init?.method === 'POST' ? 201 : 200, {}))
const recon = (...extra: TechniqueNode[]): ToolboxData => ({ phases: [{ phase: 'Recon', techniques: [...fixture.phases[0].techniques, ...extra] }, fixture.phases[1]] })
// A technique can show in Next up and on its shelf, so row queries look inside the shelves.
const tree = () => within(screen.getByRole('region', { name: 'Shelves' }))
const techRow = (name: string) => tree().getByRole('button', { name }).closest('.tb-row') as HTMLElement
const shelf = (title: string) => tree().getByText(title, { selector: 'summary b' }).closest('details') as HTMLDetailsElement
const shelfTitles = () => [...document.querySelectorAll('.tb-shelf > summary b')].map((b) => b.textContent)
const nextUpNames = () => [...screen.getByRole('region', { name: 'Next up' }).querySelectorAll('.tb-head b')].map((b) => b.textContent)

test('substitutes TARGET in a mark, copies the substituted command, inserts the raw template', async () => {
  const { user, writeText, onInsert } = setup()
  const mark = await tree().findByText('10.10.11.35', { selector: 'mark' })
  const cmd = mark.closest('li') as HTMLElement
  await user.click(within(cmd).getByRole('button', { name: 'Copy All TCP ports' }))
  expect(writeText).toHaveBeenCalledWith('nmap -p- --min-rate 1400 10.10.11.35')
  expect(await within(cmd).findByRole('button', { name: 'Copied All TCP ports' })).toBeTruthy()
  await user.click(within(cmd).getByRole('button', { name: 'Insert All TCP ports' }))
  expect(onInsert).toHaveBeenCalledWith(NMAP)
})

test('shows Copy failed when the clipboard rejects', async () => {
  const { user, writeText } = setup()
  writeText.mockRejectedValueOnce(new Error('denied'))
  const cmd = await row('reg save hklm')
  await user.click(within(cmd).getByRole('button', { name: 'Copy Dump SAM hive' }))
  expect(await within(cmd).findByRole('button', { name: 'Copy failed Dump SAM hive' })).toBeTruthy()
})

test('search filters case-insensitively and / focuses it', async () => {
  const { user } = setup()
  await tree().findByText('Port and service scanning')
  const search = screen.getByPlaceholderText('Find a technique, tool or command')
  await user.keyboard('/')
  expect(document.activeElement).toBe(search)
  await user.type(search, 'seback')
  expect(shelfTitles()).toEqual(['after a shell'])
  expect(screen.queryByRole('region', { name: 'Next up' })).toBeNull()
  expect(screen.queryByText('Port and service scanning')).toBeNull()
  expect(screen.getByText('SeBackupPrivilege abuse')).toBeTruthy()
})

test('Mark used with the default selection posts the current step', async () => {
  const { user, onChanged } = setup()
  const tech = (await screen.findByText('SeBackupPrivilege abuse')).closest('details') as HTMLElement
  await user.click(within(tech).getByRole('button', { name: 'Mark used: SeBackupPrivilege abuse' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/technique-uses' && i?.method === 'POST')!
  expect(JSON.parse(post[1].body)).toEqual({ techniqueId: 2, stepId: 12 })
})

test('shelf + add creates with that service and does not mark used', async () => {
  const { user, onChanged } = setup()
  await user.click(await tree().findByRole('button', { name: 'Add a technique to smb' }))
  await user.type(screen.getByLabelText('New technique in smb'), 'Null session{Enter}')
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(posts('/api/techniques')).toEqual([{ name: 'Null session', phase: 'PrivEsc', service: 'smb' }])
  expect(posts('/api/technique-uses')).toEqual([])
  expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/tried'))).toEqual([])
})

test('open threads saves against the last saved value, not the prop', async () => {
  const { user } = setup()
  const next = await screen.findByPlaceholderText('One per line: what you still want to pull on')
  await user.type(next, 'A')
  await user.tab()
  await user.clear(next)
  await user.tab()
  await waitFor(() => expect(patches()).toEqual([{ nextStep: 'A' }, { nextStep: '' }]))
})

test('Open threads typed then unmounted is saved', async () => {
  const { user } = setup()
  await user.type(await screen.findByPlaceholderText('One per line: what you still want to pull on'), 'try kerberoast')
  cleanup()
  await waitFor(() => expect(patches()).toEqual([{ nextStep: 'try kerberoast' }]))
})

const used = { ...fixture.phases[1].techniques[0], uses: [{ id: 77, techniqueId: 2, stepId: 12, toolIds: null }] }
const withUse: ToolboxData = { phases: [fixture.phases[0], { phase: 'PrivEsc', techniques: [used] }] }

test('uses are labelled by phase, with an ordinal only when the phase repeats, and Remove deletes that use', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/toolbox?boxId=7' ? json(200, withUse) : url === '/api/context' ? json(200, { target: '', lhost: '', lport: '', activeBoxId: 7 }) : json(200, {}))
  const { user, onChanged } = setup({ currentStepId: 11 })
  expect(await screen.findByText('used · PrivEsc')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'SeBackupPrivilege abuse' }))
  expect(screen.getAllByRole('option', { name: 'Recon' }).length).toBeGreaterThan(0)
  await user.click(screen.getByRole('button', { name: 'Remove SeBackupPrivilege abuse from PrivEsc' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/technique-uses/77' && i?.method === 'DELETE')).toBe(true)
})

test('"This box" scope shows only used techniques', async () => {
  fetchMock.mockImplementation(async (url: string) => json(200, url === '/api/toolbox?boxId=7' ? withUse : { target: '', lhost: '', lport: '', activeBoxId: 7 }))
  const { user } = setup()
  await tree().findByText('Port and service scanning')
  await user.click(screen.getByRole('button', { name: 'This box' }))
  expect(screen.queryByText('Port and service scanning')).toBeNull()
  expect(screen.getByText('SeBackupPrivilege abuse')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'All techniques' }))
  expect(tree().getByText('Port and service scanning')).toBeTruthy()
})

test('a rooted box offers no Mark used and no + add', async () => {
  const { user } = setup({ item: { ...box, status: 'rooted' } as BoxDetail })
  await user.click(await tree().findByRole('button', { name: 'SeBackupPrivilege abuse' }))
  expect(screen.queryByRole('button', { name: /^Mark used/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Add a technique/ })).toBeNull()
  expect(screen.queryByText('+ add')).toBeNull()
})

test('rows follow position and show first +N tools and the inline command', async () => {
  serve(recon(tech({})))
  setup()
  const port = await tree().findByRole('button', { name: 'Port and service scanning' })
  const rdp = tree().getByRole('button', { name: 'RDP checks' })
  expect(port.compareDocumentPosition(rdp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const web = tree().getByRole('button', { name: 'Web enumeration' })
  expect(web.getAttribute('aria-expanded')).toBe('false')
  expect(web.textContent).toContain('ffuf +2')
  expect(within(techRow('Port and service scanning')).getByRole('button', { name: 'Copy All TCP ports' })).toBeTruthy()
  expect(within(techRow('Web enumeration')).queryByRole('button', { name: /^Copy/ })).toBeNull()
})

test('the inline command skips a tool with no commands', async () => {
  serve(recon(tech({ tools: [{ id: 44, shortId: 'TL-044', name: 'empty', commands: [] }, { id: 45, shortId: 'TL-045', name: 'nxc', commands: [cmd(43, 'Spray', 'nxc rdp {{TARGET}}')] }] })))
  setup()
  await tree().findByRole('button', { name: 'RDP checks' })
  expect(within(techRow('RDP checks')).getByRole('button', { name: 'Copy Spray' })).toBeTruthy()
})

test('go-to command follows intent order', async () => {
  serve(recon(tech({ tools: [
    { id: 44, shortId: 'TL-044', name: 'nc', commands: [cmd(45, 'Banner grab', 'nc {{TARGET}} 3389')] },
    { id: 46, shortId: 'TL-046', name: 'nmap', commands: [cmd(47, 'RDP scripts', 'nmap --script rdp-* {{TARGET}}', 'discover')] },
  ] })))
  setup()
  await tree().findByRole('button', { name: 'RDP checks' })
  expect(within(techRow('RDP checks')).getByRole('button', { name: 'Copy RDP scripts' })).toBeTruthy()
  expect(within(techRow('RDP checks')).queryByRole('button', { name: 'Copy Banner grab' })).toBeNull()
})

test('badges', async () => {
  const use = (id: number, techniqueId: number, stepId: number) => ({ id, techniqueId, stepId, toolIds: null })
  const t1 = { ...fixture.phases[0].techniques[0], uses: [use(1, 1, 12)] }
  const t3 = { ...fixture.phases[0].techniques[1], uses: [use(2, 3, 11)] }
  const t4 = tech({ name: 'Live elsewhere', uses: [use(3, 4, 12)] })
  serve({ phases: [{ phase: 'Recon', techniques: [t1, t3] }, fixture.phases[1]] })
  const steps = [{ ...box.steps[0] }, { ...box.steps[1], dead: true }]
  setup({ item: { ...box, steps } as BoxDetail, currentStepId: 11 })
  await tree().findByRole('button', { name: 'Port and service scanning' })
  expect(within(techRow('Port and service scanning')).getByText('tried · dead end')).toBeTruthy()
  expect(within(techRow('Web enumeration')).getByText('used · here')).toBeTruthy()
  expect(within(techRow('SeBackupPrivilege abuse')).getByRole('button', { name: 'Mark used: SeBackupPrivilege abuse' })).toBeTruthy()
  cleanup()
  serve({ phases: [{ phase: 'Recon', techniques: [t4] }] })
  setup({ currentStepId: 11 }) // step 12 is live here
  expect(within((await screen.findByRole('button', { name: 'Live elsewhere' })).closest('.tb-row') as HTMLElement).getByText('used · PrivEsc')).toBeTruthy()
})

test('hides what cannot apply, and show reveals it', async () => {
  serve(recon(tech({ applies: 'windows' })))
  const { user } = setup()
  await tree().findByRole('button', { name: 'Port and service scanning' })
  expect(screen.queryByRole('button', { name: 'RDP checks' })).toBeNull()
  expect(within(shelf('any service')).getByText('+1 hidden: RDP checks')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'show' }))
  expect(screen.getByRole('button', { name: 'RDP checks' })).toBeTruthy()
  expect(screen.queryByText(/hidden:/)).toBeNull()
})

test('linux hides on a Windows box', async () => {
  serve(recon(tech({ name: 'SUID hunt', applies: 'linux' })))
  setup({ item: { ...box, os: 'Windows Server 2019' } as BoxDetail })
  expect(await screen.findByText('+1 hidden: SUID hunt')).toBeTruthy()
})

test('an unknown OS hides nothing', async () => {
  serve(recon(tech({ applies: 'windows' }), tech({ id: 5, name: 'SUID hunt', applies: 'linux' })))
  setup({ item: { ...box, os: '' } as BoxDetail })
  expect(await tree().findByRole('button', { name: 'RDP checks' })).toBeTruthy()
  expect(tree().getByRole('button', { name: 'SUID hunt' })).toBeTruthy()
})

test('ad hides without the tag', async () => {
  serve(recon(tech({ name: 'Kerberoasting', applies: 'ad' })))
  setup()
  expect(await screen.findByText('+1 hidden: Kerberoasting')).toBeTruthy()
  cleanup()
  setup({ item: { ...box, tags: [AD_TAG] } as BoxDetail })
  expect(await tree().findByRole('button', { name: 'Kerberoasting' })).toBeTruthy()
})

test('a used technique is never hidden', async () => {
  serve(recon(tech({ applies: 'windows', uses: [{ id: 5, techniqueId: 4, stepId: 11, toolIds: null }] })))
  setup()
  expect(await screen.findByRole('button', { name: 'RDP checks' })).toBeTruthy()
  expect(screen.queryByText(/hidden:/)).toBeNull()
})

test('search shows everything', async () => {
  serve(recon(tech({ applies: 'windows' })))
  const { user } = setup()
  await screen.findByText('+1 hidden: RDP checks')
  await user.type(screen.getByPlaceholderText('Find a technique, tool or command'), 'rdp')
  expect(screen.getByRole('button', { name: 'RDP checks' })).toBeTruthy()
})

test('+ add reveals the input without toggling the shelf', async () => {
  const { user } = setup({ currentStepId: 11 })
  const add = await tree().findByRole('button', { name: 'Add a technique to smb' })
  const smb = add.closest('details') as HTMLDetailsElement
  expect(smb.open).toBe(true)
  expect(screen.queryByLabelText('New technique in smb')).toBeNull()
  // jsdom never toggles <details> from a click, so pin the handler itself: a cancelled click returns false,
  // and a stopped one never bubbles past React's root (a listener on <summary> runs before React's delegated handler).
  const above = vi.fn()
  document.addEventListener('click', above)
  try {
    expect(fireEvent.click(add)).toBe(false)
    expect(above).not.toHaveBeenCalled()
  } finally { document.removeEventListener('click', above) }
  expect(document.activeElement).toBe(screen.getByLabelText('New technique in smb'))
  expect(smb.open).toBe(true)
})

test('Mark used appends to Tried', async () => {
  const { user, onChanged } = setup({ currentStepId: 11 })
  await user.click(await tree().findByRole('button', { name: 'Mark used: Port and service scanning' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  const urls = fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').map(([u]) => u)
  expect(urls).toEqual(['/api/technique-uses', '/api/steps/11/tried'])
  expect(posts('/api/steps/11/tried')).toEqual([{ name: 'nmap' }])
  await user.click(tree().getByRole('button', { name: 'Mark used: Web enumeration' }))
  await waitFor(() => expect(posts('/api/steps/11/tried')).toEqual([{ name: 'nmap' }, { name: 'Web enumeration' }]))
})

test('a failed Tried append keeps its error after the reload', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/toolbox?boxId=7' ? json(200, fixture) : url === '/api/steps/11/tried' ? json(500, { error: 'tried failed' }) : json(200, { target: '', lhost: '', lport: '', activeBoxId: 7 }))
  const { user, onChanged } = setup({ currentStepId: 11 })
  await user.click(await tree().findByRole('button', { name: 'Mark used: Port and service scanning' }))
  expect((await screen.findByRole('alert')).textContent).toBe('tried failed')
  await new Promise((r) => setTimeout(r, 50)) // let the reload land
  expect(fetchMock.mock.calls.filter(([u]) => u === '/api/toolbox?boxId=7').length).toBe(2)
  expect(screen.getByRole('alert').textContent).toBe('tried failed')
  expect(onChanged).not.toHaveBeenCalled()
})

test('search opens rows so a matching tool command shows', async () => {
  const c = (id: number, purpose: string) => cmd(id, purpose, `xfreerdp /v:${id}`)
  serve(recon(tech({ commands: [c(40, 'Connect')], tools: [{ id: 41, shortId: 'TL-041', name: 'nxc', commands: [c(42, 'Check NLA')] }] })))
  const { user } = setup()
  await tree().findByRole('button', { name: 'RDP checks' })
  expect(screen.queryByRole('button', { name: 'Copy Check NLA' })).toBeNull()
  await user.type(screen.getByPlaceholderText('Find a technique, tool or command'), 'nla')
  expect(screen.getByRole('button', { name: 'Copy Check NLA' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'RDP checks' }).getAttribute('aria-expanded')).toBe('true')
})

test('the add input closes after a successful add and on Escape; with no current step it files under Recon', async () => {
  const { user, onChanged } = setup({ currentStepId: null })
  await user.click(await tree().findByRole('button', { name: 'Add a technique to any service' }))
  await user.type(screen.getByLabelText('New technique in any service'), 'Vhost fuzzing{Enter}')
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(posts('/api/techniques')).toEqual([{ name: 'Vhost fuzzing', phase: 'Recon', service: 'any' }])
  expect(screen.queryByLabelText('New technique in any service')).toBeNull()
  await user.click(tree().getByRole('button', { name: 'Add a technique to any service' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByLabelText('New technique in any service')).toBeNull()
})

test('the current step\'s Saw and Tried echo under the services', async () => {
  const steps = [{ ...box.steps[0], saw: 'port 80', tried: 'nmap' }, { ...box.steps[1], saw: 'nothing', tried: 'x' }]
  setup({ item: { ...box, steps } as BoxDetail, currentStepId: 11 })
  const line = await screen.findByText('saw: port 80 · tried: nmap')
  expect(line.closest('details')).toBeNull()
  expect(screen.queryByText(/^saw: nothing/)).toBeNull()
})

test('a later good load clears an earlier load error', async () => {
  let fail = true
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/toolbox?boxId=7' ? (fail ? json(500, { error: 'db locked' }) : json(200, fixture)) : json(200, { target: '', lhost: '', lport: '', activeBoxId: 7 }))
  const { rerender } = setup()
  expect(await screen.findByText('db locked')).toBeTruthy()
  fail = false
  rerender({ item: { ...box, status: 'user_flag' } as BoxDetail }) // a status change reloads the toolbox
  await waitFor(() => expect(screen.queryByText('db locked')).toBeNull())
  expect(tree().getByText('Port and service scanning')).toBeTruthy()
})

test('a repeated phase numbers its steps in position order', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/toolbox?boxId=7' ? json(200, withUse) : url === '/api/context' ? json(200, { target: '', lhost: '', lport: '', activeBoxId: 7 }) : json(200, {}))
  const twice = { ...box, steps: [...box.steps, { id: 13, boxId: 7, phase: 'PrivEsc', position: 0, body: '', seconds: 0, timerStartedAt: null, done: false, saw: '', think: '', tried: '', got: '', dead: false }] } as BoxDetail
  const { user } = setup({ item: twice, currentStepId: 11 })
  expect(await screen.findByText('used · PrivEsc 2')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'SeBackupPrivilege abuse' }))
  expect(screen.getAllByRole('option', { name: 'PrivEsc 1' }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('option', { name: 'Recon' }).length).toBeGreaterThan(0)
})

test('lists dead ends with links to their steps', async () => {
  const mk = (id: number, position: number, o: object) => ({ id, boxId: 7, phase: 'PrivEsc', position, body: '', seconds: 0, timerStartedAt: null, done: false, saw: '', think: '', tried: '', got: '', dead: false, ...o })
  const item = { ...box, steps: [box.steps[0], mk(13, 3, { dead: true, tried: 'defaults' }), mk(12, 2, { dead: true, saw: 'login page' })] } as unknown as BoxDetail
  setup({ item })
  const region = await screen.findByRole('region', { name: 'Dead ends' })
  const links = within(region).getAllByRole('link')
  expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['PrivEsc 1 — login page', '#/boxes/7?step=12'],
    ['PrivEsc 2 — defaults', '#/boxes/7?step=13'],
  ])
})

test('no Dead ends region without dead steps', async () => {
  setup()
  await screen.findByPlaceholderText('One per line: what you still want to pull on')
  expect(screen.queryByRole('region', { name: 'Dead ends' })).toBeNull()
})

test('shelves follow box services then any, shell, other', async () => {
  const [http, smb, ssh] = box.services
  setup({ item: { ...box, services: [ssh, http, smb] } as BoxDetail })
  await tree().findByText('Port and service scanning')
  expect(shelfTitles()).toEqual(['ssh', 'http', 'smb', 'any service', 'after a shell', 'other services'])
  expect(within(shelf('http')).getByText(':80')).toBeTruthy()
  expect(within(shelf('http')).getByText('Web enumeration')).toBeTruthy()
  expect(within(shelf('smb')).getByText('SMB shares')).toBeTruthy()
  expect(within(shelf('after a shell')).getByText('SeBackupPrivilege abuse')).toBeTruthy()
  expect(shelf('http').open).toBe(true)
  const other = shelf('other services')
  expect(other.open).toBe(false)
  expect(within(other).getByText('LDAP dump')).toBeTruthy()
})

test('next up lists five unlocked unused techniques in order and skips shell ones', async () => {
  serve(recon(
    tech({ id: 20, name: 'Done already', uses: [{ id: 9, techniqueId: 20, stepId: 11, toolIds: null }] }),
    tech({ id: 21, name: 'Vhost fuzzing', service: 'http' }),
    tech({ id: 22, name: 'Banner grab' }),
    tech({ id: 23, name: 'Default creds' }),
    tech({ id: 24, name: 'Shell trick', service: 'shell' }),
  ))
  setup({ item: { ...box, haves: ['web app'] } as BoxDetail })
  await tree().findByText('Port and service scanning')
  expect(nextUpNames()).toEqual(['Web enumeration', 'Vhost fuzzing', 'SMB shares', 'Port and service scanning', 'Banner grab'])
})

test('locked rows say what they need and still offer Mark used', async () => {
  serve(recon(tech({ name: 'Password spraying', service: 'smb', needs: ['creds'] })))
  setup()
  await tree().findByRole('button', { name: 'Password spraying' })
  const r = techRow('Password spraying')
  expect(within(r).getByText('needs creds')).toBeTruthy()
  expect(within(r).getByRole('button', { name: 'Mark used: Password spraying' })).toBeTruthy()
  expect(within(shelf('smb')).getByText('0 of 2 used · 1 locked')).toBeTruthy()
  // filed under after a shell, so it needs one even with an empty needs list
  expect(within(techRow('SeBackupPrivilege abuse')).getByText('needs shell')).toBeTruthy()
  expect(nextUpNames()).toEqual(['SMB shares', 'Port and service scanning'])
})

test('status implies haves', async () => {
  const { user, onChanged } = setup({ item: { ...box, status: 'rooted' } as BoxDetail })
  const haves = await screen.findByRole('group', { name: 'You have' })
  for (const h of ['shell', 'admin']) {
    const b = within(haves).getByRole('button', { name: h }) as HTMLButtonElement
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('from status')
  }
  await tree().findByText('SeBackupPrivilege abuse')
  expect(within(techRow('SeBackupPrivilege abuse')).queryByText(/^needs/)).toBeNull()
  expect(nextUpNames()).toContain('SeBackupPrivilege abuse')
  const creds = within(haves).getByRole('button', { name: 'creds' })
  expect(creds.getAttribute('aria-pressed')).toBe('false')
  await user.click(creds)
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(patches()).toEqual([{ haves: ['creds'] }])
})

test('no services: hint and all shelves', async () => {
  setup({ item: { ...box, services: [] } as BoxDetail })
  await tree().findByText('Port and service scanning')
  expect(screen.getByText('Add the services you found to get a Next up list.')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Next up' })).toBeNull()
  expect(shelfTitles()).toEqual(['any service', 'after a shell', 'other services'])
  expect(within(shelf('other services')).getByText('Web enumeration')).toBeTruthy()
})

test('a user flag implies a shell only', async () => {
  setup({ item: { ...box, status: 'user_flag' } as BoxDetail })
  const haves = await screen.findByRole('group', { name: 'You have' })
  const shell = within(haves).getByRole('button', { name: 'shell' }) as HTMLButtonElement
  expect(shell.getAttribute('aria-pressed')).toBe('true')
  expect(shell.disabled).toBe(true)
  expect(shell.title).toBe('from status')
  expect(within(haves).getByRole('button', { name: 'admin' }).getAttribute('aria-pressed')).toBe('false')
  await tree().findByText('SeBackupPrivilege abuse')
  expect(within(techRow('SeBackupPrivilege abuse')).queryByText(/^needs/)).toBeNull()
})

test('a hand-closed shelf opens when a search matches in it', async () => {
  const { user } = setup()
  await tree().findByText('Port and service scanning')
  shelf('any service').open = false // what a click on its summary does in a browser; jsdom doesn't toggle
  await user.type(screen.getByPlaceholderText('Find a technique, tool or command'), 'port and')
  expect(shelf('any service').open).toBe(true)
})

test('the locked count leaves out hidden rows', async () => {
  serve(recon(tech({ name: 'Kerberoasting', applies: 'ad', needs: ['creds'] })))
  setup()
  await screen.findByText('+1 hidden: Kerberoasting')
  expect(within(shelf('any service')).getByText('0 of 2 used')).toBeTruthy()
})

test('a used row that cannot apply and is locked stays on its shelf with its badge', async () => {
  serve(recon(tech({ name: 'IIS shortnames', service: 'http', applies: 'windows', needs: ['creds'], uses: [{ id: 5, techniqueId: 4, stepId: 11, toolIds: null }] })))
  setup()
  await tree().findByText('IIS shortnames')
  expect(within(shelf('http')).getByText('IIS shortnames')).toBeTruthy()
  expect(within(techRow('IIS shortnames')).getByText('used · Recon')).toBeTruthy()
  expect(screen.queryByText(/hidden:/)).toBeNull()
})

test('used rows stay on their shelf', async () => {
  serve(recon(tech({ name: 'IIS shortnames', service: 'http', applies: 'windows', uses: [{ id: 5, techniqueId: 4, stepId: 11, toolIds: null }] })))
  setup()
  await tree().findByText('IIS shortnames')
  expect(within(techRow('IIS shortnames')).getByText('used · Recon')).toBeTruthy()
  expect(within(shelf('http')).getByText('IIS shortnames')).toBeTruthy()
  expect(screen.queryByText(/hidden:/)).toBeNull()
})

test('services chips add and remove', async () => {
  const { user, onChanged } = setup()
  const list = await screen.findByRole('list', { name: 'Services' })
  expect(within(list).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual(['http :80', 'smb :445', 'ssh :22'])
  await user.click(screen.getByRole('button', { name: '+ service' }))
  await user.type(screen.getByLabelText('Service name'), 'FTP')
  await user.type(screen.getByLabelText('Port'), '21{Enter}')
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(screen.queryByLabelText('Service name')).toBeNull()
  await user.click(within(list).getByRole('button', { name: 'Remove http :80' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
  expect(patches()).toEqual([
    { services: [...box.services, { name: 'ftp', port: 21 }] },
    { services: [box.services[1], box.services[2]] },
  ])
})

test('add from Saw offers services the box lacks', async () => {
  const steps = [{ ...box.steps[0], saw: '21 ftp · 80 http' }, box.steps[1]]
  const { user, onChanged } = setup({ item: { ...box, steps } as BoxDetail })
  const add = await screen.findByRole('button', { name: 'Add ftp :21' })
  expect(screen.queryByRole('button', { name: 'Add http :80' })).toBeNull()
  await user.click(add)
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(patches()).toEqual([{ services: [...box.services, { name: 'ftp', port: 21 }] }])
})

test('add from Saw drops a bare name another step gave a port', async () => {
  const steps = [{ ...box.steps[0], saw: '80 http' }, { ...box.steps[1], saw: 'a login page on http' }]
  setup({ item: { ...box, services: [box.services[1]], steps } as BoxDetail })
  expect(await screen.findByRole('button', { name: 'Add http :80' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Add http' })).toBeNull()
})
