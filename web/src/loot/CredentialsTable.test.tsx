// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Credential } from '../../../shared/types'
import { CredentialsTable } from './CredentialsTable'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const cred = (results: Credential['results']): Credential => ({
  id: 4, username: 'svc_web', kind: 'password', secret: 'Winter2026!', foundOn: { hostId: 7, name: 'DC01' }, foundNote: '',
  scope: { networkId: 2 }, results, untested: 2 - results.length, worksOn: [],
})
const hosts = [{ id: 7, name: 'DC01' }, { id: 8, name: 'WEB01' }]

let fetchMock: ReturnType<typeof vi.fn>
let current: Credential
beforeEach(() => {
  current = cred([])
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const result = JSON.parse(init.body as string).result
      current = cred(result ? [{ hostId: 8, name: 'WEB01', result }] : [])
      return json(current)
    }
    return json(url === '/api/credentials?networkId=2' ? [current] : [])
  })
  vi.stubGlobal('fetch', fetchMock)
})

test('secrets masked until revealed', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(<CredentialsTable scope={{ networkId: 2 }} hosts={hosts} />)
  await screen.findByText('svc_web')
  expect(screen.getByText('••••••')).toBeTruthy()
  expect(document.body.innerHTML).not.toContain('Winter2026!')

  await userEvent.click(screen.getByRole('button', { name: 'Copy secret for svc_web' }))
  expect(writeText).toHaveBeenCalledWith('Winter2026!')
  expect(document.body.innerHTML).not.toContain('Winter2026!')

  await userEvent.click(screen.getByRole('button', { name: 'Reveal secret for svc_web' }))
  expect(screen.getByText('Winter2026!')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Hide secret for svc_web' }))
  expect(document.body.innerHTML).not.toContain('Winter2026!')
})

test('per-host result toggle cycles untested, works, failed and back with the PUT body', async () => {
  render(<CredentialsTable scope={{ networkId: 2 }} hosts={hosts} />)
  const puts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT')
  const toggle = async (name: string) => userEvent.click(await screen.findByRole('button', { name }))

  await toggle('WEB01: untested')
  await toggle('WEB01: works')
  await toggle('WEB01: failed')
  await screen.findByRole('button', { name: 'WEB01: untested' })
  expect(puts().map(([url]) => url)).toEqual(Array(3).fill('/api/credentials/4/results/8'))
  expect(puts().map(([, i]) => JSON.parse(i.body))).toEqual([{ result: 'works' }, { result: 'failed' }, { result: null }])
  expect(screen.getByText('untested 2')).toBeTruthy()
})

test('box scope fetches by boxId and offers no host toggles', async () => {
  render(<CredentialsTable scope={{ boxId: 3 }} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/credentials?boxId=3', expect.anything()))
  expect(screen.queryByRole('button', { name: /untested$/ })).toBeNull()
})

test('adding a credential clears the form and returns focus to its first field', async () => {
  render(<CredentialsTable scope={{ networkId: 2 }} hosts={hosts} />)
  await screen.findByText('svc_web')
  await userEvent.type(screen.getByLabelText('Secret'), 'Spring2026!')
  await userEvent.click(screen.getByRole('button', { name: 'Add credential' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('User')))
  expect((screen.getByLabelText('Secret') as HTMLInputElement).value).toBe('')
})

test('compact (network panel): one list item per credential — user, kind, masked secret with Reveal/Copy, works-on chips, found-on on its own line', async () => {
  current = { ...cred([{ hostId: 8, name: 'WEB01', result: 'works' }]), foundNote: 'web.config' }
  render(<CredentialsTable scope={{ networkId: 2 }} hosts={hosts} compact />)
  const item = (await screen.findByText('svc_web')).closest('li') as HTMLElement
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getAllByRole('listitem').filter((li) => li.parentElement?.classList.contains('credlist'))).toHaveLength(1)
  const line = item.querySelector('.cred-line') as HTMLElement
  expect(line.textContent).toContain('Password')
  expect(within(line).getByText('••••••')).toBeTruthy()
  expect(within(line).getByRole('button', { name: 'Reveal secret for svc_web' })).toBeTruthy()
  expect(within(line).getByRole('button', { name: 'Copy secret for svc_web' })).toBeTruthy()
  expect(within(line).getByRole('button', { name: 'Edit credential svc_web' })).toBeTruthy()
  expect(within(item).getByRole('button', { name: 'WEB01: works' })).toBeTruthy()
  const foundLine = item.querySelector('.cred-found') as HTMLElement
  expect(line.contains(foundLine)).toBe(false)
  expect(foundLine.textContent).toBe('Found on DC01, web.config')
  expect(document.body.innerHTML).not.toContain('Winter2026!')
  await userEvent.click(within(line).getByRole('button', { name: 'Edit credential svc_web' }))
  expect(within(item).getByRole('button', { name: 'Save' })).toBeTruthy()
})

test('compact: a note without a host reads as the note alone', async () => {
  current = { ...cred([]), foundOn: null, foundNote: 'cracked from NTDS' }
  const { container } = render(<CredentialsTable scope={{ networkId: 2 }} hosts={hosts} compact />)
  await screen.findByText('svc_web')
  expect(container.querySelector('.cred-found')!.textContent).toBe('cracked from NTDS')
})

test('Loot page: editing a box credential picks the services it works on', async () => {
  current = { ...cred([]), scope: { boxId: 3 }, untested: 0, worksOn: ['ssh'] }
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => json(init?.method === 'PATCH' ? current : url === '/api/credentials?all=1' ? [{ ...current, scopeName: 'Test', scopeShortId: 'H-0001' }] : []))
  render(<CredentialsTable scope={{ all: true }} />)
  expect(await screen.findByText('ssh')).toBeTruthy() // the row shows its services
  await userEvent.click(screen.getByRole('button', { name: 'Edit credential svc_web' }))
  const group = screen.getByRole('group', { name: 'Works on' })
  expect(within(group).getByRole('button', { name: 'ssh' }).getAttribute('aria-pressed')).toBe('true')
  await userEvent.click(within(group).getByRole('button', { name: 'smb' }))
  await userEvent.click(within(group).getByRole('button', { name: 'ssh' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
  expect(JSON.parse(patch[1].body).worksOn).toEqual(['smb'])
})

test('Loot page: editing a network credential loads its hosts and offers their toggles', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    json(url === '/api/credentials?all=1' ? [{ ...current, scopeName: 'Dante', scopeShortId: 'N-0001' }] : url === '/api/networks/2' ? { hosts: hosts.map((h) => ({ ...h, shortId: '', os: '', status: 'not_started', ips: [] })) } : []))
  render(<CredentialsTable scope={{ all: true }} />)
  await screen.findByText('svc_web')
  expect(screen.queryByRole('button', { name: 'WEB01: untested' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Edit credential svc_web' }))
  expect(await screen.findByRole('button', { name: 'WEB01: untested' })).toBeTruthy()
  expect(screen.queryByRole('group', { name: 'Works on' })).toBeNull() // no service chips for network credentials
})
