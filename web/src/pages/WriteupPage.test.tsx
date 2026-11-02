// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WriteupPage } from './WriteupPage'

vi.mock('../box/Editor', () => ({ Editor: () => null }))
vi.mock('../shell/TargetBar', () => ({ useTargetContext: () => ({ ctx: { target: '', lhost: '', lport: '', activeBoxId: null, activeHostId: null, via: null } }) }))
afterEach(() => { vi.unstubAllGlobals() })

const box = { id: 4, kind: 'box', shortId: 'H-0004', name: 'Lame', os: 'Linux', status: 'rooted', tags: [], nextStep: '', notes: '', targetIp: null, steps: [], uses: [], services: [], haves: [], foothold: '', privesc: '', rating: '' }

test('shows the box report with a link back to the box', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/report') ? { frontmatter: 'title: "Lame"', markdown: '# Lame\n\ntext' } : box))))
  render(<WriteupPage kind="box" id={4} />)
  expect(await screen.findByRole('heading', { level: 1, name: /Lame/ })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to box' }).getAttribute('href')).toBe('#/boxes/4')
  expect(((await screen.findByLabelText('Raw Markdown')) as HTMLTextAreaElement).value).toBe('# Lame\n\ntext')
})

test('network variant fetches the network and links back to it', async () => {
  const net = { id: 3, shortId: 'N-0003', name: 'Dante', entry: '' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/report') ? { frontmatter: 'title: "Dante"', markdown: '# Dante\n\ntext' } : net))))
  render(<WriteupPage kind="network" id={3} />)
  expect(await screen.findByRole('heading', { level: 1, name: /Dante/ })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to network' }).getAttribute('href')).toBe('#/networks/3')
  expect(((await screen.findByLabelText('Raw Markdown')) as HTMLTextAreaElement).value).toBe('# Dante\n\ntext')
  expect(screen.queryByLabelText('Foothold')).toBeNull()
  expect((vi.mocked(fetch).mock.calls.map(([u]) => u))).toContain('/api/networks/3/report')
})
