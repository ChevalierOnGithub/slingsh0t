process.env.TZ = 'Europe/Bucharest' // before any Date is formatted; vitest runs each file in its own worker
import { beforeEach, describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { slugger } from '../shared/slug'
import { openDb } from './db'
import { networkReportOf, reportOf } from './report'

const today = '2026-11-01'
let db: ReturnType<typeof openDb>

// Box H-0001 "Lame" with steps, technique uses, a credential and a flag.
type Loop = { saw?: string; think?: string; tried?: string; got?: string; dead?: number }
const seedBox = (targetIp: string | null = '10.10.10.3', name = 'Lame', loops: Record<string, Loop> = {}) => {
  const box = Number(db.prepare(`INSERT INTO boxes (short_id, platform, name, os, difficulty, status, target_ip, tags, started_at, rooted_at, foothold, notes)
    VALUES ('H-0001', 'HTB', ?, 'Linux', 'Easy', 'rooted', ?, '["Active Directory"]', '2026-10-30T10:00:00.000Z', '2026-10-31T09:00:00.000Z', 'anon FTP', 'creds in {{TARGET}} notes')`).run(name, targetIp).lastInsertRowid)
  db.prepare("UPDATE context SET lhost = '10.10.14.2', lport = '4444' WHERE id = 1").run()
  const step = (phase: string, position: number, body: string, l: Loop = loops[phase] ?? {}) =>
    Number(db.prepare('INSERT INTO steps (box_id, phase, position, body, saw, think, tried, got, dead) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(box, phase, position, body, l.saw ?? '', l.think ?? '', l.tried ?? '', l.got ?? '', l.dead ?? 0).lastInsertRowid)
  const s0 = step('Recon', 0, 'nmap {{TARGET}}')
  step('Recon', 1, '')
  step('Initial Access', 2, 'nc {{LHOST}} {{LPORT}}')
  step('PrivEsc', 3, '  ')
  step('Root', 4, 'got it')
  db.prepare("INSERT INTO tools (short_id, name) VALUES ('TL-0001', 'Rubeus'), ('TL-0002', 'Impacket')").run()
  db.prepare("INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-0001', 'Kerberoasting', 'PrivEsc'), ('TQ-0002', 'SUID abuse', 'PrivEsc')").run()
  db.prepare("INSERT INTO technique_uses (technique_id, step_id, tool_ids) VALUES (1, ?, '[1,2]'), (2, ?, NULL)").run(s0, s0)
  db.prepare("INSERT INTO credentials (box_id, username, kind, secret, found_note) VALUES (?, 'svc|user', 'password', 'P@ss|word', 'found in db')").run(box)
  db.prepare("INSERT INTO flags (box_id, label, value) VALUES (?, 'user', 'deadbeefcafe')").run(box)
  return box
}

// Network "Dante" with host HS-0001 "WEB01".
const seedHost = () => {
  const net = Number(db.prepare("INSERT INTO networks (short_id, platform, name) VALUES ('N-0001', 'HTB', 'Dante')").run().lastInsertRowid)
  const host = (sid: string, name: string) =>
    Number(db.prepare("INSERT INTO hosts (short_id, network_id, name, os, status) VALUES (?, ?, ?, 'Linux', 'in_progress')").run(sid, net, name).lastInsertRowid)
  return { net, h1: host('HS-0001', 'WEB01'), h2: host('HS-0002', 'DB01') }
}

beforeEach(() => { db = openDb(':memory:') })

describe('reportOf', () => {
  it('box facts, summary and frontmatter', () => {
    const { frontmatter, markdown } = reportOf(db, { col: 'box_id', id: seedBox() }, today)
    const lines = frontmatter.split('\n')
    for (const l of ['title: "Lame"', 'id: "H-0001"', 'platform: "HTB"', 'difficulty: "Easy"', 'status: "Rooted"', 'target: "10.10.10.3"',
      'started: "2026-10-30"', 'rooted: "2026-10-31"', 'tags: ["Active Directory"]', 'exported: "2026-11-01"']) expect(lines).toContain(l)
    expect(markdown.startsWith('# Lame\n')).toBe(true)
    const sub = (s: string) => expect(markdown).toContain(s)
    sub('| ID | H-0001 |'); sub('| Status | Rooted |'); sub('| Target | 10.10.10.3 |')
    sub('**Foothold:** anon FTP'); sub('**Privilege escalation:** not recorded')
  })

  it('steps in position order, blank steps dropped, ordinal only when a phase repeats', () => {
    const box = seedBox()
    db.prepare("INSERT INTO steps (box_id, phase, position, body) VALUES (?, 'Lateral Movement', 5, 'pivot'), (?, 'Root', 6, 'again')").run(box, box)
    const { markdown } = reportOf(db, { col: 'box_id', id: box }, today)
    const at = (s: string) => markdown.indexOf(s)
    expect(at('## Recon 1')).toBeGreaterThan(-1)
    expect(at('## Recon 1')).toBeLessThan(at('## Initial Access\n'))
    expect(at('## Initial Access\n')).toBeLessThan(at('## Root 1'))
    expect(at('## Root 1')).toBeLessThan(at('## Lateral Movement\n'))
    expect(at('## Lateral Movement\n')).toBeLessThan(at('## Root 2'))
    expect(markdown).not.toContain('## PrivEsc')
    expect(markdown).not.toContain('## Recon 2') // blank, so dropped, but it still counts for Recon 1's ordinal
    expect(markdown).not.toContain('### Recon') // steps are ## sections now, not nested under a phase heading
  })

  it('DNS renders from the box', () => {
    const box = seedBox()
    db.prepare("UPDATE boxes SET dns = 'lame.htb' WHERE id = ?").run(box)
    db.prepare("UPDATE steps SET body = 'ffuf -u http://{{DNS}}/FUZZ' WHERE box_id = ? AND phase = 'Root'").run(box)
    expect(reportOf(db, { col: 'box_id', id: box }, today).markdown).toContain('ffuf -u http://lame.htb/FUZZ')
  })

  it('placeholders use the owner IP and the context', () => {
    const { markdown } = reportOf(db, { col: 'box_id', id: seedBox() }, today)
    expect(markdown).toContain('nmap 10.10.10.3')
    expect(markdown).toContain('nc 10.10.14.2 4444')
    expect(markdown.slice(markdown.indexOf('## Notes'))).toContain('creds in 10.10.10.3 notes')
  })

  it('missing target is left as typed', () => {
    const { markdown } = reportOf(db, { col: 'box_id', id: seedBox(null) }, today)
    expect(markdown).toContain('nmap {{TARGET}}')
    expect(markdown).toContain('| Target | not set |')
  })

  it('technique line', () => {
    const { markdown } = reportOf(db, { col: 'box_id', id: seedBox() }, today)
    const recon = markdown.slice(markdown.indexOf('## Recon 1'), markdown.indexOf('## Initial Access'))
    expect(recon).toContain('_Techniques: Kerberoasting (Rubeus, Impacket); SUID abuse_')
    expect(markdown.match(/_Techniques:/g)).toHaveLength(1)
  })

  it('pipes are escaped in loot cells only', () => {
    const box = seedBox()
    db.prepare("UPDATE steps SET body = 'a | b' WHERE phase = 'Root'").run()
    const { markdown } = reportOf(db, { col: 'box_id', id: box }, today)
    expect(markdown).toContain('| svc\\|user | password | P@ss\\|word | found in db |')
    expect(markdown).toContain('a | b')
    expect(markdown).not.toContain('a \\| b')
  })

  it('flag values never appear', () => {
    const { frontmatter, markdown } = reportOf(db, { col: 'box_id', id: seedBox() }, today)
    expect(markdown).not.toContain('deadbeef')
    expect(frontmatter).not.toContain('deadbeef')
    expect(markdown).toContain('| user (value redacted) |')
  })

  it('flag values typed into steps or notes are redacted', () => {
    const box = seedBox()
    db.prepare("UPDATE steps SET body = 'cat root.txt: deadbeefcafe' WHERE phase = 'Root'").run()
    db.prepare("UPDATE boxes SET notes = 'flag deadbeefcafe and deadbeefcafe' WHERE id = ?").run(box)
    const { markdown } = reportOf(db, { col: 'box_id', id: box }, today)
    expect(markdown).not.toContain('deadbeef')
    expect(markdown).toContain('cat root.txt: [flag redacted]')
    expect(markdown).toContain('flag [flag redacted] and [flag redacted]')
  })

  it('short flag values are left alone', () => {
    const box = seedBox()
    db.prepare("INSERT INTO flags (box_id, label, value) VALUES (?, 'root', ' root ')").run(box)
    db.prepare("UPDATE steps SET body = 'became root' WHERE phase = 'Root'").run()
    expect(reportOf(db, { col: 'box_id', id: box }, today).markdown).toContain('became root')
  })

  it('a host report redacts flags of other hosts in the network', () => {
    const { net, h1, h2 } = seedHost()
    db.prepare("INSERT INTO flags (network_id, host_id, label, value) VALUES (?, ?, 'db', 'cafebabe1234')").run(net, h2)
    db.prepare("INSERT INTO steps (host_id, phase, position, body) VALUES (?, 'Recon', 0, 'saw cafebabe1234')").run(h1)
    const { markdown } = reportOf(db, { col: 'host_id', id: h1 }, today)
    expect(markdown).toContain('saw [flag redacted]')
  })

  it('loop lines print in order under the heading and skip empty ones', () => {
    const { markdown } = reportOf(db, { col: 'box_id', id: seedBox('10.10.10.3', 'Lame', { 'Initial Access': { saw: 'port 80', tried: 'ffuf {{TARGET}}' } }) }, today)
    expect(markdown).toContain('## Initial Access\n\n**Saw:** port 80\n\n**Tried:** ffuf 10.10.10.3\n\nnc 10.10.14.2 4444')
    expect(markdown).not.toContain('**Think:**')
  })

  it('a step with lines and no body prints', () => {
    const box = seedBox('10.10.10.3', 'Lame', { Root: { got: 'nothing' } })
    db.prepare("UPDATE steps SET body = '' WHERE phase = 'Root'").run()
    expect(reportOf(db, { col: 'box_id', id: box }, today).markdown).toContain('## Root\n\n**Got:** nothing')
  })

  it("dead end suffix and the What didn't work section", () => {
    const box = seedBox('10.10.10.3', 'Lame', { PrivEsc: { dead: 1, saw: 'login page', tried: 'defaults', got: 'rate limited' } })
    const { markdown } = reportOf(db, { col: 'box_id', id: box }, today)
    expect(markdown).toContain('## PrivEsc (dead end)')
    expect(markdown).toContain("## What didn't work\n\n- **PrivEsc** — Saw: login page · Tried: defaults · Got: rate limited")
    expect(markdown.indexOf('## Loot')).toBeLessThan(markdown.indexOf("## What didn't work"))
    expect(markdown.indexOf("## What didn't work")).toBeLessThan(markdown.indexOf('## Notes'))
    db.prepare('UPDATE steps SET dead = 0').run()
    expect(reportOf(db, { col: 'box_id', id: box }, today).markdown).not.toContain("What didn't work")
  })

  it('dead steps without lines still get a bullet', () => {
    const { markdown } = reportOf(db, { col: 'box_id', id: seedBox('10.10.10.3', 'Lame', { Root: { dead: 1 }, PrivEsc: { dead: 1 } }) }, today)
    expect(markdown).toContain('- **Root** — no notes')
    expect(markdown).toContain('- **PrivEsc** — no notes')
    expect(markdown).toContain('## Root (dead end)')
    expect(markdown).not.toContain('## PrivEsc')
  })

  it('lines are redacted', () => {
    const { markdown } = reportOf(db, { col: 'box_id', id: seedBox('10.10.10.3', 'Lame', { PrivEsc: { dead: 1, got: 'flag is deadbeefcafe' } }) }, today)
    expect(markdown).toContain('**Got:** flag is [flag redacted]')
    expect(markdown).toContain('Got: flag is [flag redacted]')
    expect(markdown).not.toContain('deadbeef')
  })

  it('empty sections are omitted', () => {
    const box = Number(db.prepare("INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('T-0001', 'THM', 'Room', 'Easy')").run().lastInsertRowid)
    db.prepare("INSERT INTO steps (box_id, phase, position, body) VALUES (?, 'Recon', 0, 'look')").run(box)
    const { markdown } = reportOf(db, { col: 'box_id', id: box }, today)
    expect(markdown).not.toContain('## Summary')
    expect(markdown).not.toContain('## Loot')
    expect(markdown).not.toContain('## Notes')
    expect(markdown).toContain('## Recon\n')
  })

  it('frontmatter survives a colon', () => {
    const { frontmatter } = reportOf(db, { col: 'box_id', id: seedBox('10.10.10.3', 'Re: "Lame"') }, today)
    expect(frontmatter.split('\n')).toContain('title: "Re: \\"Lame\\""')
  })

  it('host report', () => {
    const { h1 } = seedHost()
    db.prepare("INSERT INTO host_ips (host_id, ip, is_primary) VALUES (?, '10.10.110.5', 1), (?, '172.16.1.5', 0)").run(h1, h1)
    const { frontmatter, markdown } = reportOf(db, { col: 'host_id', id: h1 }, today)
    expect(frontmatter.split('\n')).toContain('network: "Dante"')
    expect(frontmatter.endsWith('\n')).toBe(false)
    expect(frontmatter).not.toMatch(/^(platform|difficulty|started):/m)
    expect(markdown.startsWith('# WEB01\n')).toBe(true)
    expect(markdown).toContain('| Target | 10.10.110.5, 172.16.1.5 |')
  })

  it('host loot is filtered to the host', () => {
    const { net, h1, h2 } = seedHost()
    const cred = db.prepare("INSERT INTO credentials (network_id, username, kind, secret, found_on_host_id) VALUES (?, ?, 'password', 'x', ?)")
    cred.run(net, 'alice', h1); cred.run(net, 'bob', h2)
    const flag = db.prepare("INSERT INTO flags (network_id, host_id, label, value) VALUES (?, ?, ?, 'v')")
    flag.run(net, h1, 'web-flag'); flag.run(net, h2, 'db-flag')
    const { markdown } = reportOf(db, { col: 'host_id', id: h1 }, today)
    expect(markdown).toContain('alice')
    expect(markdown).not.toContain('bob')
    expect(markdown).toContain('web-flag (value redacted)')
    expect(markdown).not.toContain('db-flag')
  })

  it('unknown owner throws 404', () => {
    expect(() => reportOf(db, { col: 'box_id', id: 99 }, today)).toThrow(/not found/)
    expect(() => reportOf(db, { col: 'host_id', id: 99 }, today)).toThrow(/not found/)
  })

  it('summary lines are redacted', () => {
    const box = seedBox()
    db.prepare("UPDATE boxes SET foothold = ' read deadbeefcafe off FTP ' WHERE id = ?").run(box)
    const { markdown } = reportOf(db, { col: 'box_id', id: box }, today)
    expect(markdown).toContain('**Foothold:** read [flag redacted] off FTP')
    expect(markdown).not.toContain('deadbeefcafe')
  })
})

describe('networkReportOf', () => {
  // seedHost plus a primary IP on WEB01.
  const seed = () => {
    const s = seedHost()
    db.prepare("INSERT INTO host_ips (host_id, ip, is_primary) VALUES (?, '10.10.110.10', 1)").run(s.h1)
    return s
  }
  const flag = (net: number, label: string, value: string, host: number | null = null) =>
    db.prepare('INSERT INTO flags (network_id, host_id, label, value) VALUES (?, ?, ?, ?)').run(net, host, label, value)

  it('facts, frontmatter, flags and machines', () => {
    const { net, h1 } = seed()
    db.prepare(`UPDATE networks SET url = 'https://app.hackthebox.com/prolabs/overview/dante', entry = 'VPN 10.10.110.0/24',
      hosts_in_scope = 14, flags_in_scope = 26, tags = '["Active Directory"]'`).run()
    db.prepare("UPDATE hosts SET status = 'rooted' WHERE id = ?").run(h1)
    flag(net, 'WEB01 user', 'abcdef123456', h1)
    flag(net, 'DC01 root', '')
    const { frontmatter, markdown } = networkReportOf(db, net, today)
    const lines = frontmatter.split('\n')
    for (const l of ['title: "Dante"', 'id: "N-0001"', 'platform: "HTB"', 'machines: 14', 'flags: 26', 'entry: "VPN 10.10.110.0/24"',
      'tags: ["Active Directory"]', 'exported: "2026-11-01"']) expect(lines).toContain(l)
    const sub = (s: string) => expect(markdown).toContain(s)
    sub('| Platform | [HTB](https://app.hackthebox.com/prolabs/overview/dante) |'); sub('| Machines | 1 of 14 |'); sub('| Flags | 1 of 26 |')
    sub('| Entry point | VPN 10.10.110.0/24 |'); sub('| Hosts found | 2 |')
    sub('## Flags'); sub('| 1 | WEB01 user | X |'); sub('| 2 | DC01 root |  |')
    expect(markdown).not.toContain('abcdef123456')
    expect(frontmatter).not.toContain('abcdef123456')
    sub('## Machines'); sub('| [WEB01](#web01) | Linux | 10.10.110.10 | Yes |'); sub('| [DB01](#db01) | Linux |  |  |')
  })

  it('chapters demote headings, skip facts and loot, keep fences, link back', () => {
    const { net, h1 } = seed()
    db.prepare("INSERT INTO steps (host_id, phase, position, body) VALUES (?, 'Recon', 0, ?)").run(h1, 'nmap\n```\n# not a heading\n```')
    flag(net, 'web', 'v', h1)
    const { markdown } = networkReportOf(db, net, today)
    expect(markdown.indexOf('## WEB01')).toBeGreaterThan(markdown.indexOf('## Machines'))
    expect(markdown).toContain('### Recon')
    expect(markdown).toContain('\n# not a heading\n')
    expect(markdown).not.toContain('Loot')
    expect(markdown).not.toContain('| ID |')
    expect(markdown.match(/\[Back to Machines\]\(#machines\)/g)).toHaveLength(2)
    expect(markdown).toContain('## DB01')
    expect(markdown).toContain('[Back to Machines](#machines)\n\n---\n\n## DB01')
    expect(markdown).toContain('[Back to Machines](#machines)\n\n---\n')
  })

  it('a host named like a section still links', () => {
    const { net, h2 } = seed()
    db.prepare("UPDATE hosts SET name = 'Flags' WHERE id = ?").run(h2)
    flag(net, 'x', '')
    const { markdown } = networkReportOf(db, net, today)
    expect(markdown).toContain('| [Flags](#flags-1) |')
    expect(markdown.match(/^## Flags$/gm)).toHaveLength(2)
  })

  it('credentials and notes', () => {
    const { net, h1, h2 } = seed()
    const cred = Number(db.prepare("INSERT INTO credentials (network_id, username, kind, secret, found_on_host_id) VALUES (?, 'svc', 'password', 'P@ss', ?)").run(net, h1).lastInsertRowid)
    db.prepare("INSERT INTO credential_results (credential_id, host_id, result) VALUES (?, ?, 'works')").run(cred, h2)
    db.prepare("UPDATE networks SET notes = 'use HTB{abcdef} on DC01 {{TARGET}}' WHERE id = ?").run(net)
    flag(net, 'f', 'HTB{abcdef}')
    const { markdown } = networkReportOf(db, net, today)
    expect(markdown).toContain('## Credentials')
    expect(markdown).toContain('| svc | password | P@ss | DB01 |')
    const notes = markdown.slice(markdown.indexOf('## Notes'))
    expect(notes).toContain('use [flag redacted] on DC01 {{TARGET}}')
    expect(markdown).not.toContain('HTB{abcdef}')
  })

  it('empty network', () => {
    const net = Number(db.prepare("INSERT INTO networks (short_id, platform, name) VALUES ('N-0001', 'HTB', 'Dante')").run().lastInsertRowid)
    const { markdown } = networkReportOf(db, net, today)
    expect(markdown.startsWith('# Dante\n\n| Field | Value |')).toBe(true)
    for (const s of ['## Flags', '## Machines', '## Credentials', '## Notes']) expect(markdown).not.toContain(s)
  })

  it('unknown network throws', () => {
    expect(() => networkReportOf(db, 999, today)).toThrow(/not found/)
  })

  it('an unclosed fence in a step body or notes is closed before the next chapter', () => {
    const { net, h1 } = seed()
    db.prepare("INSERT INTO steps (host_id, phase, position, body) VALUES (?, 'Recon', 0, ?)").run(h1, '```\nnc -lvnp 4444')
    db.prepare("UPDATE hosts SET notes = '~~~~\nkeep' WHERE id = ?").run(h1)
    db.prepare("UPDATE networks SET notes = '```sh\ntail' WHERE id = ?").run(net)
    const { markdown } = networkReportOf(db, net, today)
    expect(markdown).toContain('nc -lvnp 4444\n```\n')
    expect(markdown).toContain('keep\n~~~~\n')
    expect(markdown.indexOf('keep\n~~~~')).toBeLessThan(markdown.indexOf('## DB01'))
    expect(markdown.endsWith('tail\n```\n')).toBe(true)
  })

  it('~~~ and longer ``` fences hide headings from demotion', () => {
    const { net, h1 } = seed()
    db.prepare("INSERT INTO steps (host_id, phase, position, body) VALUES (?, 'Recon', 0, ?)")
      .run(h1, '~~~\n# not a heading\n~~~\n\n````\n```\n# still code\n````\n\n# Real')
    const { markdown } = networkReportOf(db, net, today)
    expect(markdown).toContain('\n# not a heading\n')
    expect(markdown).toContain('\n# still code\n')
    expect(markdown).toContain('\n## Real')
  })

  it('every in-page link resolves to a heading id the renderer gives', () => {
    // The web preview's renderer: markdown-it plus the heading_ids rule from web/src/box/StepSection.tsx.
    const md = new MarkdownIt({ html: false, linkify: true })
    md.core.ruler.push('heading_ids', (state) => {
      const slug = slugger()
      state.tokens.forEach((t, i) => { if (t.type === 'heading_open') t.attrSet('id', slug(state.tokens[i + 1].content)) })
    })
    const { net, h1, h2 } = seedHost()
    db.prepare("UPDATE networks SET name = 'Machines', notes = '## WEB01' WHERE id = ?").run(net)
    db.prepare("UPDATE hosts SET name = 'Flags' WHERE id = ?").run(h2)
    db.prepare("INSERT INTO hosts (short_id, network_id, name) VALUES ('HS-0003', ?, 'WEB01')").run(net)
    flag(net, 'x', '')
    const step = db.prepare("INSERT INTO steps (host_id, phase, position, body) VALUES (?, 'Recon', ?, ?)")
    step.run(h1, 0, '## WEB01\n\n# Flags\n\n```\n# not\n```\n\n### Machines')
    step.run(h1, 1, '```\nnc -lvnp 4444') // unclosed: must not swallow the chapters after it
    const html = md.render(networkReportOf(db, net, today).markdown)
    const ids = [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1])
    const hrefs = [...html.matchAll(/href="#([^"]*)"/g)].map((m) => decodeURIComponent(m[1]))
    expect(hrefs).toEqual(expect.arrayContaining(['web01', 'flags-2', 'web01-2', 'machines-1']))
    for (const h of hrefs) expect(ids).toContain(h)
    expect(ids).toEqual(expect.arrayContaining(['flags-2', 'web01-2', 'notes', 'web01-3']))
    expect(ids).not.toContain('not')
  })

  it('host report hides expected flags', () => {
    const { net, h1 } = seedHost()
    flag(net, 'x', '', h1)
    expect(reportOf(db, { col: 'host_id', id: h1 }, today).markdown).not.toContain('### Flags')
  })
})

describe('local dates', () => {
  it('reports the server-local day, SQLite UTC strings included', () => {
    db = openDb(':memory:')
    const id = seedBox()
    db.prepare("UPDATE boxes SET rooted_at = '2026-11-01T22:30:00.000Z' WHERE id = ?").run(id)
    expect(reportOf(db, { col: 'box_id', id }, today).frontmatter).toContain('rooted: "2026-11-02"')
    db.prepare("INSERT INTO flags (box_id, label, value, captured_at) VALUES (?, 'priv', 'abcdefgh', '2026-11-01 22:30:00')").run(id)
    expect(reportOf(db, { col: 'box_id', id }, today).markdown).toContain('| priv (value redacted) |  | 2026-11-02 |')
  })
})
