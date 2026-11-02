import Fastify from 'fastify'
import { expect, test } from 'vitest'
import { openDb } from '../db'
import type { Stats } from '../../shared/types'
import { pagesRoutes } from './pages'
import { statsRoutes } from './stats'

test('stats counts match seeded rows', async () => {
  const db = openDb(':memory:')
  const app = Fastify()
  await app.register(statsRoutes, { db })
  db.exec(`INSERT INTO boxes (short_id, platform, name, difficulty, status) VALUES
      ('H-0001','HTB','A','Easy','rooted'), ('H-0002','HTB','B','Hard','in_progress'), ('T-0001','THM','C','Easy','rooted'), ('T-0002','THM','D','Easy','not_started');
    INSERT INTO steps (box_id, phase, position, body) VALUES (1,'Recon',0,'x'), (1,'Root',1,'y'), (2,'Recon',0,'  '), (3,'Recon',0,'z');
    INSERT INTO techniques (short_id, name, phase) VALUES ('TQ-001','T','Recon');
    INSERT INTO tools (short_id, name) VALUES ('TL-001','Reverse shells'), ('TL-002','nmap');
    INSERT INTO commands (tool_id, template) VALUES (1,'a'), (1,'b'), (2,'c');
    INSERT INTO reference_pages (title, body) VALUES ('r','b');
    INSERT INTO networks (short_id, platform, name) VALUES ('N-001','HTB','Dante');
    INSERT INTO credentials (network_id, username, kind, secret) VALUES (1,'a','password','x');
    INSERT INTO credentials (box_id, username, kind, secret) VALUES (1,'b','ntlm','y');`)
  const s = (await app.inject({ url: '/api/stats' })).json<Stats>()
  expect(s).not.toHaveProperty('reverseShells')
  expect(s).toMatchObject({ boxes: 4, techniques: 1, tools: 2, writeups: 2, reference: 1, networks: 1, loot: 2 })
  expect(s.rooted.HTB).toEqual({ Easy: 1, Medium: 0, Hard: 0, Insane: 0 })
  expect(s.rooted.THM.Easy).toBe(1)
  expect(s.inProgress.HTB.Hard).toBe(1)
  expect(s.totals).toEqual({ HTB: { rooted: 1, total: 2 }, THM: { rooted: 1, total: 2 } })
})

test('writeups count agrees with the Writeups page: networks and loop-only steps count', async () => {
  const db = openDb(':memory:')
  const app = Fastify()
  await app.register(statsRoutes, { db })
  await app.register(pagesRoutes, { db })
  db.exec(`INSERT INTO networks (short_id, platform, name) VALUES ('N-001','HTB','Dante');
    INSERT INTO hosts (short_id, network_id, name) VALUES ('HS-1',1,'WEB01');
    INSERT INTO steps (host_id, phase, position, saw) VALUES (1,'Recon',0,'port 80');
    INSERT INTO boxes (short_id, platform, name, difficulty) VALUES ('H-0001','HTB','A','Easy'), ('H-0002','HTB','B','Easy');
    INSERT INTO steps (box_id, phase, position, got) VALUES (1,'Recon',0,'shell');
    INSERT INTO steps (box_id, phase, position, think, body) VALUES (2,'Recon',0,char(10) || char(9), ' ');`)
  expect((await app.inject({ url: '/api/stats' })).json<Stats>().writeups).toBe(2)
  expect((await app.inject({ url: '/api/writeups' })).json<unknown[]>()).toHaveLength(2)
})
