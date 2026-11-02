// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { focusFirstField } from './forms'

test('focuses the first visible, enabled field, skipping hidden inputs, disabled fields and hidden parts', () => {
  document.body.innerHTML = `<form>
    <input type="hidden" name="scope">
    <select name="off" disabled></select>
    <div hidden><input name="tucked"></div>
    <button type="button">x</button>
    <input name="user">
  </form>`
  focusFirstField(document.querySelector('form')!)
  expect((document.activeElement as HTMLInputElement).name).toBe('user')
})
