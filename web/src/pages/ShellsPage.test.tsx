// @vitest-environment jsdom
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Catalog } from '../shells/types'
import { ContextProvider } from '../shell/TargetBar'
import { ShellsPage } from './ShellsPage'

// Synthetic catalog only: real payload text on disk gets quarantined by Defender.
const CAT = vi.hoisted((): Catalog => ({
  reverse: [
    { name: 'Bash -i', command: 'x {ip}:{port} {shell}', os: ['linux', 'mac'], tags: [] },
    { name: 'PHP exec', command: 'p {ip} {port}', os: ['linux', 'windows', 'mac'], tags: [] },
    { name: 'PHP PentestMonkey', command: '<?x\n{ip}:{port}\n', os: ['linux'], tags: [] },
    { name: 'PowerShell #1', command: 'w {ip} {port}', os: ['windows'], tags: [] },
  ],
  msfvenom: [
    { name: 'Windows Staged', command: 'm -p windows/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f exe', os: ['windows'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
    { name: 'Linux Stageless', command: 'm -p linux/x64/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['linux'], tags: ['stageless'] },
  ],
  assembled: [
    { name: 'Linux x64 reverse TCP', command: 'a -p linux/x64/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['linux'], tags: ['x64', 'reverse'], listener: 'msfconsole' },
    { name: 'Windows x86 bind TCP', command: 'a -p windows/shell_bind_tcp LPORT={port}', os: ['windows'], tags: ['x86', 'bind'], listener: 'msfconsole (bind)' },
  ],
  listeners: [
    ['nc', 'n -l {port}'], ['ncat', 'nn {ip} {port}'], ['msfconsole', 'msf {payload} {ip} {port}'],
    ['msfconsole (bind)', 'mb {payload} {target} {port}'], ['msfconsole (meterpreter)', 'mm {payload} {ip} {port}'],
  ],
  shells: ['sh', 'bash', 'zsh'],
  special: { ps: 's {ip}', psStderr: 'e {ip}' },
}))
vi.mock('../shells/catalog', () => ({ loadCatalog: () => CAT }))

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
let lhost = '10.10.14.7'
let lport = '4444'
let target = '10.10.11.35'
beforeEach(() => {
  lhost = '10.10.14.7'
  lport = '4444'
  target = '10.10.11.35'
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => json({ target, lhost, lport, activeBoxId: null, activeHostId: null, via: null })))
})
afterEach(() => { vi.restoreAllMocks() })

const setup = () => {
  const user = userEvent.setup() // before stubbing: setup() installs its own clipboard
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const view = render(<ContextProvider><ShellsPage /></ContextProvider>)
  return { user, writeText, view }
}
const chips = () => screen.getAllByRole('radio').map((r) => r.firstChild?.textContent)
const checked = () => screen.getByRole('radio', { checked: true }).firstChild?.textContent
const preview = () => document.querySelector('.sg-code')!.textContent
const ready = () => waitFor(() => expect(preview()).toContain('10.10.14.7'))
const lisText = () => document.querySelector('.sg-lis code')!.textContent
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

test('filters by search, OS and language', async () => {
  const { user } = setup()
  await user.type(screen.getByLabelText('Search payloads'), 'php')
  expect(chips()).toEqual(['PHP exec', 'PHP PentestMonkey'])
  await user.clear(screen.getByLabelText('Search payloads'))
  await user.click(screen.getByRole('button', { name: 'Windows' }))
  expect(chips()).toEqual(['PHP exec', 'PowerShell #1'])
  await user.click(screen.getByRole('button', { name: 'All' }))
  await user.click(screen.getByRole('button', { name: 'PHP' }))
  await user.click(screen.getByRole('button', { name: 'One-liners only' }))
  expect(chips()).toEqual(['PHP exec'])
})

test('no match shows Clear filters which restores the grid', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Windows' }))
  await user.click(screen.getByRole('button', { name: 'Bash' }))
  await user.click(screen.getByRole('button', { name: 'One-liners only' }))
  await user.type(screen.getByLabelText('Search payloads'), 'zzz')
  expect(screen.getByText('No payloads match')).toBeTruthy()
  expect(screen.queryAllByRole('radio')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(chips()).toHaveLength(4)
  expect((screen.getByLabelText('Search payloads') as HTMLInputElement).value).toBe('')
  expect(document.activeElement).toBe(screen.getByLabelText('Search payloads'))
  expect([pressed('All'), pressed('Windows'), pressed('Bash'), pressed('One-liners only')]).toEqual(['true', 'false', 'false', 'false'])
})

test('/ focuses search, but not from another input', async () => {
  const { user } = setup()
  await user.keyboard('/')
  expect(document.activeElement).toBe(screen.getByLabelText('Search payloads'))
  await user.keyboard('/')
  expect((screen.getByLabelText('Search payloads') as HTMLInputElement).value).toBe('/')
})

test('selects with arrow keys and shows the payload with LHOST/LPORT', async () => {
  const { user } = setup()
  await ready()
  expect(preview()).toBe('x 10.10.14.7:4444 bash')
  expect([...document.querySelectorAll('.sg-code mark')].map((m) => m.textContent)).toEqual(['10.10.14.7', '4444'])
  expect(screen.getAllByRole('radio').filter((r) => r.tabIndex === 0)).toHaveLength(1)
  screen.getByRole('radio', { checked: true }).focus()
  await user.keyboard('{ArrowRight}')
  expect(checked()).toBe('PHP exec')
  expect(document.activeElement).toBe(screen.getByRole('radio', { checked: true }))
  expect(preview()).toBe('p 10.10.14.7 4444')
  await user.keyboard('{ArrowLeft}{ArrowLeft}')
  expect(checked()).toBe('PowerShell #1')
})

test('arrow keys move from the tab stop when the selected chip is filtered out', async () => {
  const { user } = setup()
  const search = screen.getByLabelText('Search payloads')
  await user.type(search, 'p') // hides the selected Bash -i
  expect(chips()).toEqual(['PHP exec', 'PHP PentestMonkey', 'PowerShell #1'])
  const stop = () => screen.getAllByRole('radio').find((r) => r.tabIndex === 0)!
  stop().focus()
  await user.keyboard('{ArrowLeft}')
  expect(checked()).toBe('PowerShell #1')
  expect(document.activeElement).toBe(screen.getByRole('radio', { checked: true }))
  await user.clear(search)
  await user.click(screen.getByRole('radio', { name: 'Bash -i' }))
  await user.type(search, 'p')
  stop().focus()
  await user.keyboard('{ArrowRight}')
  expect(checked()).toBe('PHP PentestMonkey')
  expect(document.activeElement).toBe(screen.getByRole('radio', { checked: true }))
})

test('encoding and wrap change the preview; disallowed ones are disabled for a File entry', async () => {
  const { user } = setup()
  await ready()
  await user.selectOptions(screen.getByLabelText('Shell'), 'zsh')
  await user.click(screen.getByRole('button', { name: 'bash -c' }))
  expect(preview()).toBe("bash -c 'x 10.10.14.7:4444 zsh'")
  await user.click(screen.getByRole('button', { name: 'BASE64' }))
  expect(preview()).toBe(btoa("bash -c 'x 10.10.14.7:4444 zsh'"))
  await user.click(screen.getByRole('button', { name: 'BASH B64' }))
  expect((screen.getByRole('button', { name: 'bash -c' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('radio', { name: /PHP PentestMonkey/ }))
  expect(screen.queryByLabelText('Shell')).toBeNull()
  expect((screen.getByRole('button', { name: 'BASE64' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'cmd /c' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'RAW' }).getAttribute('aria-pressed')).toBe('true')
  expect(preview()).toBe('<?x\n10.10.14.7:4444\n')
})

test('marks a missing LHOST', async () => {
  lhost = ''
  setup()
  await screen.findByText('Set LHOST and LPORT in the target bar')
  await waitFor(() => expect(document.querySelector('.sg-code mark.warn')?.textContent).toBe('{ip}'))
})

test('marks a missing LPORT', async () => {
  lport = ''
  setup()
  await screen.findByText('Set LHOST and LPORT in the target bar')
  await waitFor(() => expect([...document.querySelectorAll('.sg-code mark.warn')].map((m) => m.textContent)).toEqual(['{port}']))
})

test('copy payload copies the preview text', async () => {
  const { user, writeText } = setup()
  await ready()
  await user.click(screen.getByRole('button', { name: 'Copy payload' }))
  expect(writeText).toHaveBeenCalledWith('x 10.10.14.7:4444 bash')
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Copy listener' }))
  expect(writeText).toHaveBeenLastCalledWith('n -l 4444')
})

test('a picked msfconsole listener takes the msfvenom entry\'s -p payload', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'MSFVenom' }))
  expect(screen.queryByRole('group', { name: 'Encoding' })).toBeNull() // built on the attack box: nothing to encode or wrap
  expect(screen.queryByRole('group', { name: 'Wrap' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'stageless' }))
  expect(chips()).toEqual(['Linux Stageless'])
  await user.click(screen.getByRole('radio', { name: 'Linux Stageless' }))
  expect(pressed('nc')).toBe('true') // no listener on the entry
  await user.click(screen.getByRole('button', { name: 'msfconsole' }))
  expect(lisText()).toBe('msf linux/x64/shell_reverse_tcp 10.10.14.7 4444')
  await user.click(screen.getByRole('button', { name: 'ncat' }))
  expect(lisText()).toBe('nn 10.10.14.7 4444')
})

test('assembled shows options and appends flags in order', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  expect(preview()).toMatch(/ -b '\\x00' -f c$/)
  expect(screen.queryByRole('group', { name: 'Encoding' })).toBeNull()
  await user.clear(field('Bad chars'))
  await user.type(field('Bad chars'), '00 0a')
  await user.selectOptions(screen.getByLabelText('Encoder'), 'x64/zutto_dekiru')
  await user.clear(field('Iterations'))
  await user.type(field('Iterations'), '2')
  await user.clear(field('NOP sled'))
  await user.type(field('NOP sled'), '8')
  await user.selectOptions(screen.getByLabelText('Format'), 'python')
  expect(preview()).toContain("-b '\\x00\\x0a' -e x64/zutto_dekiru -i 2 -n 8 -f python")
})

test('invalid bad chars are flagged and omitted', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  await user.clear(field('Bad chars'))
  await user.type(field('Bad chars'), '\\x0')
  expect(field('Bad chars').getAttribute('aria-invalid')).toBe('true')
  expect(preview()).not.toContain('-b')
})

