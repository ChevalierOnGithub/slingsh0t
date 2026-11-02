// Sidebar pages (same labels and order as NAV in shell/Shell.tsx), found by keyword prefix in the palette.
export const PAGES: { label: string; href: string; keywords: string[] }[] = [
  { label: 'Boxes', href: '#/boxes', keywords: ['boxes', 'machine', 'machines'] },
  { label: 'Networks', href: '#/networks', keywords: ['networks', 'network', 'lab', 'labs', 'prolab'] },
  { label: 'Loot', href: '#/loot', keywords: ['loot', 'credential', 'credentials', 'flag', 'flags'] },
  { label: 'Techniques', href: '#/techniques', keywords: ['techniques', 'technique'] },
  { label: 'Tools and commands', href: '#/tools', keywords: ['tools', 'commands', 'tool', 'command'] },
  { label: 'Reverse shells', href: '#/shells', keywords: ['reverse', 'shells', 'shell', 'revshell', 'revshells', 'payload', 'payloads', 'msfvenom', 'assembled', 'shellcode', 'listener'] },
  { label: 'Writeups', href: '#/writeups', keywords: ['writeups', 'writeup'] },
  { label: 'Reference', href: '#/reference', keywords: ['reference', 'notes', 'cheatsheet'] },
  { label: 'Import', href: '#/import', keywords: ['import', 'htb', 'thm'] },
  { label: 'Credits', href: '#/credits', keywords: ['credits', 'licence', 'license', 'third-party', 'thirdparty'] },
]

export function matchPages(q: string): typeof PAGES {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  return PAGES.filter((p) => words.some((w) => p.keywords.some((k) => k.startsWith(w))))
}
