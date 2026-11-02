export type Os = 'linux' | 'windows' | 'mac'
export type Tab = 'reverse' | 'msfvenom' | 'assembled'
export type Encoding = 'raw' | 'url' | 'base64' | 'bashb64' | 'psenc'
export type Wrap = 'direct' | 'bash' | 'cmd'
export type Format = 'c' | 'python' | 'csharp' | 'powershell' | 'hex' | 'raw'
export type Asm = { badChars: string; encoder: string; iterations: number; nops: number; format: Format }
export interface Payload { name: string; command: string; os: Os[]; tags: string[]; listener?: string }
export interface Catalog {
  reverse: Payload[]; msfvenom: Payload[]; assembled: Payload[]
  listeners: [name: string, command: string][]
  shells: string[]
  special: { ps: string; psStderr: string }
}