test('encoder list follows the entry arch and a mismatch falls back to Auto', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  expect(screen.queryByLabelText('Iterations')).toBeNull()
  await user.click(screen.getByRole('radio', { name: 'Linux x64 reverse TCP' }))
  await user.selectOptions(screen.getByLabelText('Encoder'), 'x64/zutto_dekiru')
  await user.click(screen.getByRole('radio', { name: 'Windows x86 bind TCP' }))
  const sel = screen.getByLabelText('Encoder') as HTMLSelectElement
  expect(sel.selectedOptions[0].textContent).toBe('Auto')
  const opts = [...sel.options].map((o) => o.textContent)
  expect(opts).toContain('x86/shikata_ga_nai')
  expect(opts).not.toContain('x64/zutto_dekiru')
  expect(preview()).not.toContain('-e ')
  expect(screen.queryByLabelText('Iterations')).toBeNull()
})

test('listener follows the entry: meterpreter, bind with target, nc default', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'MSFVenom' }))
  expect(checked()).toBe('Windows Staged')
  expect(pressed('msfconsole (meterpreter)')).toBe('true')
  expect(lisText()).toBe('mm windows/x64/meterpreter/reverse_tcp 10.10.14.7 4444')
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  await user.click(screen.getByRole('radio', { name: 'Windows x86 bind TCP' }))
  expect(pressed('msfconsole (bind)')).toBe('true')
  expect(lisText()).toBe('mb windows/shell_bind_tcp 10.10.11.35 4444')
  await user.click(screen.getByRole('tab', { name: 'Reverse' }))
  expect(checked()).toBe('Bash -i')
  expect(pressed('nc')).toBe('true')
})

