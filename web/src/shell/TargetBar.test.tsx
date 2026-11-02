// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextProvider, TargetBar } from './TargetBar'

const meta = document.createElement('meta')
meta.name = 'slingsh0t-token'
meta.content = 'tok123'
document.head.append(meta)

let ctx: Record<string, unknown>
let fetchMock: ReturnType<typeof vi.fn>
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  ctx = { target: '', lhost: '10.10.14.7', lport: '4444', activeBoxId: null, activeHostId: null, via: null }
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/boxes') return json(200, [{ id: 3, name: 'Cicada', targetIp: '10.10.11.5' }])
    if (url === '/api/networks') return json(200, [{ id: 1, name: 'Dante' }])
    if (url === '/api/networks/1') return json(200, { id: 1, name: 'Dante', hosts: [
      { id: 5, name: 'DC01', ips: [{ id: 1, ip: '10.10.110.5', primary: true }, { id: 2, ip: '172.16.1.20', primary: false }] }] })
    if (init?.method === 'PUT') {
      const patch = JSON.parse(init.body as string)
      if (patch.activeBoxId === 3) Object.assign(patch, { target: '10.10.11.5', activeHostId: null, via: null }) // server fills target from the box
      if (patch.activeHostId === 5) Object.assign(patch, { target: '10.10.110.5', activeBoxId: null })
      if (patch.activeHostId === null && !('activeBoxId' in patch)) patch.target = ''
      // the pivot subnet is 172.16.1.0/24
      if ('target' in patch) patch.via = patch.target.startsWith('172.16.1.') ? 'via ligolo-ng through NIX01' : null
      if (patch.lport === '70000') return json(400, { error: 'LPORT must be 1-65535' })
      ctx = { ...ctx, ...patch }
    }
    return json(200, ctx)
  })
  vi.stubGlobal('fetch', fetchMock)
})

const setup = () =>
  render(
    <ContextProvider>
      <TargetBar />
    </ContextProvider>,
  )

test('renders saved LHOST and disables TARGET without an active box', async () => {
  setup()
  expect(await screen.findByDisplayValue('10.10.14.7')).toBeTruthy()
  const target = screen.getByLabelText('TARGET') as HTMLInputElement
  expect(target.disabled).toBe(true)
  expect(target.title).toBe('Pick a box or host first')
})

test('invalid LPORT shows server message, keeps typed value, sends token', async () => {
  setup()
  const lport = (await screen.findByDisplayValue('4444')) as HTMLInputElement
  await userEvent.clear(lport)
  await userEvent.type(lport, '70000')
  await userEvent.tab()
  expect(await screen.findByText('LPORT must be 1-65535')).toBeTruthy()
  expect(lport.value).toBe('70000')
  const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!
  expect((put[1].headers as Record<string, string>)['x-slingsh0t-token']).toBe('tok123')
  await waitFor(() => expect(JSON.parse(put[1].body)).toEqual({ lport: '70000' }))
})

test('picking a box sends only activeBoxId and shows the returned target', async () => {
  setup()
  await userEvent.selectOptions(await screen.findByLabelText('Working on'), 'Cicada')
  expect(await screen.findByDisplayValue('10.10.11.5')).toBeTruthy()
  const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!
  expect(put[1].body).toBe(JSON.stringify({ activeBoxId: 3 }))
})

test('picking a host sends only activeHostId; TARGET lists its IPs and the bar shows via', async () => {
  setup()
  const puts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT').map(([, i]) => i.body)
  await screen.findByRole('option', { name: 'DC01' })
  expect(screen.getByRole('group', { name: 'Dante' })).toBeTruthy()
  await userEvent.selectOptions(screen.getByLabelText('Working on'), 'DC01')
  const target = (await screen.findByRole('combobox', { name: 'TARGET' })) as HTMLSelectElement
  await waitFor(() => expect(target.value).toBe('10.10.110.5'))
  expect([...target.options].map((o) => o.value)).toEqual(['10.10.110.5', '172.16.1.20'])
  expect(screen.queryByText(/via/)).toBeNull()

  await userEvent.selectOptions(target, '172.16.1.20')
  expect(await screen.findByText('via ligolo-ng through NIX01')).toBeTruthy()
  await userEvent.selectOptions(screen.getByLabelText('Working on'), 'none')
  expect(puts()).toEqual([JSON.stringify({ activeHostId: 5 }), JSON.stringify({ target: '172.16.1.20' }), JSON.stringify({ activeHostId: null })])
})

