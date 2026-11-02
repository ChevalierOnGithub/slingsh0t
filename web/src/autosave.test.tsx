// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { LOST_EVENT, useAutosave } from './autosave'


const unloadPrevented = () => {
  const e = new Event('beforeunload', { cancelable: true })
  dispatchEvent(e)
  return e.defaultPrevented
}

test('flushes on unmount', () => {
  const send = vi.fn(async () => {})
  const { result, unmount } = renderHook(() => useAutosave('a', send, 'notes'))
  act(() => result.current.onChange('ab'))
  expect(send).not.toHaveBeenCalled()
  unmount()
  expect(send).toHaveBeenCalledExactlyOnceWith('ab')
})

test('reports a failed unmount flush', async () => {
  const lost = vi.fn()
  addEventListener(LOST_EVENT, lost)
  const { result, unmount } = renderHook(() => useAutosave('a', async () => { throw new Error('offline') }, 'notes'))
  act(() => result.current.onChange('ab'))
  unmount()
  await waitFor(() => expect(lost).toHaveBeenCalledTimes(1))
  expect((lost.mock.calls[0][0] as CustomEvent).detail).toBe('Your last edit to notes was not saved: offline')
  removeEventListener(LOST_EVENT, lost)
})

test('follows server while clean, keeps typing while dirty', () => {
  const { result, rerender } = renderHook(({ server }) => useAutosave(server, async () => {}, 'notes'), { initialProps: { server: 'a' } })
  rerender({ server: 'b' })
  expect(result.current.value).toBe('b')
  act(() => result.current.onChange('mine'))
  rerender({ server: 'c' })
  expect(result.current.value).toBe('mine')
  expect(result.current.status).toBe('Unsaved')
  act(() => result.current.onChange('c'))
  expect(result.current.status).toBe('Saved')
})

test('guards unload only while unsaved', async () => {
  const { result } = renderHook(() => useAutosave('a', async () => {}, 'notes'))
  expect(unloadPrevented()).toBe(false)
  act(() => result.current.onChange('ab'))
  expect(unloadPrevented()).toBe(true)
  await act(() => result.current.flush())
  expect(result.current.status).toBe('Saved')
  expect(unloadPrevented()).toBe(false)
})

test('a failed flush shows Not saved with the error', async () => {
  const { result } = renderHook(() => useAutosave('a', async () => { throw new Error('offline') }, 'notes'))
  act(() => result.current.onChange('ab'))
  await act(() => result.current.flush())
  expect(result.current.status).toBe('Not saved')
  expect(result.current.error).toBe('offline')
})