test('listener override lasts only for the current payload', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('button', { name: 'ncat' }))
  expect(pressed('ncat')).toBe('true')
  await user.click(screen.getByRole('radio', { name: 'PHP exec' }))
  expect(pressed('nc')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'ncat' }))
  await user.click(screen.getByRole('tab', { name: 'MSFVenom' }))
  await user.click(screen.getByRole('tab', { name: 'Reverse' }))
  expect(pressed('nc')).toBe('true')
})

test('empty TARGET leaves {target} marked in a bind listener', async () => {
  target = ''
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  await user.click(screen.getByRole('radio', { name: 'Windows x86 bind TCP' }))
  expect(lisText()).toBe('mb windows/shell_bind_tcp {target} 4444')
  expect(document.querySelector('.sg-lis code mark.warn')?.textContent).toBe('{target}')
})

test('assembled options are remembered', async () => {
  const { user, view } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  await user.clear(field('NOP sled'))
  await user.type(field('NOP sled'), '8')
  view.unmount()
  setup()
  expect(field('NOP sled').value).toBe('8')
})

test('remembers tab and pick across remounts', async () => {
  const { user, view } = setup()
  await ready()
  await user.click(screen.getByRole('tab', { name: 'MSFVenom' }))
  await user.click(screen.getByRole('radio', { name: 'Linux Stageless' }))
  view.unmount()
  setup()
  expect(screen.getByRole('tab', { name: 'MSFVenom' }).getAttribute('aria-selected')).toBe('true')
  expect(checked()).toBe('Linux Stageless')
})

