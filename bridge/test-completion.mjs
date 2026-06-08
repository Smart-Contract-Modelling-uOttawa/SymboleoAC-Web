// Verify textDocument/completion returns items through the bridge/Caddy.
import { WebSocket } from 'ws';
const URL = process.argv[2] ?? 'ws://localhost/lsp';
const ws = new WebSocket(URL);
let buf = '';
const docUri = 'file:///workspace/Complete.symboleo';
// A minimal valid-ish prefix; request completion at end of first line.
const source = '';
const reqLine = 0, reqChar = 0;
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 25000);

ws.on('open', () => send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ processId:process.pid, rootUri:null, capabilities:{ textDocument:{ completion:{ completionItem:{ snippetSupport:true } } } } } }));
ws.on('message', (data) => {
  buf += data.toString('utf8');
  let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1 && m.result) {
    send({ jsonrpc:'2.0', method:'initialized', params:{} });
    send({ jsonrpc:'2.0', method:'textDocument/didOpen', params:{ textDocument:{ uri:docUri, languageId:'symboleoac', version:1, text:source } } });
    setTimeout(() => send({ jsonrpc:'2.0', id:2, method:'textDocument/completion', params:{ textDocument:{ uri:docUri }, position:{ line:reqLine, character:reqChar } } }), 1500);
    return;
  }
  if (m.id === 2) {
    const items = Array.isArray(m.result) ? m.result : (m.result?.items ?? []);
    console.log(`OK: completion returned ${items.length} item(s)`);
    console.log('  sample:', items.slice(0, 8).map(i => i.label).join(', '));
    clearTimeout(timeout); ws.close(); process.exit(items.length > 0 ? 0 : 3);
  }
});
ws.on('error', e => { console.error('ws error:', e.message); process.exit(2); });
function send(o){ ws.send(JSON.stringify(o)); }
