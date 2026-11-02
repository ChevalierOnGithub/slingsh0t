import { HAVES } from '../shared/types'
import type { BoxService, Have } from '../shared/types'

// A leading '-' would read as an option once substituted into a command; ports have no leading zeros.
export const isHostOrEmpty = (s: unknown): s is string => typeof s === 'string' && (s === '' || /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(s))
export const isUrlOrEmpty = (s: unknown): s is string => typeof s === 'string' && (s === '' || (s.length <= 2048 && /^https?:\/\/\S+$/.test(s)))
export const isPortOrEmpty = (s: unknown): s is string => typeof s === 'string' && (s === '' || (/^[1-9]\d{0,4}$/.test(s) && +s <= 65535))

/** Throws an error Fastify answers with `statusCode` (400 by default). */
export const fail = (msg: string, statusCode = 400): never => { throw Object.assign(new Error(msg), { statusCode }) }
export const isStr = (v: unknown): v is string => typeof v === 'string'
export const isTags = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
export const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
export const isSlug = (v: unknown): v is string => isStr(v) && /^[a-z][a-z0-9-]{0,23}$/.test(v)
export const isHaves = (v: unknown): v is Have[] => Array.isArray(v) && v.every((h) => (HAVES as readonly unknown[]).includes(h))
const isPortOrNull = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535)
export const isServices = (v: unknown): v is BoxService[] =>
  Array.isArray(v) && v.length <= 64 && v.every((s) => typeof s === 'object' && s !== null && isSlug(s.name) && isPortOrNull(s.port))