test('falls back when the remembered payload is gone', async () => {
  localStorage.setItem('slingsh0t:shells', JSON.stringify({ tab: 'reverse', picked: { reverse: 'Gone' } }))
  setup()
  expect(checked()).toBe('Bash -i')
})

test('a stored value of the wrong type falls back to its default, field by field', async () => {
  localStorage.setItem('slingsh0t:shells', JSON.stringify({
    tab: 'reverse', text: 5, oneLinersOnly: 'yes', lang: 3, picked: { reverse: 'PHP exec', msfvenom: 7 }, shell: 'zsh',
    asm: { nops: 'x', format: 'exe', badChars: '\\x0a' },
  }))
  const { user } = setup()
  expect(checked()).toBe('PHP exec')
  expect(chips()).toHaveLength(4)
  expect((screen.getByLabelText('Search payloads') as HTMLInputElement).value).toBe('')
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  expect(field('NOP sled').value).toBe('0')
  expect(field('Bad chars').value).toBe('\\x0a')
  expect(preview()).toMatch(/ -f c$/)
})

test('works when storage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('radio', { name: 'PHP exec' }))
  expect(preview()).toBe('p 10.10.14.7 4444')
})

test('save downloads with the inferred file name', async () => {
  const create = vi.fn((_: Blob) => 'blob:x')
  const revoke = vi.fn()
  const orig = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
  onTestFinished(() => { Object.assign(URL, orig) })
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
  let download = ''
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { download = this.download })
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('radio', { name: /PHP PentestMonkey/ }))
  await user.click(screen.getByRole('button', { name: 'Save .php' }))
  expect(download).toBe('php-pentestmonkey.php')
  expect(create.mock.calls[0][0].type).toBe('text/plain')
  expect(await create.mock.calls[0][0].text()).toBe('<?x\n10.10.14.7:4444\n')
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'))
})

test('msfconsole payload comes only from a selected MSFVenom or Assembled entry', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('button', { name: 'msfconsole' }))
  expect(lisText()).toBe('msf {payload} 10.10.14.7 4444') // no fallback on Reverse
  await user.click(screen.getByRole('tab', { name: 'Assembled' }))
  expect(pressed('msfconsole')).toBe('true')
  expect(lisText()).toBe('msf linux/x64/shell_reverse_tcp 10.10.14.7 4444')
})

test('warns when LHOST/LPORT is empty and the output is encoded', async () => {
  lhost = ''
  const { user } = setup()
  await screen.findByText('Set LHOST and LPORT in the target bar')
  const warning = 'LHOST/LPORT is empty: the encoded payload contains the placeholder.'
  expect(screen.queryByText(warning)).toBeNull()
  await user.click(screen.getByRole('button', { name: 'BASE64' }))
  expect(screen.getByText(warning)).toBeTruthy()
})

test('a stored shell missing from the catalog falls back to bash', async () => {
  localStorage.setItem('slingsh0t:shells', JSON.stringify({ shell: 'fish' }))
  setup()
  await ready()
  expect(preview()).toBe('x 10.10.14.7:4444 bash')
  expect((screen.getByLabelText('Shell') as HTMLSelectElement).value).toBe('bash')
})

test('announces Copied in a live region', async () => {
  const { user } = setup()
  await ready()
  await user.click(screen.getByRole('button', { name: 'Copy payload' }))
  await waitFor(() => expect([...document.querySelectorAll('.vh[aria-live="polite"]')].map((e) => e.textContent)).toContain('Copied'))
})

test('a listener remembered under the old storage shape is ignored', async () => {
  localStorage.setItem('slingsh0t:shells', JSON.stringify({ tab: 'msfvenom', picked: { msfvenom: 'Windows Staged' }, listener: 'ncat' }))
  setup()
  expect(pressed('msfconsole (meterpreter)')).toBe('true')
  expect(pressed('ncat')).toBe('false')
})