test('a network that fails to load drops out; the active host keeps its option and TARGET is described by via', async () => {
  ctx = { ...ctx, target: '10.9.9.9', activeHostId: 9, via: 'via ssh through WEB01' }
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/networks' ? json(200, [{ id: 1, name: 'Dante' }, { id: 2, name: 'Zephyr' }])
      : url === '/api/networks/2' ? json(500, { error: 'boom' })
      : base(url, init))
  setup()
  await screen.findByRole('option', { name: 'DC01' })
  const picker = screen.getByLabelText('Working on') as HTMLSelectElement
  expect(picker.value).toBe('h:9')
  expect(picker.selectedOptions[0].textContent).toBe('Active host')
  const target = screen.getByRole('combobox', { name: 'TARGET' }) as HTMLSelectElement
  expect(target.value).toBe('10.9.9.9')
  expect(document.getElementById(target.getAttribute('aria-describedby')!)!.textContent).toBe('via ssh through WEB01')
})

test('slingsh0t:stats re-reads the context: a new pivot shows via, a deleted active host clears the bar', async () => {
  ctx = { ...ctx, target: '172.16.1.20', activeHostId: 5 }
  setup()
  const target = (await screen.findByRole('combobox', { name: 'TARGET' })) as HTMLSelectElement
  await waitFor(() => expect(target.value).toBe('172.16.1.20'))
  expect(screen.queryByText(/via/)).toBeNull()

  ctx = { ...ctx, via: 'via ligolo-ng through NIX01' } // a pivot was added on the Network page
  dispatchEvent(new Event('slingsh0t:stats'))
  expect(await screen.findByText('via ligolo-ng through NIX01')).toBeTruthy()

  ctx = { ...ctx, target: '', activeHostId: null, via: null } // the active host was deleted
  dispatchEvent(new Event('slingsh0t:stats'))
  await waitFor(() => expect((screen.getByLabelText('Working on') as HTMLSelectElement).value).toBe(''))
  expect((screen.getByLabelText('TARGET') as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByText(/via/)).toBeNull()
})

test('a context GET that lands after a newer PUT is ignored', async () => {
  let release!: () => void
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
  setup()
  await screen.findByRole('option', { name: 'Cicada' })
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/context' && !init?.method?.match(/PUT/) && !release) {
      const stale = json(200, { ...ctx }) // snapshot before the PUT
      await new Promise<void>((r) => (release = r))
      return stale
    }
    return base(url, init)
  })
  dispatchEvent(new Event('slingsh0t:stats'))
  await waitFor(() => expect(release).toBeDefined())
  await userEvent.selectOptions(screen.getByLabelText('Working on'), 'Cicada')
  expect(await screen.findByDisplayValue('10.10.11.5')).toBeTruthy()
  release()
  await new Promise((r) => setTimeout(r, 20))
  expect(screen.getByDisplayValue('10.10.11.5')).toBeTruthy()
})

const puts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT').map(([, i]) => JSON.parse(i.body))

test('Enter saves once (no second PUT from the blur that follows)', async () => {
  setup()
  const lhost = (await screen.findByDisplayValue('10.10.14.7')) as HTMLInputElement
  await userEvent.clear(lhost)
  await userEvent.type(lhost, '10.10.14.9{Enter}')
  expect(document.activeElement).not.toBe(lhost) // Enter leaves the field: its blur is the one save
  await waitFor(() => expect(puts()).toEqual([{ lhost: '10.10.14.9' }]))
})

test('a context reload keeps what is being typed in a field', async () => {
  setup()
  const lport = (await screen.findByDisplayValue('4444')) as HTMLInputElement
  await userEvent.clear(lport)
  await userEvent.type(lport, '9001')
  ctx = { ...ctx, lhost: '10.10.14.99' }
  dispatchEvent(new Event('slingsh0t:stats'))
  expect(await screen.findByDisplayValue('10.10.14.99')).toBeTruthy()
  expect(lport.value).toBe('9001')
})

test('a failed pick shows its error next to Working on, not under a field', async () => {
  setup()
  const working = await screen.findByLabelText('Working on')
  fetchMock.mockImplementationOnce(async () => json(400, { error: 'unknown box' }))
  await userEvent.selectOptions(working, 'Cicada')
  const err = await screen.findByText('unknown box')
  expect(working.parentElement!.contains(err)).toBe(true)
})

test('does not refetch boxes on navigation, but does on slingsh0t:stats', async () => {
  setup()
  await screen.findByRole('option', { name: 'Cicada' })
  const boxCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/boxes').length
  const before = boxCalls()
  dispatchEvent(new HashChangeEvent('hashchange'))
  await new Promise((r) => setTimeout(r, 20))
  expect(boxCalls()).toBe(before)
  dispatchEvent(new Event('slingsh0t:stats'))
  await waitFor(() => expect(boxCalls()).toBe(before + 1))
})

test('a box added elsewhere (CLI import, another tab) reaches the picker when the window is focused', async () => {
  setup()
  await screen.findByRole('option', { name: 'Cicada' })
  const usual = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/boxes' ? json(200, [{ id: 3, name: 'Cicada', targetIp: '10.10.11.5' }, { id: 4, name: 'Imported', targetIp: null }]) : usual(url, init))
  dispatchEvent(new Event('focus'))
  expect(await screen.findByRole('option', { name: 'Imported' })).toBeTruthy()
})
