// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { Editor } from './Editor'


test("the editor's accessible name follows the label prop", () => {
  const { container, rerender } = render(<Editor value="x" onChange={() => {}} label="Recon 1 writeup" />)
  const content = () => container.querySelector('.cm-content')!
  expect(content().getAttribute('aria-label')).toBe('Recon 1 writeup')
  rerender(<Editor value="x" onChange={() => {}} label="PrivEsc 2 writeup" />)
  expect(content().getAttribute('aria-label')).toBe('PrivEsc 2 writeup')
})
