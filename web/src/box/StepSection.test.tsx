// @vitest-environment jsdom
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BoxDetail, Step } from '../../../shared/types'
import { StepSection, type Insert } from './StepSection'
import { Writeup } from './Writeup'
import { Notes } from './Notes'

const editorChange = vi.hoisted(() => ({ current: (_v: string) => {} })) // the latest onChange, to call as CodeMirror does
vi.mock('./Editor', () => ({
  Editor: (p: { value: string; onChange(v: string): void; label: string; autoFocus?: boolean }) => {
    editorChange.current = p.onChange
    return <textarea aria-label={p.label} autoFocus={p.autoFocus} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  },
}))
const ctx = vi.hoisted(() => ({ target: '', lhost: '10.10.14.7', lport: '4444', activeBoxId: 1 as number | null }))
vi.mock('../shell/TargetBar', () => ({ useTargetContext: () => ({ ctx, update: vi.fn(), error: null }) }))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const step: Step = { id: 5, boxId: 1, hostId: null, phase: 'Recon', position: 0, body: 'nmap {{TARGET}}', seconds: 0, timerStartedAt: null, done: false, saw: '', think: '', tried: '', got: '', dead: false }
const box = {
  id: 1, kind: 'box', shortId: 'H-0001', platform: 'HTB', name: 'Cicada', os: 'Windows', difficulty: 'Easy', status: 'in_progress',
  targetIp: '10.10.11.35', totalSeconds: 0, releaseDate: null, tags: [], nextStep: '', notes: '', foothold: '', privesc: '', rating: '', dns: '', url: '', startedAt: null, rootedAt: null, steps: [step], uses: [], services: [], haves: [],
} as BoxDetail

let fetchMock: ReturnType<typeof vi.fn>
let patchStatus = 200
beforeEach(() => {
  Object.assign(ctx, { target: '10.10.11.35', activeBoxId: 1 })
  patchStatus = 200
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? json(patchStatus, patchStatus === 200 ? { ...step, ...JSON.parse(init.body as string) } : { error: 'boom' }) : json(200, box),
  )
  vi.stubGlobal('fetch', fetchMock)
})

const setup = (insert: Insert | null = null, onInserted = vi.fn()) =>
  render(<StepSection step={step} item={box} mode="live" ordinal={1} insert={insert} onInserted={onInserted} onUp={null} onDown={null} reload={vi.fn()} />)
const patches = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH')

test('preview substitutes placeholders; the saved body stays raw', async () => {
  setup()
  await userEvent.click(screen.getByText('nmap 10.10.11.35'))
  const editor = screen.getByLabelText('Recon 1 writeup') as HTMLTextAreaElement
  expect(editor.value).toBe('nmap {{TARGET}}')
  await userEvent.type(editor, ' -p-')
  await waitFor(() => expect(patches()).toHaveLength(1))
  const [url, init] = patches()[0]
  expect(url).toBe('/api/steps/5')
  expect(JSON.parse(init.body)).toEqual({ body: 'nmap {{TARGET}} -p-' })
  expect(await screen.findByText('Saved')).toBeTruthy()
})

