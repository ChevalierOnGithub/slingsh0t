import { expect, test } from 'vitest'
import { readSeed } from './seed'

// Every finding of the 2026-11-08 library review, pinned so a later edit can't drop one silently.
const seed = readSeed().map((f) => f.data)
const tools = seed.flatMap((f) => f.tools ?? [])
const techniques = seed.flatMap((f) => f.techniques ?? [])

/** A tool (or technique) must have a command containing each `has` string. */
type Must = { tool?: string; technique?: string; has: string[] }

const toolTemplates = (name: string) =>
  tools.filter((t) => t.name.toLowerCase() === name.toLowerCase()).flatMap((t) => (t.commands ?? []).map((c) => c.template))

/** A tool's commands; for a technique, its own commands plus those of its linked tools. */
function templatesOf(m: Must): string[] {
  if (m.tool) return toolTemplates(m.tool)
  const t = techniques.find((x) => x.name === m.technique)
  return t ? [...(t.commands ?? []).map((c) => c.template), ...(t.tools ?? []).flatMap(toolTemplates)] : []
}
const allTemplates = () => [...tools, ...techniques].flatMap((t) => (t.commands ?? []).map((c) => c.template))
/** Every tool name and every technique `tools` entry. */
const allToolRefs = () => [...tools.map((t) => t.name), ...techniques.flatMap((t) => t.tools ?? [])]

