// End-to-end LSP diagnostics test through the bridge/Caddy:
// initialize → initialized → didOpen (broken doc) → expect publishDiagnostics.
import { WebSocket } from 'ws';

const URL = process.argv[2] ?? 'ws://localhost/lsp';
const ws = new WebSocket(URL);
let buf = '';
let nextId = 1;
const docUri = 'file:///workspace/Broken.symboleo';
// Deliberately invalid: 'ZZZ' where 'Domain' is required by the grammar.
const brokenSource = 'ZZZ broken\nthis is not valid symboleo at all';

const timeout = setTimeout(() => { console.error('timeout: no diagnostics'); process.exit(2); }, 25000);

ws.on('open', () => {
  send({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: {
    processId: process.pid, rootUri: null, capabilities: {},
  }});
});

ws.on('message', (data) => {
  buf += data.toString('utf8');
  let msg;
  try { msg = JSON.parse(buf); } catch { return; }
  buf = '';
  if (msg.id === 1 && msg.result) {
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
      textDocument: { uri: docUri, languageId: 'symboleoac', version: 1, text: brokenSource },
    }});
    return;
  }
  if (msg.method === 'textDocument/publishDiagnostics') {
    const diags = msg.params?.diagnostics ?? [];
    console.log(`OK: publishDiagnostics for ${msg.params.uri}`);
    console.log(`  ${diags.length} diagnostic(s)`);
    for (const d of diags.slice(0, 5)) {
      console.log(`  - [${d.range.start.line}:${d.range.start.character}] ${d.message}`);
    }
    clearTimeout(timeout);
    ws.close();
    process.exit(diags.length > 0 ? 0 : 3);
  }
});

ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(2); });
function send(obj) { ws.send(JSON.stringify(obj)); }
