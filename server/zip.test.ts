import { crc32 } from 'node:zlib'
import { expect, test } from 'vitest'
import { zipStore } from './zip'

test('writes a valid single-file archive', () => {
  const z = zipStore([{ name: 'a.md', data: 'hello' }])
  expect(z.readUInt32LE(0)).toBe(0x04034b50)
  expect(z.readUInt32LE(14)).toBe(crc32(Buffer.from('hello')))
  expect(z.readUInt32LE(18)).toBe(5)
  expect(z.readUInt32LE(22)).toBe(5)
  expect(z.readUInt16LE(26)).toBe(4)
  expect(z.subarray(30, 34).toString()).toBe('a.md')
  expect(z.subarray(34, 39).toString()).toBe('hello')
  expect(z.readUInt32LE(39)).toBe(0x02014b50)
  const end = z.subarray(z.length - 22)
  expect(end.readUInt32LE(0)).toBe(0x06054b50)
  expect(end.readUInt16LE(10)).toBe(1)
  expect(end.readUInt32LE(16)).toBe(39)
})

test('sets the UTF-8 flag and writes non-ASCII names as UTF-8', () => {
  const name = 'boxes/Café.md'
  const z = zipStore([{ name, data: 'x' }])
  expect(z.readUInt16LE(6) & 0x0800).toBeTruthy()
  const nb = Buffer.from(name)
  expect(z.subarray(30, 30 + nb.length).equals(nb)).toBe(true)
})

test('handles two files and an empty one', () => {
  const z = zipStore([{ name: 'a.md', data: 'hello' }, { name: 'b.md', data: '' }])
  const end = z.subarray(z.length - 22)
  expect(end.readUInt16LE(10)).toBe(2)
  expect(z.readUInt32LE(39)).toBe(0x04034b50)
  expect(z.readUInt32LE(39 + 14)).toBe(0)
  expect(z.readUInt32LE(39 + 18)).toBe(0)
  expect(z.readUInt32LE(39 + 22)).toBe(0)
})
