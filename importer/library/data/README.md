# Library seed files

One JSON file per domain, loaded by `npm run seed:library` (importer/library/seed.ts). Shape:

{
  "tools": [ { "name": "nmap", "description": "one line", "commands": [ { "purpose": "what it does", "template": "nmap -sC -sV {{TARGET}}", "intent": "enumerate" } ] } ],
  "techniques": [ {
    "name": "Port and service scanning",      // a goal, never an approach or a tool name
    "phase": "Recon",                          // Recon | Initial Access | PrivEsc | Lateral Movement | Root | Persistence
    "service": "any",                          // any | shell | http | smb | ssh | ftp | dns | ldap | kerberos | rdp | winrm | nfs | smtp | snmp | mysql | mssql | rpc | redis | pop3 | imap | postgresql | mongodb | vnc | tftp | rsync | finger | ipmi | docker-api (SERVICES in shared/types.ts; the validator rejects any other slug)
    "applies": "any",                          // any | linux | windows | ad
    "needs": [], "yields": ["version"],        // from: web app, version, creds, hash, shell, admin, domain creds
    "when": "one line: when you reach for it",
    "tools": ["nmap"],                         // names from any file's tools list; the tool's commands show under the technique
    "commands": [ { "purpose": "...", "template": "...", "intent": "enumerate" } ]  // technique-level commands (optional)
  } ]
}

Placeholders: {{TARGET}} {{LHOST}} {{LPORT}} {{DNS}} are substituted live; other blanks are written as <user>, <pass>, <domain>, <file>, <share>.
Intents: discover | enumerate | authenticate | exploit | pivot | dump | transfer | tune (or "" for untagged).
Order inside a phase = order in the file; files load in name order (01, 02, …).
`05-impacket.json` holds every `impacket-*` tool; techniques in any file link them by name.
The same command written twice in different words (quoting, blank names, `netexec`/`nxc`) fails validation; NetExec is always `nxc`.
