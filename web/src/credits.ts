export type Credit = { section: 'references' | 'code' | 'fonts' | 'libraries'; name: string; url: string; licence: string; what: string; notice?: string }

const mit = (holder: string) => `MIT License, Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

export const CREDITS: Credit[] = [
  { section: 'references', name: 'PayloadsAllTheThings', url: 'https://github.com/swisskyrepo/PayloadsAllTheThings', licence: 'MIT', what: 'Payload and technique reference' },
  { section: 'references', name: 'HackTricks', url: 'https://github.com/HackTricks-wiki/hacktricks', licence: 'CC BY-NC 4.0', what: 'Technique reference' },
  { section: 'references', name: 'PentestMonkey', url: 'https://pentestmonkey.net/cheat-sheet/shells/reverse-shell-cheat-sheet', licence: 'Not specified', what: 'Reverse shell cheat sheet' },
  { section: 'references', name: 'revshells.com (0dayCTF reverse-shell-generator)', url: 'https://github.com/0dayCTF/reverse-shell-generator', licence: 'MIT', what: 'Reverse-shell one-liner reference consulted', notice: mit('2022 Ryan Montgomery') },
  { section: 'references', name: 'Metasploit Framework', url: 'https://github.com/rapid7/metasploit-framework', licence: 'BSD-3-Clause', what: 'Payload names used by the MSFVenom and Assembled tabs' },
  { section: 'references', name: 'shell-storm', url: 'https://shell-storm.org/shellcode/', licence: 'Not specified', what: 'Shellcode reference' },
  { section: 'references', name: 'Exploit-DB', url: 'https://www.exploit-db.com/', licence: 'Not specified', what: 'Exploit and shellcode reference' },
  { section: 'code', name: 'PowerShell Reverse TCP', url: 'https://github.com/ivan-sincek/powershell-reverse-tcp', licence: 'MIT', what: 'Ivan Šincek; included verbatim with the IP and port replaced by placeholders', notice: mit('2019 Ivan Šincek') },
  { section: 'fonts', name: 'Barlow', url: 'https://github.com/jpt/barlow', licence: 'SIL OFL 1.1', what: 'Served from the @fontsource/barlow package' },
  { section: 'fonts', name: 'Barlow Condensed', url: 'https://github.com/jpt/barlow', licence: 'SIL OFL 1.1', what: 'Served from the @fontsource/barlow-condensed package' },
  { section: 'fonts', name: 'JetBrains Mono', url: 'https://github.com/JetBrains/JetBrainsMono', licence: 'SIL OFL 1.1', what: 'Served from the @fontsource/jetbrains-mono package' },
  { section: 'libraries', name: '@codemirror/lang-markdown', url: 'https://github.com/codemirror/lang-markdown', licence: 'MIT', what: 'Markdown language support for the notes editor' },
  { section: 'libraries', name: '@codemirror/state', url: 'https://github.com/codemirror/state', licence: 'MIT', what: 'Editor state' },
  { section: 'libraries', name: '@codemirror/view', url: 'https://github.com/codemirror/view', licence: 'MIT', what: 'Editor view' },
  { section: 'libraries', name: '@fastify/static', url: 'https://github.com/fastify/fastify-static', licence: 'MIT', what: 'Serves the built web app' },
  { section: 'libraries', name: '@fontsource/barlow', url: 'https://github.com/fontsource/font-files', licence: 'MIT', what: 'Packaging of the Barlow font (the font itself is OFL 1.1)' },
  { section: 'libraries', name: '@fontsource/barlow-condensed', url: 'https://github.com/fontsource/font-files', licence: 'MIT', what: 'Packaging of the Barlow Condensed font (the font itself is OFL 1.1)' },
  { section: 'libraries', name: '@fontsource/jetbrains-mono', url: 'https://github.com/fontsource/font-files', licence: 'MIT', what: 'Packaging of the JetBrains Mono font (the font itself is OFL 1.1)' },
  { section: 'libraries', name: 'better-sqlite3', url: 'https://github.com/WiseLibs/better-sqlite3', licence: 'MIT', what: 'SQLite database driver' },
  { section: 'libraries', name: 'codemirror', url: 'https://github.com/codemirror/basic-setup', licence: 'MIT', what: 'Editor basic setup' },
  { section: 'libraries', name: 'fastify', url: 'https://github.com/fastify/fastify', licence: 'MIT', what: 'HTTP server' },
  { section: 'libraries', name: 'markdown-it', url: 'https://github.com/markdown-it/markdown-it', licence: 'MIT', what: 'Markdown rendering' },
  { section: 'libraries', name: 'react', url: 'https://github.com/facebook/react', licence: 'MIT', what: 'UI library' },
  { section: 'libraries', name: 'react-dom', url: 'https://github.com/facebook/react', licence: 'MIT', what: 'React renderer for the browser' },
  { section: 'libraries', name: 'tsx', url: 'https://github.com/privatenumber/tsx', licence: 'MIT', what: 'TypeScript runner for the server and scripts' },
]
