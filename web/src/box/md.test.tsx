// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { jump, md } from './StepSection'

afterEach(() => { vi.unstubAllGlobals() })

test('headings get slug ids, anchors stay in-page, external links open a tab', () => {
  const html = md.render('## WEB01\n\n## WEB01\n\n[Back](#web01) [Out](https://x.y)')
  expect(html).toContain('<h2 id="web01">'); expect(html).toContain('<h2 id="web01-1">')
  expect(html).toMatch(/<a href="#web01">/); expect(html).toMatch(/<a href="https:\/\/x\.y" target="_blank"/)
})

test('code blocks get a Copy button that copies their text and does not bubble', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  const html = md.render('```bash\ngrep -RIn "eval" .\n```')
  expect(html).toMatch(/^<div class="codeblock"><pre><code class="language-bash">/)
  const outer = vi.fn()
  render(<div onClick={outer}><div className="md" onClick={jump} dangerouslySetInnerHTML={{ __html: html }} /></div>)
  fireEvent.click(screen.getByRole('button', { name: 'Copy code block' }))
  expect(writeText).toHaveBeenCalledWith('grep -RIn "eval" .\n')
  expect(outer).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copy code block' }).textContent).toBe('Copied'))
})