test('Done ticks the step via PATCH; a done step collapses to its header', async () => {
  setup()
  await userEvent.click(screen.getByLabelText('Recon 1 done'))
  const [url, init] = patches()[0]
  expect(url).toBe('/api/steps/5')
  expect(JSON.parse(init.body)).toEqual({ done: true })
  cleanup()
  render(<StepSection step={{ ...step, done: true }} item={box} mode="live" ordinal={1} insert={null} onInserted={vi.fn()} onUp={null} onDown={null} reload={vi.fn()} />)
  expect((screen.getByLabelText('Recon 1 done') as HTMLInputElement).checked).toBe(true)
  expect(screen.queryByText('nmap 10.10.11.35')).toBeNull()
  // the header toggle opens a done step for reading, and closes it again
  await userEvent.click(screen.getByRole('button', { name: 'Expand Recon 1' }))
  expect(screen.getByText('nmap 10.10.11.35')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Collapse Recon 1' }))
  expect(screen.queryByText('nmap 10.10.11.35')).toBeNull()
})

test('the header toggle collapses an open step without changing it', async () => {
  render(<StepSection step={step} item={box} mode="live" ordinal={1} insert={null} onInserted={vi.fn()} onUp={null} onDown={null} reload={vi.fn()} />)
  expect(screen.getByText('nmap 10.10.11.35')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Collapse Recon 1' }))
  expect(screen.queryByText('nmap 10.10.11.35')).toBeNull()
  expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false)
})

test('keeps text and shows Not saved when save fails', async () => {
  patchStatus = 500
  setup()
  await userEvent.click(screen.getByText('nmap 10.10.11.35'))
  const editor = screen.getByLabelText('Recon 1 writeup') as HTMLTextAreaElement
  await userEvent.type(editor, ' -sV')
  expect(await screen.findByText('Not saved', {})).toBeTruthy()
  expect((screen.getByLabelText('Recon 1 writeup') as HTMLTextAreaElement).value).toBe('nmap {{TARGET}} -sV')
  patchStatus = 200
  await userEvent.type(editor, ' -sC')
  expect(await screen.findByText('Saved', {})).toBeTruthy()
  expect(JSON.parse(patches().at(-1)![1].body)).toEqual({ body: 'nmap {{TARGET}} -sV -sC' })
})

test('unsaved text is flushed once when the section unmounts', async () => {
  patchStatus = 500
  const { unmount } = setup()
  await userEvent.click(screen.getByText('nmap 10.10.11.35'))
  await userEvent.type(screen.getByLabelText('Recon 1 writeup'), ' -A')
  expect(await screen.findByText('Not saved', {})).toBeTruthy()
  patchStatus = 200
  unmount()
  await waitFor(() => expect(patches()).toHaveLength(2))
  expect(JSON.parse(patches()[1][1].body)).toEqual({ body: 'nmap {{TARGET}} -A' })
})

test('toolbox insert appends a raw bash block and saves it', async () => {
  const onInserted = vi.fn()
  setup({ stepId: 5, template: 'nc -lvnp {{LPORT}}' }, onInserted)
  expect(onInserted).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(JSON.parse(patches()[0][1].body)).toEqual({ body: 'nmap {{TARGET}}\n```bash\nnc -lvnp {{LPORT}}\n```\n' })
  expect(screen.getByText('nc -lvnp 4444')).toBeTruthy()
})

test('preview uses the live TARGET for the active box, the stored one otherwise', () => {
  ctx.target = '10.10.11.99'
  const { unmount } = setup()
  expect(screen.getByText('nmap 10.10.11.99')).toBeTruthy()
  unmount()
  Object.assign(ctx, { target: '10.10.11.99', activeBoxId: 2 })
  setup()
  expect(screen.getByText('nmap 10.10.11.35')).toBeTruthy()
})

test('preview links open in a new tab instead of navigating the app', () => {
  render(<StepSection step={{ ...step, body: 'web on http://10.10.11.35:8080' }} item={box} mode="live" ordinal={1} insert={null} onInserted={vi.fn()} onUp={null} onDown={null} reload={vi.fn()} />)
  const a = screen.getByRole('link', { name: 'http://10.10.11.35:8080' })
  expect(a.getAttribute('target')).toBe('_blank')
  expect(a.getAttribute('rel')).toBe('noopener noreferrer')
})

const section = (props: Partial<Parameters<typeof StepSection>[0]> = {}) =>
  <StepSection step={step} item={box} mode="live" ordinal={1} insert={null} onInserted={vi.fn()} onUp={null} onDown={null} reload={vi.fn()} {...props} />

test('live editing returns to the preview on blur and when the mode changes', async () => {
  const { rerender } = render(<>{section()}<button>elsewhere</button></>)
  await userEvent.click(screen.getByText('nmap 10.10.11.35'))
  expect(screen.getByLabelText('Recon 1 writeup')).toBeTruthy()
  await userEvent.click(screen.getByText('elsewhere'))
  expect(screen.queryByLabelText('Recon 1 writeup')).toBeNull()
  await userEvent.click(screen.getByText('nmap 10.10.11.35'))
  rerender(<>{section({ mode: 'markdown' })}<button>elsewhere</button></>)
  rerender(<>{section({ mode: 'live' })}<button>elsewhere</button></>)
  expect(screen.queryByLabelText('Recon 1 writeup')).toBeNull()
  expect(screen.getByText('nmap 10.10.11.35')).toBeTruthy()
})

test('live preview: clicking a code block Copy button copies without opening the editor; plain text still does', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(section({ step: { ...step, body: '```bash\nid\n```\n\nhello there' } }))
  await userEvent.click(screen.getByRole('button', { name: 'Copy code block' }))
  expect(writeText).toHaveBeenCalledWith('id\n')
  expect(screen.queryByLabelText('Recon 1 writeup')).toBeNull()
  await userEvent.click(screen.getByText('hello there'))
  expect(screen.getByLabelText('Recon 1 writeup')).toBeTruthy()
})

