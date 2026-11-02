// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LootPage } from './LootPage'

afterEach(() => { vi.unstubAllGlobals() })

const cred = (id: number, username: string, scope: object, scopeShortId: string, scopeName: string) => ({
  id, username, kind: 'password', secret: 'never-shown', foundOn: null, foundNote: '', scope, results: [], untested: 0, worksOn: [], scopeShortId, scopeName,
})

test('lists credentials from networks and boxes with where each was found', async () => {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([
    { ...cred(1, 'svc_sql', { networkId: 1 }, 'N-001', 'Dante'), results: [{ hostId: 9, name: 'WEB02', result: 'works' }] }, cred(2, 'jdoe', { boxId: 3 }, 'H-0003', 'Cicada'),
  ])))
  vi.stubGlobal('fetch', fetchMock)
  render(<LootPage />)
  expect((await screen.findByText('svc_sql')).closest('tr')!.textContent).toContain('N-001 Dante')
  expect(screen.getByText('WEB02').className).toBe('res works') // no hosts prop on the Loot index: the name comes with the result
  expect(screen.getByText('jdoe').closest('tr')!.textContent).toContain('H-0003 Cicada')
  expect(screen.getByRole('columnheader', { name: 'Found in' })).toBeTruthy()
  expect(screen.queryByText('never-shown')).toBeNull()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/credentials?all=1')
})
