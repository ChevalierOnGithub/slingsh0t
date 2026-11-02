import { expect, test } from 'vitest'
import { openDb } from '../../server/db'
import { PRESETS } from '../../server/presets'
import { importNetworkPresets } from './import'

test('creates every known lab once, by platform or all, and never duplicates', () => {
  const db = openDb(':memory:')
  const htb = PRESETS.filter((p) => p.platform === 'HTB').length
  expect(importNetworkPresets(db, 'HTB')).toEqual({ inserted: htb, skipped: 0 })
  expect(importNetworkPresets(db, 'HTB')).toEqual({ inserted: 0, skipped: htb })
  expect(importNetworkPresets(db)).toEqual({ inserted: PRESETS.length - htb, skipped: htb })
  expect(PRESETS.length).toBe(htb) // THM networks come from the live import now
  const dante = db.prepare("SELECT platform, name, hosts_in_scope, flags_in_scope, tags, url, source_id FROM networks WHERE source_id = 'htb-dante'").get()
  expect(dante).toEqual({ platform: 'HTB', name: 'Dante', hosts_in_scope: 14, flags_in_scope: 26, tags: '["Active Directory"]', url: 'https://app.hackthebox.com/prolabs/overview/dante', source_id: 'htb-dante' })
})

test('a re-run leaves the owner edits alone', () => {
  const db = openDb(':memory:')
  importNetworkPresets(db, 'HTB')
  db.prepare("UPDATE networks SET hosts_in_scope = 4, notes = 'mine' WHERE source_id = 'htb-dante'").run()
  importNetworkPresets(db, 'HTB')
  expect(db.prepare("SELECT hosts_in_scope, notes FROM networks WHERE source_id = 'htb-dante'").get()).toEqual({ hosts_in_scope: 4, notes: 'mine' })
})
