import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { libraryRoutes } from './library'
import { pagesRoutes } from './pages'

let app: ReturnType<typeof Fastify>
let db: ReturnType<typeof openDb>
let stepId: number
let techId: number

const toolbox = async (boxId = 1) => (await app.inject(`/api/toolbox?boxId=${boxId}`)).json()
const use = (body: object) => app.inject({ method: 'POST', url: '/api/technique-uses', payload: body })

beforeEach(async () => {
  db = openDb(':memory:')
  db.exec(`
    INSERT INTO boxes (id, short_id, platform, name, difficulty, status) VALUES (1,'H-0001','HTB','Box','Easy','in_progress');
    INSERT INTO steps (id, box_id, phase, position) VALUES (1,1,'Recon',1);
    INSERT INTO techniques (id, short_id, name, phase) VALUES (1,'TQ-901','Port scanning','Recon'),(2,'TQ-902','SeBackupPrivilege abuse','PrivEsc');
    INSERT INTO tools (id, short_id, name) VALUES (1,'TL-001','nmap');
    INSERT INTO technique_tools VALUES (1,1);
    INSERT INTO commands (tool_id, technique_id, template, procedure_key, position) VALUES (1,NULL,'second','p',2),(1,NULL,'first','p',1),(NULL,2,'reg save','x',1);
  `)
  stepId = 1; techId = 1
  app = Fastify()
  app.register(libraryRoutes, { db })
  app.register(pagesRoutes, { db })
  await app.ready()
})

