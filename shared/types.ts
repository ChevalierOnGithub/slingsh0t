export const PHASES = ['Recon', 'Initial Access', 'PrivEsc', 'Lateral Movement', 'Root', 'Persistence'] as const
export type Phase = (typeof PHASES)[number]
/** Which targets a technique is offered on; the toolbox hides it elsewhere. */
export type Applies = 'any' | 'linux' | 'windows' | 'ad'
export const APPLIES: Applies[] = ['any', 'linux', 'windows', 'ad']

export const SERVICES = ['http', 'smb', 'ssh', 'ftp', 'dns', 'ldap', 'kerberos', 'rdp', 'winrm', 'nfs', 'smtp', 'snmp', 'mysql', 'mssql'] as const  // suggestions; a technique's service may be any slug
export const HAVES = ['web app', 'version', 'creds', 'hash', 'shell', 'admin', 'domain creds'] as const
export type Have = (typeof HAVES)[number]
export const INTENTS = ['discover', 'enumerate', 'authenticate', 'exploit', 'pivot', 'dump', 'transfer', 'tune'] as const
export type Intent = (typeof INTENTS)[number] | ''
/** An open service on a box or host; name is a lowercase slug. */
export type BoxService = { name: string; port: number | null }

export const AD_TAG = 'Active Directory'
export type Platform = 'HTB' | 'THM'
export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Insane'
export type BoxStatus = 'not_started' | 'in_progress' | 'user_flag' | 'rooted'

export interface Context {
  target: string; lhost: string; lport: string; activeBoxId: number | null
  activeHostId: number | null; via: string | null
}

export interface BoxSummary {
  id: number; shortId: string; platform: Platform; name: string; os: string
  difficulty: Difficulty; status: BoxStatus; targetIp: string | null; totalSeconds: number
  releaseDate: string | null; dns: string; url: string
}

/** timerStartedAt is epoch seconds */
export interface Step {
  id: number; boxId: number | null; hostId: number | null; phase: Phase; position: number; body: string
  seconds: number; timerStartedAt: number | null; done: boolean
  saw: string; think: string; tried: string; got: string; dead: boolean
}

export interface TechniqueUse { id: number; techniqueId: number; stepId: number; toolIds: number[] | null }

export interface BoxDetail extends BoxSummary {
  kind: 'box'; tags: string[]; nextStep: string; notes: string
  foothold: string; privesc: string; rating: string
  startedAt: string | null; rootedAt: string | null
  steps: Step[]; uses: TechniqueUse[]; services: BoxService[]; haves: Have[]
}

export interface Command { id: number; purpose: string; template: string; procedureKey: string | null; position: number | null; intent: Intent }
export interface ToolNode { id: number; shortId: string; name: string; commands: Command[] }
export interface TechniqueNode {
  id: number; shortId: string; name: string; phase: Phase; description: string; position: number; applies: Applies
  service: string; needs: Have[]; yields: Have[]
  commands: Command[]; tools: ToolNode[]; uses: TechniqueUse[]
}
export interface Toolbox { phases: { phase: Phase; techniques: TechniqueNode[] }[] }

export interface SearchHit { kind: 'box' | 'step' | 'technique' | 'tool' | 'command' | 'reference' | 'host' | 'credential' | 'network'; id: number; boxId: number | null; hostId: number | null; toolId: number | null; title: string; snippet: string; total: number }

type ByDifficulty = Record<Difficulty, number>
export interface Stats {
  boxes: number; techniques: number; tools: number; writeups: number; reference: number
  /** loot = credentials across every network and box */
  networks: number; loot: number
  rooted: Record<Platform, ByDifficulty>
  inProgress: Record<Platform, ByDifficulty>
  totals: Record<Platform, { rooted: number; total: number }>
}

export interface TechniqueListItem {
  id: number; shortId: string; name: string; phase: Phase; description: string; position: number; applies: Applies
  service: string; needs: Have[]; yields: Have[]
  /** Commands of the technique itself (no tool). */
  commands: Command[]; tools: { id: number; name: string }[]
  uses: { boxId: number | null; hostId: number | null; ownerName: string; stepId: number; phase: Phase; ordinal: number; dead: boolean }[]
}
export interface ToolListItem {
  id: number; shortId: string; name: string; description: string
  commands: Command[]; techniques: { id: number; name: string }[]
}
export interface WriteupListItem {
  kind: 'box' | 'network'; id: number; shortId: string; name: string; platform: Platform; status: string
  filledSteps: number; totalSteps: number; updatedAt: string
}
export interface ReferencePage { id: number; title: string; body: string }
export interface UnsortedItem { id: number; sourcePage: string; content: string }

export type CredentialKind = 'password' | 'ntlm' | 'kerberos' | 'ssh_key' | 'other'
export type CredentialScope = { networkId: number } | { boxId: number }
export interface CredentialResult { hostId: number; name: string; result: 'works' | 'failed' }
export interface Credential {
  id: number; username: string; kind: CredentialKind; secret: string
  foundOn: { hostId: number; name: string } | null; foundNote: string
  scope: CredentialScope; results: CredentialResult[]; untested: number
  /** Box credentials only: the SERVICES it works on (a box is one machine, so no per-host results). */
  worksOn: string[]
}
export interface Flag {
  id: number; label: string; value: string; hostId: number | null; capturedAt: string; scope: CredentialScope
}
export interface LootItem extends Credential { scopeName: string; scopeShortId: string }
export interface Subnet { id: number; networkId: number; cidr: string }
export interface Pivot { id: number; fromHostId: number; subnetId: number; method: string; note: string }
/** What BoxPage, Writeup and Toolbox read; a BoxDetail or a HostDetail. */
export interface WorkItem {
  id: number; shortId: string; kind: 'box' | 'host'; name: string; os: string; status: BoxStatus; tags: string[]; dns: string
  nextStep: string; notes: string; foothold: string; privesc: string; rating: string; targetIp: string | null; steps: Step[]; uses: TechniqueUse[]
  services: BoxService[]; haves: Have[]
}
export interface HostIp { id: number; ip: string; primary: boolean }
export interface HostDetail extends WorkItem { kind: 'host'; networkId: number; ips: HostIp[] }
export interface NetworkSummary {
  id: number; shortId: string; platform: Platform | 'Other'; name: string
  hostsInScope: number | null; flagsInScope: number | null; url: string
  hostsFound: number; hostsOwned: number; flagsCaptured: number; credentials: number
}
export interface NetworkHost { id: number; shortId: string; name: string; os: string; status: BoxStatus; ips: HostIp[] }
export interface NetworkDetail extends NetworkSummary {
  tags: string[]; notes: string; entry: string; hosts: NetworkHost[]
  subnets: { id: number; cidr: string }[]
  pivots: { id: number; fromHostId: number; subnetId: number; method: string; note: string }[]
}

export interface NetworkPreset {
  id: string
  platform: 'HTB' | 'THM'
  name: string
  hostsInScope: number | null
  flagsInScope: number | null
  source: string
  /** The lab page; also what the imported network links to. */
  url: string
  /** Tags the network starts with (Active Directory for AD labs). */
  tags?: string[]
}

export interface Attachment { key: string; name: string; mime: string; size: number; createdAt: string }
