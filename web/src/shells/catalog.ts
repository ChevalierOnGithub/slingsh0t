import { ASSEMBLED } from './assembled'
import { LISTENERS, SHELLS, SPECIAL } from './listeners'
import { MSFVENOM } from './msfvenom'
import { REVERSE } from './reverse'
import type { Catalog } from './types'

const catalog: Catalog = { reverse: REVERSE, msfvenom: MSFVENOM, assembled: ASSEMBLED, listeners: LISTENERS, shells: SHELLS, special: SPECIAL }

export const loadCatalog = (): Catalog => catalog
