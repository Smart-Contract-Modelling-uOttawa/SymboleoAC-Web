// Smoke-test the ws LSP path end-to-end through the bridge.
import { WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'ws://localhost:3030/lsp';
const root = mkdtempSync(join(tmpdir(), 'bridge-lsp-test-'));
const rootUri = pathToFileURL(root).href;

const ws = new WebSocket(URL);
let buf = '';
const timeout = setTimeout(() => {
  console.error('timeout');
  process.exit(2);
}, 20000);

ws.on('open', () => {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'root' }],
      capabilities: {},
    },
  });
});
ws.on('message', (data) => {
  buf += data.toString('utf8');
  // vscode-ws-jsonrpc passes raw JSON-RPC messages (no LSP framing on the wire).
  while (true) {
    let parsed;
    try { parsed = JSON.parse(buf); } catch { return; }
    buf = '';
    if (parsed.id === 1 && parsed.result) {
      console.log('OK: initialize via ws');
      console.log('capabilities keys:', Object.keys(parsed.result.capabilities ?? {}).join(', '));
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
  }
});
ws.on('error', (err) => { console.error('ws error:', err.message); process.exit(2); });

function send(obj) { ws.send(JSON.stringify(obj)); }
