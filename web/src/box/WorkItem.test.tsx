// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWorkItem } from './WorkItem'


/** fetch whose answers the test hands out, in any order. */
const deferredFetch = () => {
  const pending: ((body: unknown) => void)[] = []
  vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => pending.push((body) => r(new Response(JSON.stringify(body), { status: 200 }))))))
  return pending
}
const answer = (f: (body: unknown) => void, body: unknown) => act(async () => f(body))

test('an older GET resolving last does not replace a newer one', async () => {
  const pending = deferredFetch()
  const { result } = renderHook(() => useWorkItem('/api/boxes/1'))
  act(() => result.current.reload())
  await answer(pending[1], { name: 'newer' })
  await answer(pending[0], { name: 'older' })
  expect(result.current.item).toEqual({ name: 'newer' })
})

test('a GET started before a change does not replace its answer', async () => {
  const pending = deferredFetch()
  const { result } = renderHook(() => useWorkItem('/api/boxes/1'))
  let done!: Promise<boolean>
  act(() => { done = result.current.change('/api/boxes/1', { status: 'rooted' }) })
  await answer(pending[1], { name: 'changed' })
  await act(() => done)
  await answer(pending[0], { name: 'stale' })
  expect(result.current.item).toEqual({ name: 'changed' })
})
