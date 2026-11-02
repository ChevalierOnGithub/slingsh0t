// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkItem } from '../../../shared/types'
import { md } from '../box/StepSection'
import { Report, slug } from './Report'

vi.mock('../box/Editor', () => ({ Editor: () => null }))
vi.mock('../shell/TargetBar', () => ({
  useTargetContext: () => ({ ctx: { target: '', lhost: '', lport: '', activeBoxId: null }, update: vi.fn(), error: null }),
}))

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const box = {
  id: 1, kind: 'box', shortId: 'H-0001', name: 'Lame', os: 'Linux', status: 'rooted', tags: [], nextStep: '', notes: '',
  foothold: '', privesc: '', rating: '', dns: '', url: '', targetIp: null, steps: [], uses: [], services: [], haves: [],
} as WorkItem
const report = { frontmatter: 'title: "Lame"', markdown: '# Lame\n\ntext' }

let fetchMock: ReturnType<typeof vi.fn>
let blobs: Blob[]
let clicked: HTMLAnchorElement[]
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'PATCH' ? box : report))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true })
  blobs = []
  URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:x'))
  URL.revokeObjectURL = vi.fn()
  clicked = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
})
const scrollIntoView = Element.prototype.scrollIntoView
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); Element.prototype.scrollIntoView = scrollIntoView; location.hash = '' })

const gets = () => fetchMock.mock.calls.filter(([url, i]) => url === '/api/boxes/1/report' && i?.method === 'GET')

test('shows raw and preview with counts', async () => {
  render(<Report item={box} ownerPath="/api/boxes/1" active />)
  await waitFor(() => expect((screen.getByLabelText('Raw Markdown') as HTMLTextAreaElement).value).toBe('# Lame\n\ntext'))
  expect(screen.getByRole('heading', { level: 1, name: 'Lame' })).toBeTruthy()
  expect(screen.getByText('12 chars · 3 lines')).toBeTruthy()
})

test('does not fetch until active', async () => {
  const { rerender } = render(<Report item={box} ownerPath="/api/boxes/1" active={false} />)
  expect(fetchMock).not.toHaveBeenCalled()
  rerender(<Report item={box} ownerPath="/api/boxes/1" active />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
})

test('saving a summary field refetches', async () => {
  render(<Report item={box} ownerPath="/api/boxes/1" active />)
  await waitFor(() => expect(gets()).toHaveLength(1))
  await userEvent.type(screen.getByLabelText('Foothold'), 'anon FTP')
  await userEvent.tab()
  const patches = () => fetchMock.mock.calls.filter(([url, i]) => url === '/api/boxes/1' && i?.method === 'PATCH')
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(JSON.parse(patches()[0][1]!.body as string)).toEqual({ foothold: 'anon FTP' })
  await waitFor(() => expect(gets()).toHaveLength(2))
})

test('copy writes the fenced document', async () => {
  render(<Report item={box} ownerPath="/api/boxes/1" active />)
  await screen.findByText('12 chars · 3 lines')
  await userEvent.click(screen.getByRole('button', { name: 'Copy raw' }))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('---\ntitle: "Lame"\n---\n\n# Lame\n\ntext')
  expect(await screen.findByText('Copied')).toBeTruthy()
})

test('export md names the file and starts with ---', async () => {
  render(<Report item={box} ownerPath="/api/boxes/1" active />)
  await screen.findByText('12 chars · 3 lines')
  await userEvent.click(screen.getByRole('button', { name: 'Export .md' }))
  expect(clicked[0].download).toBe('H-0001-lame.md')
  expect(blobs[0].type).toBe('text/markdown')
  expect((await blobs[0].text()).startsWith('---\n')).toBe(true)
})

test('export html is self-contained', async () => {
  render(<Report item={box} ownerPath="/api/boxes/1" active />)
  await screen.findByText('12 chars · 3 lines')
  await userEvent.click(screen.getByRole('button', { name: 'Export HTML' }))
  expect(clicked[0].download).toBe('H-0001-lame.html')
  const html = await blobs[0].text()
  for (const s of ['<!doctype html>', '<title>Lame</title>', '--ground: #0b1017', '<h1 id="lame">Lame</h1>', "default-src 'none'; img-src data:; style-src 'unsafe-inline'"]) expect(html).toContain(s)
  expect(html.slice(0, html.indexOf('</head>'))).not.toContain('https://')
})

test('export html drops the Copy buttons but the preview keeps them', async () => {
  fetchMock.mockImplementation(async () => json({ frontmatter: '', markdown: '```\nid\n```' }))
  render(<Report item={box} ownerPath="/api/boxes/1" active />)
  await screen.findByRole('button', { name: 'Copy code block' })
  await userEvent.click(screen.getByRole('button', { name: 'Export HTML' }))
  const html = await blobs[0].text()
  expect(html).toContain('<pre>')
  expect(html).not.toContain('copycode')
})

test('typing in a summary field does not re-render the markdown preview', async () => {
  render(<Report item={box} ownerPath="/api/boxes/1" active />)
  await screen.findByText('12 chars · 3 lines')
  const spy = vi.spyOn(md, 'render')
  await userEvent.type(screen.getByLabelText('Foothold'), 'abc')
  expect(spy).not.toHaveBeenCalled()
})

test('slug', () => {
  expect(slug('Re: "Lame" 2!')).toBe('re-lame-2')
})

test('summary={false} hides the summary fields', async () => {
  render(<Report item={box} ownerPath="/api/boxes/1" summary={false} active />)
  await screen.findByText('12 chars · 3 lines')
  expect(screen.queryByLabelText('Foothold')).toBeNull()
})

test('an in-page anchor in the preview scrolls instead of changing the hash', async () => {
  fetchMock.mockImplementation(async () => json({ frontmatter: '', markdown: '## Machines\n\n[Back to Machines](#machines)' }))
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  location.hash = '#/writeups/network/3'
  render(<Report item={box} ownerPath="/api/networks/3" summary={false} active />)
  await userEvent.click(await screen.findByRole('link', { name: 'Back to Machines' }))
  expect(location.hash).toBe('#/writeups/network/3')
  expect(scroll).toHaveBeenCalledTimes(1)
  expect(scroll.mock.contexts[0]).toBe(document.querySelector('.md h2#machines'))
})