const MUST: Must[] = [
  // Task 2: the impacket suite
  { tool: 'impacket-psexec', has: ['-hashes :<hash>', '-k -no-pass'] },
  { tool: 'impacket-wmiexec', has: ['-hashes :<hash>'] },
  { tool: 'impacket-smbexec', has: ['-hashes :<hash>'] },
  { tool: 'impacket-atexec', has: ["'whoami'", '-hashes :<hash>'] },
  { tool: 'impacket-dcomexec', has: ['-object MMC20'] },
  { tool: 'impacket-smbclient', has: ['impacket-smbclient <domain>/<user>:<pass>@{{TARGET}}', '-hashes :<hash>'] },
  { tool: 'impacket-mssqlclient', has: ['-windows-auth', '-hashes :<hash>'] },
  { tool: 'impacket-secretsdump', has: ['-just-dc', '-ntds ntds.dit', 'impacket-secretsdump <domain>/<user>:<pass>@{{TARGET}}'] },
  { tool: 'impacket-lookupsid', has: ['guest@{{TARGET}} -no-pass'] },
  { tool: 'impacket-samrdump', has: ['impacket-samrdump {{TARGET}}'] },
  { tool: 'impacket-rpcdump', has: ['-port 135', 'MS-RPRN'] },
  { tool: 'impacket-DumpNTLMInfo', has: ['impacket-DumpNTLMInfo {{TARGET}}'] },
  { tool: 'impacket-GetADUsers', has: ['-all'] },
  { tool: 'impacket-GetNPUsers', has: ['-usersfile', '<domain>/<user>:<pass> -request'] },
  { tool: 'impacket-GetUserSPNs', has: ['-request', '-hashes :<hash>'] },
  { tool: 'impacket-findDelegation', has: ['impacket-findDelegation'] },
  { tool: 'impacket-Get-GPPPassword', has: ['-xmlfile', '@{{TARGET}}'] },
  { tool: 'impacket-GetLAPSPassword', has: ['impacket-GetLAPSPassword'] },
  { tool: 'impacket-dacledit', has: ['-action read', '-rights FullControl', '-rights DCSync'] },
  { tool: 'impacket-owneredit', has: ['-new-owner'] },
  { tool: 'impacket-changepasswd', has: ['-newpass', '-reset -altuser'] },
  { tool: 'impacket-addcomputer', has: ['-computer-name'] },
  { tool: 'impacket-rbcd', has: ['-delegate-from'] },
  { tool: 'impacket-getST', has: ['-impersonate administrator -dc-ip {{TARGET}}', 'SLG$'] },
  { tool: 'impacket-getTGT', has: ['-hashes :<hash>', '<domain>/<user>:<pass> -dc-ip'] },
  { tool: 'impacket-ticketer', has: ['-spn <spn>', '-extra-sid <sid>-519'] },
  { tool: 'impacket-ticketConverter', has: ['.kirbi <file>.ccache', '.ccache <file>.kirbi'] },
  { tool: 'impacket-describeTicket', has: ['.ccache'] },
  { tool: 'impacket-raiseChild', has: ['impacket-raiseChild'] },
  { tool: 'impacket-reg', has: ['backup -o', 'Winlogon'] },
  { tool: 'impacket-services', has: [' list'] },
  { tool: 'impacket-smbserver', has: ['-smb2support'] },
  { tool: 'impacket-ntlmrelayx', has: ['--delegate-access', "-c '<command>'"] },
  { tool: 'impacket-dpapi', has: ['masterkey', 'credential'] },
  { technique: 'Abuse RBCD to impersonate on a host', has: ['impacket-addcomputer'] },
  { technique: 'Forge a golden ticket (domain is done)', has: ['impacket-lookupsid'] },
  { technique: 'Pivot across a domain trust', has: ['impacket-raiseChild', '-extra-sid'] },
  { technique: 'RPC enumeration', has: ['impacket-rpcdump'] },
  // Task 3: recon and web
  { tool: 'nmap', has: ['nmap -sn <subnet>'] },
  { tool: 'fping', has: ['fping -asgq <subnet>'] },
  { technique: 'Find live hosts on a subnet', has: ['nmap -sn', 'fping'] },
  { tool: 'smtp-user-enum', has: ['-M VRFY', '-M RCPT'] },
  { tool: 'dnsrecon', has: ['-r <cidr>', '-t brt'] },
  { tool: 'snmp-check', has: ['snmp-check {{TARGET}}'] },
  { tool: 'git-dumper', has: ['/.git/'] },
  { tool: 'ftp', has: ['ftp {{TARGET}}'] },
  { tool: 'tcpdump', has: ['tcpdump -ni tun0 icmp'] },
  { tool: 'exiftool', has: ['exiftool -a -u', '-Author -Creator'] },
  { technique: 'Build a custom wordlist', has: ['exiftool'] },
  { technique: 'Enumerate valid domain usernames', has: ['exiftool'] },
  { technique: 'POP3 and IMAP mailbox access', has: ['imap-capabilities', 'imaps://{{TARGET}}/INBOX;UID=1', 'pop3s://', 'openssl s_client'] },
  { technique: 'PostgreSQL access check', has: ['psql -h {{TARGET}} -U postgres', 'COPY slg FROM PROGRAM'] },
  { technique: 'MongoDB access check', has: ['mongodb-info', 'mongosh mongodb://'] },
  { technique: 'VNC access check', has: ['vnc-info', 'vncviewer {{TARGET}}::5900'] },
  { technique: 'TFTP file pull', has: ['tftp-enum', 'tftp {{TARGET}} -c get'] },
  { technique: 'Rsync module access', has: ['rsync-list-modules', '--list-only', 'rsync://{{TARGET}}/<share>'] },
  { technique: 'Finger user enumeration', has: ['finger @{{TARGET}}', 'finger-user-enum -U'] },
  { technique: 'IPMI hash dump', has: ['ipmi-cipher-zero', 'ipmi_dumphashes', '-m 7300'] },
  { technique: 'Upload through WebDAV', has: ['davtest -url', 'cadaver http://', 'curl -T'] },
  { technique: 'Exposed Docker API to host root', has: [':2375/version', 'images', 'chroot /mnt sh'] },
  { technique: 'Steal a session with stored or blind XSS', has: ['http.server 80', 'document.cookie'] },
  { technique: 'SQL injection', has: ['ORDER%20BY', 'UNION%20SELECT%201,2,3', 'information_schema.tables', 'xp_cmdshell'] },
  { technique: 'Local file inclusion and path traversal', has: ['?file=http://{{LHOST}}/', 'data://text/plain;base64', "-A '<webshell>'", 'access.log&cmd=id'] },
  { technique: 'XML external entity injection', has: ['http.server 80', 'http://{{LHOST}}/xxe'] },
  { technique: 'Server-side request forgery', has: ['url=http://{{LHOST}}/ssrf'] },
  // Task 4: foothold, transfer, pivot, flags, persistence
  { tool: 'ligolo-ng', has: ['start'] },
  { technique: 'Find and prove the flags', has: ['local.txt', 'proof.txt', "'flag*.txt'", 'cat /root/proof.txt', 'Desktop\\proof.txt'] },
  { technique: 'Exfil loot back to Kali', has: ['\\\\{{LHOST}}\\share', '-smb2support'] },
  { tool: 'powershell', has: ['DownloadString'] },
  { tool: 'ssh', has: ['ssh -R 1080', 'ssh -J'] },
  { technique: 'Keep SSH access with your own key', has: ['ssh-keygen'] },
  { tool: 'hashcat', has: ['-m 0 ', '-m 500 ', '-m 3200 ', '-m 2100 '] },
  { technique: 'Phish a user with an email attachment', has: ['wsgidav --host=0.0.0.0 --port=80', 'swaks -t', '--auth LOGIN'] },
  { technique: 'Capture hashes with files dropped on a writable share', has: ['ntlm_theft.py -g all', 'mput *'] },
  // Task 5: Linux privesc
  { technique: 'Sudo LD_PRELOAD with env_keep', has: ['> /tmp/pe.c && gcc'] },
  { technique: 'NFS no_root_squash abuse', has: ['cp /bin/bash <path>/rootbash', 'chown root:root', 'chmod 4755'] },
  { technique: 'Shared object hijacking', has: ['strace'] },
  { technique: 'Sudo rights abuse', has: ['doas.conf'] },
  { tool: 'linpeas', has: ['http.server 80', 'http://{{LHOST}}/linpeas.sh'] },
  // Task 6: Windows privesc
  { tool: 'winpeas', has: ['http://{{LHOST}}/winPEASx64.exe', 'http://{{LHOST}}/winPEAS.ps1'] },
  { tool: 'JuicyPotato', has: ['-t * -c {<clsid>}'] },
  { tool: 'JuicyPotatoNG', has: ['-e cmd'] },
  { tool: 'SweetPotato', has: ['-e cmd'] },
  { tool: 'pypykatz', has: ['lsa minidump'] },
  { tool: 'LaZagne', has: ['LaZagne.exe all'] },
  { tool: 'PsExec', has: ['-accepteula -i \\\\<host>'] },
  { technique: 'Get SYSTEM by abusing SeImpersonate', has: ['PrintSpoofer64.exe -c', 'GodPotato-NET4.exe -cmd "C:\\Windows\\Temp\\nc.exe', 'JuicyPotato.exe', 'SweetPotato.exe'] },
  { technique: 'Replace a weak service binary', has: ['-f exe-service'] },
  { technique: 'Reconfigure a service with weak permissions', has: ['-f exe-service'] },
  { technique: 'Install an MSI as SYSTEM via AlwaysInstallElevated', has: ['-f msi'] },
  { technique: 'Read SAM and SYSTEM with SeBackupPrivilege', has: ['Set-Content', 'diskshadow /s C:\\Windows\\Temp\\ds.txt', 'z:\\Windows\\NTDS . ntds.dit', '-ntds'] },
  { technique: 'Hijack an unquoted service path', has: ['Get-CimInstance'] },
  { technique: 'Abuse a dangerous token privilege', has: ['takeown /f', 'procdump'] },
  { technique: 'Bypass UAC for a full admin token', has: ['fodhelper'] },
  { technique: 'Map the host and your privileges', has: ['netstat -ano', 'tasklist /svc', 'Uninstall'] },
  { technique: 'Hunt stored credentials on disk and registry', has: ['SimonTatham', 'reg query HKLM /f password', 'HistorySavePath', 'Get-ChildItem -Path C:\\Users', 'Panther', 'LaZagne'] },
  { technique: 'Dump local secrets once you are admin', has: ['pypykatz'] },
  { technique: 'Abuse a privileged built-in group', has: ['whoami /groups', 'binPath=', 'dnscmd', 'start dns', 'IncludeDeletedObjects'] },
  { technique: 'Decrypt DPAPI-protected credentials', has: ['Microsoft\\Protect', 'impacket-dpapi'] },
]

