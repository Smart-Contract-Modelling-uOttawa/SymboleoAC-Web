# Verify the LSP handshake over wss:// using .NET ClientWebSocket, which
# validates the TLS chain against the Windows certificate store (no bypass).
# Sends LSP initialize + initialized + didOpen(broken doc) and waits for the
# initialize result and a publishDiagnostics — proving cert + ws-upgrade +
# server round-trip through Caddy on the VPS.
param([string]$Url = "wss://159-69-216-244.sslip.io/lsp")

$ws  = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(30))
try {
  $ws.ConnectAsync([Uri]$Url, $cts.Token).GetAwaiter().GetResult()
} catch {
  Write-Output "CONNECT FAILED: $($_.Exception.InnerException.Message)"
  exit 2
}
Write-Output "ws connected (TLS validated via Windows store)"

function Send-Msg($obj) {
  $json  = ($obj | ConvertTo-Json -Compress -Depth 8)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg   = [System.ArraySegment[byte]]::new($bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
}
function Recv-Msg {
  $buf = [byte[]]::new(131072)
  $sb  = [System.Text.StringBuilder]::new()
  do {
    $seg = [System.ArraySegment[byte]]::new($buf)
    $r = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
    [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
  } while (-not $r.EndOfMessage)
  return $sb.ToString()
}

$brokenUri = "file:///workspace/Broken.symboleo"
Send-Msg @{ jsonrpc="2.0"; id=1; method="initialize"; params=@{ processId=$null; rootUri=$null; capabilities=@{} } }

$gotInit = $false; $gotDiag = $false
for ($i = 0; $i -lt 30 -and -not ($gotInit -and $gotDiag); $i++) {
  $msg = Recv-Msg
  if (-not $gotInit -and $msg -match '"id":\s*1' -and $msg -match '"capabilities"') {
    $gotInit = $true
    Write-Output "OK: initialize result received (capabilities present)"
    Send-Msg @{ jsonrpc="2.0"; method="initialized"; params=@{} }
    Send-Msg @{ jsonrpc="2.0"; method="textDocument/didOpen"; params=@{ textDocument=@{ uri=$brokenUri; languageId="symboleoac"; version=1; text="ZZZ not valid symboleo" } } }
  }
  elseif ($gotInit -and $msg -match 'publishDiagnostics') {
    $gotDiag = $true
    $n = ([regex]::Matches($msg, '"message"')).Count
    Write-Output "OK: publishDiagnostics received (~$n diagnostic message field(s))"
  }
}
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $cts.Token).GetAwaiter().GetResult() 2>$null
if ($gotInit -and $gotDiag) { Write-Output "RESULT: PASS (wss handshake + diagnostics over TLS)"; exit 0 }
else { Write-Output "RESULT: FAIL (init=$gotInit diag=$gotDiag)"; exit 1 }