describe('toolbox', () => {
  it('orders phases, commands and nests tools', async () => {
    const t = await toolbox()
    expect(t.phases.map((p: any) => p.phase)).toEqual(['Recon', 'Initial Access', 'PrivEsc', 'Lateral Movement', 'Root'])
    const nmap = t.phases[0].techniques[0].tools[0]
    expect(nmap.commands.map((c: any) => c.template)).toEqual(['first', 'second'])
    const priv = t.phases[2].techniques[0]
    expect(priv.commands).toHaveLength(1)
    expect(priv.tools).toHaveLength(0)
  })

  it('adds Persistence for AD boxes', async () => {
    db.prepare(`UPDATE boxes SET tags='["Active Directory"]'`).run()
    expect((await toolbox()).phases.map((p: any) => p.phase)).toContain('Persistence')
  })

  it('404s unknown box, 400s bad id', async () => {
    expect((await app.inject('/api/toolbox?boxId=99')).statusCode).toBe(404)
    expect((await app.inject('/api/toolbox?boxId=x')).statusCode).toBe(400)
  })

  it('uses: create, duplicate 409, delete, validation', async () => {
    const r = await use({ techniqueId: techId, stepId })
    expect(r.statusCode).toBe(201)
    expect(r.json()).toMatchObject({ techniqueId: 1, stepId: 1, toolIds: null })
    expect((await toolbox()).phases[0].techniques[0].uses).toHaveLength(1)
    expect((await use({ techniqueId: techId, stepId })).statusCode).toBe(409)
    expect((await use({ techniqueId: 'a', stepId })).statusCode).toBe(400)
    expect((await use({ techniqueId: 99, stepId })).statusCode).toBe(404)
    expect((await use({ techniqueId: 2, stepId: 99 })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/technique-uses/${r.json().id}` })).statusCode).toBe(204)
    expect((await toolbox()).phases[0].techniques[0].uses).toHaveLength(0)
    const missing = await app.inject({ method: 'DELETE', url: '/api/technique-uses/99999' })
    expect([missing.statusCode, missing.json().message]).toEqual([404, 'technique use not found'])
  })

  it('rooted box shows only used techniques and filtered tools', async () => {
    await use({ techniqueId: techId, stepId })
    db.prepare(`UPDATE boxes SET status='rooted'`).run()
    const t = await toolbox()
    expect(t.phases.map((p: any) => p.phase)).toEqual(['Recon'])
    expect(t.phases[0].techniques[0].tools).toHaveLength(1)
    db.prepare('DELETE FROM technique_uses').run()
    await use({ techniqueId: techId, stepId, toolIds: [] })
    const t2 = await toolbox()
    expect(t2.phases[0].techniques[0].name).toBe('Port scanning')
    expect(t2.phases[0].techniques[0].tools).toHaveLength(0)
  })

  it('rooted: a use without a tool list keeps all tools; tool lists are unioned', async () => {
    db.exec(`INSERT INTO tools (id, short_id, name) VALUES (2,'TL-002','masscan'),(3,'TL-003','Rustscan');
      INSERT INTO technique_tools VALUES (1,2),(1,3);
      INSERT INTO steps (id, box_id, phase, position) VALUES (2,1,'Recon',2),(3,1,'Recon',3);`)
    await use({ techniqueId: techId, stepId: 1, toolIds: [2] })
    await use({ techniqueId: techId, stepId: 2, toolIds: [3] })
    db.prepare(`UPDATE boxes SET status='rooted'`).run()
    const names = async () => (await toolbox()).phases[0].techniques[0].tools.map((t: any) => t.name)
    expect(await names()).toEqual(['masscan', 'Rustscan'])
    await use({ techniqueId: techId, stepId: 3 })
    expect(await names()).toEqual(['masscan', 'nmap', 'Rustscan']) // NOCASE: Rustscan after nmap
  })

  it('rooted AD box keeps a used Persistence technique', async () => {
    db.exec(`UPDATE boxes SET tags='["Active Directory"]';
      INSERT INTO techniques (id, short_id, name, phase) VALUES (3,'TQ-903','Golden ticket','Persistence');
      INSERT INTO steps (id, box_id, phase, position) VALUES (2,1,'Persistence',2);`)
    await use({ techniqueId: 3, stepId: 2 })
    db.prepare(`UPDATE boxes SET status='rooted'`).run()
    expect((await toolbox()).phases.map((p: any) => p.phase)).toEqual(['Persistence'])
  })

  it("a tool's commands for another technique stay out of this technique", async () => {
    db.exec(`INSERT INTO technique_tools VALUES (2,1);
      INSERT INTO commands (tool_id, technique_id, template, procedure_key, position) VALUES (1,2,'nmap --script smb-vuln*','q',1);`)
    const t = await toolbox()
    expect(t.phases[0].techniques[0].tools[0].commands.map((c: any) => c.template)).toEqual(['first', 'second'])
    expect(t.phases[2].techniques[0].tools[0].commands.map((c: any) => c.template)).toEqual(['first', 'second', 'nmap --script smb-vuln*'])
  })

  it('rejects toolIds that are not tools of the technique', async () => {
    db.exec(`INSERT INTO tools (id, short_id, name) VALUES (2,'TL-002','mimikatz')`)
    expect((await use({ techniqueId: techId, stepId, toolIds: [2] })).statusCode).toBe(400)
    expect((await use({ techniqueId: techId, stepId, toolIds: [1] })).statusCode).toBe(201)
  })

  it('toolbox follows position', async () => {
    db.exec(`UPDATE techniques SET position = 1 WHERE id = 1;
      INSERT INTO techniques (id, short_id, name, phase, position) VALUES (3,'TQ-903','Zone transfer','Recon',2);`)
    const recon = async () => (await toolbox()).phases[0].techniques.map((t: any) => t.name)
    expect(await recon()).toEqual(['Port scanning', 'Zone transfer'])
    expect((await app.inject({ method: 'PUT', url: '/api/techniques/order', payload: { ids: [3, 1] } })).statusCode).toBe(200)
    expect(await recon()).toEqual(['Zone transfer', 'Port scanning'])
    expect((await toolbox()).phases[0].techniques[0]).toMatchObject({ position: 1, applies: 'any' })
  })

  it('nodes carry service, needs, yields; commands carry intent', async () => {
    db.exec(`UPDATE techniques SET service = 'smb', needs = '["creds"]', yields = '["shell"]' WHERE id = 2;
      UPDATE commands SET intent = 'dump' WHERE technique_id = 2;`)
    const t = await toolbox()
    expect(t.phases[0].techniques[0]).toMatchObject({ service: 'any', needs: [], yields: [] })
    expect(t.phases[0].techniques[0].tools[0].commands[0].intent).toBe('')
    expect(t.phases[2].techniques[0]).toMatchObject({ service: 'smb', needs: ['creds'], yields: ['shell'] })
    expect(t.phases[2].techniques[0].commands[0].intent).toBe('dump')
  })
})

describe('POST /api/techniques', () => {
  it('creates with short id', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/techniques', payload: { name: ' Pass the hash ', phase: 'Root' } })
    expect(r.statusCode).toBe(201)
    expect(r.json().shortId).toMatch(/^TQ-\d{3}$/)
    expect(r.json()).toMatchObject({ name: 'Pass the hash', phase: 'Root', tools: [], commands: [], uses: [], service: 'any', needs: [], yields: [] })
  })
  it('takes service, needs, yields', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/techniques', payload: { name: 'Null session', phase: 'Recon', service: 'smb', needs: ['version', 'version'], yields: ['creds'] } })
    expect(r.json()).toMatchObject({ service: 'smb', needs: ['version'], yields: ['creds'] })
    expect((await app.inject('/api/techniques')).json().find((t: any) => t.name === 'Null session')).toMatchObject({ service: 'smb', needs: ['version'] })
  })
  it('validates', async () => {
    const p = (payload: object) => app.inject({ method: 'POST', url: '/api/techniques', payload })
    expect((await p({ name: '  ', phase: 'Root' })).statusCode).toBe(400)
    expect((await p({ name: 'x', phase: 'Nope' })).statusCode).toBe(400)
    expect((await p({ name: 'x', phase: 'Root', service: 'Bad Slug' })).statusCode).toBe(400)
    expect((await p({ name: 'x', phase: 'Root', needs: ['laser'] })).statusCode).toBe(400)
  })
  it('a tool command takes an intent', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/tools/1/commands', payload: { purpose: 'p', template: 'nmap -sn', intent: 'discover' } })
    expect(r.statusCode).toBe(201)
    expect(r.json().intent).toBe('discover')
  })
  it('POST gives max+1', async () => {
    db.exec(`UPDATE techniques SET position = 1 WHERE id = 1;
      INSERT INTO techniques (id, short_id, name, phase, position) VALUES (3,'TQ-903','Zone transfer','Recon',2);`)
    const r = await app.inject({ method: 'POST', url: '/api/techniques', payload: { name: 'Banner grabbing', phase: 'Recon' } })
    expect(r.json()).toMatchObject({ position: 3, applies: 'any' })
    // first in an empty phase
    expect((await app.inject({ method: 'POST', url: '/api/techniques', payload: { name: 'x', phase: 'Root' } })).json().position).toBe(1)
  })
})
