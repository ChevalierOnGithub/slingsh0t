import { expect, test } from 'vitest'
import { parseHash } from './router'

test('parses hash routes with a query', () => {
  const box = parseHash('#/boxes/5?step=9')
  expect(box).toMatchObject({ name: 'box', id: 5 })
  expect(box.query.get('step')).toBe('9')
  expect(parseHash('#/boxes?view=board').query.get('view')).toBe('board')
  expect(parseHash('#/hosts/4?step=2')).toMatchObject({ name: 'host', id: 4 })
  expect(parseHash('#/reference/3')).toMatchObject({ name: 'reference', id: 3 })
  expect(parseHash('#/reference')).toMatchObject({ name: 'reference', id: undefined })
  expect(parseHash('#/shells').name).toBe('shells')
  expect(parseHash('#/networks/2')).toMatchObject({ name: 'network', id: 2 })
  expect(parseHash('#/networks').name).toBe('networks')
  expect(parseHash('#/writeups/4')).toMatchObject({ name: 'writeup', id: 4 })
  expect(parseHash('#/writeups/network/3')).toMatchObject({ name: 'writeup', kind: 'network', id: 3 })
  expect(parseHash('#/writeups/3')).toMatchObject({ name: 'writeup', kind: 'box', id: 3 })
  expect(parseHash('#/writeups').name).toBe('writeups')
  expect(parseHash('#/loot').name).toBe('loot')
  for (const h of ['', '#/', '#/nope', '#/tools/4', '#/hosts', '#/loot/1']) expect(parseHash(h).name).toBe('home')
  expect(parseHash('#/home').name).toBe('home')
})