test('every review finding is in the library', () => {
  const missing = MUST.flatMap((m) => {
    const ts = templatesOf(m)
    if (!ts.length) return [`${m.tool ?? m.technique}: not found or no commands`]
    return m.has.filter((h) => !ts.some((t) => t.includes(h))).map((h) => `${m.tool ?? m.technique}: no command with "${h}"`)
  })
  expect(missing).toEqual([])
})

test('netexec is spelled nxc', () => {
  expect(allTemplates().filter((t) => /(^|[;&|]\s*)netexec\b/.test(t))).toEqual([])
  expect(allToolRefs().filter((n) => n.toLowerCase() === 'netexec')).toEqual([])
})

test('SeBackup no longer robocopies the locked live hives (A6)', () => {
  expect(templatesOf({ technique: 'Read SAM and SYSTEM with SeBackupPrivilege', has: [] }).filter((t) => t.includes('config . SAM SYSTEM'))).toEqual([])
})

test('shared object hijacking no longer copies libc over the missing library (A13)', () => {
  expect(templatesOf({ technique: 'Shared object hijacking', has: [] }).filter((t) => t.includes('libc.so.6'))).toEqual([])
})

// {{LPORT}} is the listener's port; a file server on it collides with the listener (A2).
test('serving files never uses {{LPORT}}', () => {
  expect(allTemplates().filter((t) => /http\.server \{\{LPORT\}\}|\{\{LHOST\}\}:\{\{LPORT\}\}\//.test(t))).toEqual([])
})

test('every impacket-* tool is defined only in 05-impacket.json', () => {
  const elsewhere = readSeed().flatMap(({ file, data }) => (data.tools ?? []).filter((t) => /^impacket-/i.test(t.name) && file !== '05-impacket.json').map((t) => `${file}: ${t.name}`))
  expect(elsewhere).toEqual([])
  expect(new Set(tools.filter((t) => /^impacket-/i.test(t.name)).map((t) => t.name)).size).toBe(34)
})