test('loop fields autosave their key on blur; a failed line shows in the shared status', async () => {
  patchStatus = 500
  const reload = vi.fn()
  const stats = vi.fn()
  addEventListener('slingsh0t:stats', stats)
  onTestFinished(() => removeEventListener('slingsh0t:stats', stats))
  render(section({ reload }))
  const saw =screen.getByRole('textbox', { name: 'Saw of Recon 1' })
  expect(saw.getAttribute('placeholder')).toBe("What's there")
  await userEvent.type(saw, 'port 80')
  expect(patches()).toEqual([])
  await userEvent.tab()
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not saved'))
  expect(screen.getByRole('status').classList.contains('bad')).toBe(true)
  expect(patches()[0][0]).toBe('/api/steps/5')
  expect(JSON.parse(patches()[0][1].body)).toEqual({ saw: 'port 80' })
  patchStatus = 200
  await userEvent.type(saw, '/tcp')
  await userEvent.tab()
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'))
  expect(screen.getByRole('status').classList.contains('bad')).toBe(false)
  expect(JSON.parse(patches().at(-1)![1].body)).toEqual({ saw: 'port 80/tcp' })
  expect(reload).toHaveBeenCalledTimes(1) // only the successful save reloads
  expect(stats).toHaveBeenCalledTimes(1) // loop lines count toward the nav's writeups
})

test('ticking Done on a reopened dead end keeps it open', async () => {
  const { rerender } = render(section({ step: { ...step, dead: true } }))
  await userEvent.click(screen.getByRole('button', { name: 'Expand Recon 1' }))
  rerender(section({ step: { ...step, dead: true, done: true } }))
  expect(screen.getByText('nmap 10.10.11.35')).toBeTruthy()
})

test('Dead end ticks via PATCH and collapses; the chevron reopens', async () => {
  const { rerender, container } = render(section())
  await userEvent.click(screen.getByLabelText('Recon 1 dead end'))
  expect(patches()[0][0]).toBe('/api/steps/5')
  expect(JSON.parse(patches()[0][1].body)).toEqual({ dead: true })
  rerender(section({ step: { ...step, dead: true } }))
  expect(screen.queryByText('nmap 10.10.11.35')).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Saw of Recon 1' })).toBeNull()
  expect(container.querySelector('section')!.classList.contains('dead')).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Expand Recon 1' }))
  expect(screen.getByText('nmap 10.10.11.35')).toBeTruthy()
})

test('collapsed while either tick is set', () => {
  for (const [done, dead, open] of [[true, false, false], [false, true, false], [true, true, false], [false, false, true]]) {
    render(section({ step: { ...step, done, dead } }))
    expect(screen.queryByText('nmap 10.10.11.35') !== null).toBe(open)
    cleanup()
  }
})

test('un-ticking Dead end on a done step leaves it collapsed', () => {
  const { rerender } = render(section({ step: { ...step, done: true, dead: true } }))
  expect(screen.queryByText('nmap 10.10.11.35')).toBeNull()
  rerender(section({ step: { ...step, done: true, dead: false } }))
  expect(screen.queryByText('nmap 10.10.11.35')).toBeNull()
})

const two = { ...box, steps: [step, { ...step, id: 6, phase: 'PrivEsc', position: 1, body: '' }] } as BoxDetail

test('a body heading that slugs like a step id does not steal the ?step= landing', () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  location.hash = '#/boxes/1?step=6'
  const clash = { ...box, steps: [{ ...step, body: '## Step 6' }, { ...step, id: 6, phase: 'PrivEsc', position: 1, body: '' }] } as BoxDetail
  render(<Writeup item={clash} insert={null} onInserted={vi.fn()} reload={vi.fn()} />)
  expect(document.getElementById('step_6')!.classList.contains('flash')).toBe(true)
  expect(screen.getByRole('heading', { name: 'Step 6' }).classList.contains('flash')).toBe(false)
})

