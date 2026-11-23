# Runs tools/smoke-test.js against the game in a hidden Microsoft Edge window and prints the report.
#   .\tools\run-smoke.ps1                                   # the live site
#   .\tools\run-smoke.ps1 -Url http://127.0.0.1:8123/       # a local copy
param([string]$Url = 'https://set0panda.github.io/DroneDash/', [int]$Port = 9334, [int]$TimeoutMin = 10)
$ErrorActionPreference = 'Stop'
$here = Split-Path $MyInvocation.MyCommand.Path
$test = [string](Get-Content (Join-Path $here 'smoke-test.js') -Raw)   # [string]: plain text, without PowerShell's extra file properties
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found' }
$prof = Join-Path $env:TEMP ('drone-dash-smoke-' + [guid]::NewGuid())   # fresh profile: no saved data
$p = Start-Process $edge -ArgumentList @('--headless=new', "--remote-debugging-port=$Port", "--user-data-dir=$prof", '--no-first-run', '--window-size=412,915', $Url) -PassThru
try {
  $tabs = $null
  for ($i = 0; $i -lt 40 -and -not $tabs; $i++) { Start-Sleep -Milliseconds 300; try { $tabs = Invoke-RestMethod "http://127.0.0.1:$Port/json" } catch {} }
  $ws = ($tabs | Where-Object { $_.type -eq 'page' } | Select-Object -First 1).webSocketDebuggerUrl
  $c = New-Object System.Net.WebSockets.ClientWebSocket
  $c.ConnectAsync([Uri]$ws, [Threading.CancellationToken]::None).Wait()
  Start-Sleep -Seconds 4                                   # let the page load
  $msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $test; awaitPromise = $true; returnByValue = $true } } | ConvertTo-Json -Depth 6 -Compress
  $b = [Text.Encoding]::UTF8.GetBytes($msg)
  $c.SendAsync([ArraySegment[byte]]$b, 'Text', $true, [Threading.CancellationToken]::None).Wait()
  while ($true) {
    $sb = New-Object Text.StringBuilder
    do {
      $buf = New-Object byte[] 262144
      $t = $c.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None)
      if (-not $t.Wait($TimeoutMin * 60000)) { throw "no result within $TimeoutMin minutes" }
      [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $t.Result.Count))
    } while (-not $t.Result.EndOfMessage)
    $o = $sb.ToString() | ConvertFrom-Json
    if ($o.id -eq 1) { break }
  }
  if ($o.error) { 'TEST FAILED TO RUN: ' + ($o.error | ConvertTo-Json -Depth 5 -Compress) }
  elseif ($o.result.exceptionDetails) { 'TEST CRASHED: ' + ($o.result.exceptionDetails | ConvertTo-Json -Depth 5 -Compress) }
  elseif ($null -ne $o.result.result.value) { $o.result.result.value }
  else { 'UNEXPECTED REPLY: ' + ($o | ConvertTo-Json -Depth 6 -Compress) }
} finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like "*$prof*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
}