test('Move down PUTs the swapped order; a failed move shows its error in that section', async () => {
  fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => init?.method === 'PUT' ? json(400, { error: 'stepIds must match' }) : json(200, two))
  render(<Writeup item={two} insert={null} onInserted={vi.fn()} reload={vi.fn()} />)
  await userEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0])
  const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!
  expect(put[0]).toBe('/api/boxes/1/step-order')
  expect(JSON.parse(put[1].body)).toEqual({ stepIds: [6, 5] })
  const err = await screen.findByText('stepIds must match')
  expect(document.getElementById('step_5')!.contains(err)).toBe(true)
})

test('an insert for a step that no longer exists is dropped', () => {
  const onInserted = vi.fn()
  render(<Writeup item={box} insert={{ stepId: 999, template: 'id' }} onInserted={onInserted} reload={vi.fn()} />)
  expect(onInserted).toHaveBeenCalledTimes(1)
})

test('notes: "Not saved" clears once the text is back to what was saved', async () => {
  patchStatus = 500
  render(<Notes path="/api/boxes/1" initial="a" />)
  const notes = screen.getByRole('textbox', { name: 'Notes' })
  await userEvent.type(notes, 'b')
  await userEvent.tab()
  expect(await screen.findByText('Not saved')).toBeTruthy()
  await userEvent.type(notes, '{Backspace}')
  await userEvent.tab()
  expect(await screen.findByText('Saved')).toBeTruthy()
})

const editorOf = () => screen.getByLabelText('Recon 1 writeup') as HTMLTextAreaElement

test('shows a newer server body while clean', async () => {
  const { rerender } = render(section({ mode: 'markdown' }))
  rerender(section({ mode: 'markdown', step: { ...step, body: 'nmap -A {{TARGET}}' } }))
  expect(editorOf().value).toBe('nmap -A {{TARGET}}')
  await userEvent.type(editorOf(), ' -p-')
  rerender(section({ mode: 'markdown', step: { ...step, body: 'from another tab' } }))
  expect(editorOf().value).toBe('nmap -A {{TARGET}} -p-')
})

test('adopting a newer server body does not save it back', async () => {
  const { rerender } = render(section({ mode: 'markdown' }))
  rerender(section({ mode: 'markdown', step: { ...step, body: 'from another tab' } }))
  act(() => editorChange.current('from another tab')) // CodeMirror reports the [value] effect's replace as a change
  expect(screen.getByRole('status').textContent).toBe('Saved')
  await new Promise((r) => setTimeout(r, 900)) // past the save delay
  expect(patches()).toEqual([])
})

test('Duplicate does not copy when its pre-save fails', async () => {
  patchStatus = 500
  render(section({ mode: 'markdown' }))
  await userEvent.type(editorOf(), ' -sV')
  await userEvent.click(screen.getByText('Duplicate'))
  expect(await screen.findByText('boom')).toBeTruthy()
  expect(fetchMock.mock.calls.some(([u]) => u === '/api/steps/5/duplicate')).toBe(false)
  patchStatus = 200
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved')) // still saving the text
  expect(JSON.parse(patches().at(-1)![1].body)).toEqual({ body: 'nmap {{TARGET}} -sV' })
})

test('Duplicate saves pending text first', async () => {
  render(section({ mode: 'markdown' }))
  await userEvent.type(editorOf(), ' -sV')
  await userEvent.click(screen.getByText('Duplicate'))
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/steps/5/duplicate')).toBe(true))
  const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method} ${u}`)
  expect(calls.indexOf('PATCH /api/steps/5')).toBeGreaterThanOrEqual(0)
  expect(calls.indexOf('PATCH /api/steps/5')).toBeLessThan(calls.indexOf('POST /api/steps/5/duplicate'))
  expect(JSON.parse(patches()[0][1].body)).toEqual({ body: 'nmap {{TARGET}} -sV' })
})

test('failed Delete keeps saving', async () => {
  vi.stubGlobal('confirm', () => true)
  fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
    init?.method === 'DELETE' ? json(500, { error: 'disk full' }) : json(200, init?.method === 'PATCH' ? step : two))
  render(section({ mode: 'markdown', item: two }))
  await userEvent.type(editorOf(), ' -Pn')
  await userEvent.click(screen.getByText('Delete'))
  expect(await screen.findByText('disk full')).toBeTruthy()
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(JSON.parse(patches()[0][1].body)).toEqual({ body: 'nmap {{TARGET}} -Pn' })
  expect(await screen.findByText('Saved')).toBeTruthy()
})

test('failed unmount flush is reported', async () => {
  patchStatus = 500
  const lost = vi.fn()
  addEventListener('slingsh0t:lost', lost)
  try {
    const { unmount } = render(section({ mode: 'markdown' }))
    await userEvent.type(editorOf(), ' -A')
    unmount()
    await waitFor(() => expect(lost).toHaveBeenCalledTimes(1))
    expect((lost.mock.calls[0][0] as CustomEvent).detail).toBe('Your last edit to Recon 1 writeup was not saved: boom')
  } finally {
    removeEventListener('slingsh0t:lost', lost)
  }
})

test('an in-page anchor in a step preview scrolls instead of changing the hash', async () => {
  const scroll = vi.fn()
  const original = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = scroll
  location.hash = '#/boxes/1'
  try {
    render(<StepSection step={{ ...step, body: '## Shell\n\n[Back to Shell](#shell)' }} item={box} mode="split" ordinal={1} insert={null} onInserted={vi.fn()} onUp={null} onDown={null} reload={vi.fn()} />)
    await userEvent.click(screen.getByRole('link', { name: 'Back to Shell' }))
    expect(location.hash).toBe('#/boxes/1')
    expect(scroll.mock.contexts[0]).toBe(document.querySelector('.md h2#shell'))
  } finally {
    Element.prototype.scrollIntoView = original
    location.hash = ''
  }
})

test('an app link in a step preview reaches the hash router in the same tab', async () => {
  location.hash = '#/boxes/1'
  try {
    render(<StepSection step={{ ...step, body: '[ports](#/reference/2)' }} item={box} mode="split" ordinal={1} insert={null} onInserted={vi.fn()} onUp={null} onDown={null} reload={vi.fn()} />)
    const link = screen.getByRole('link', { name: 'ports' })
    expect(link.getAttribute('target')).toBeNull()
    await userEvent.click(link)
    expect(location.hash).toBe('#/reference/2')
  } finally {
    location.hash = ''
  }
})

const KEY = 'a'.repeat(32)
const withUpload = (status = 201, body?: unknown) => {
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'POST' ? json(status, body ?? { key: KEY, name: decodeURIComponent((init.headers as Record<string, string>)['x-file-name']), mime: 'image/png', size: 24, createdAt: '' }) : base(url, init)))
}
const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')
const png = (name = 'shot.png') => new File(['x'], name, { type: 'image/png' })
const savedBody = async () => {
  await waitFor(() => expect(patches()).toHaveLength(1))
  return JSON.parse(patches()[0][1].body).body as string
}

test('pasting an image uploads it and appends a markdown image to the body', async () => {
  withUpload()
  const { container } = render(<StepSection step={step} item={box} mode="markdown" ordinal={1} insert={null} onInserted={vi.fn()} onUp={null} onDown={null} reload={vi.fn()} />)
  fireEvent.paste(container.querySelector('section')!, { clipboardData: { files: [png()], items: [], getData: () => '' } })
  expect(await savedBody()).toBe(`nmap {{TARGET}}\n\n![shot.png](/api/files/${KEY})\n`)
  expect(posts()[0][0]).toBe('/api/steps/5/attachments')
})

test('the Attach image button uploads the chosen file', async () => {
  withUpload()
  setup()
  expect((screen.getByLabelText('Attach image') as HTMLInputElement).hidden).toBe(false) // hidden would drop it from the tab order
  fireEvent.change(screen.getByLabelText('Attach image'), { target: { files: [png('a[1](2).png')] } })
  expect(await savedBody()).toBe(`nmap {{TARGET}}\n\n![a12.png](/api/files/${KEY})\n`)
})

test('pasting text is left to the editor', () => {
  const { container } = setup()
  fireEvent.paste(container.querySelector('section')!, { clipboardData: { files: [], items: [], getData: () => 'hi' } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('an image alongside text (Office apps) is not uploaded', () => {
  const { container } = setup()
  fireEvent.paste(container.querySelector('section')!, { clipboardData: { files: [png()], items: [], getData: () => 'some text' } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('shows the upload error', async () => {
  withUpload(400, { error: 'not a png image' })
  setup()
  fireEvent.change(screen.getByLabelText('Attach image'), { target: { files: [png()] } })
  expect((await screen.findByRole('alert')).textContent).toContain('not a png image')
})
