// Completion at a mid-document position where several keywords are valid.
import { WebSocket } from 'ws';
const URL = process.argv[2] ?? 'ws://localhost:3033/lsp';
const ws = new WebSocket(URL);
let buf = '';
const docUri = 'file:///workspace/Mid.symboleo';
// A complete domain + contract header; request completion on the blank line
// inside the contract body, where section keywords (Declarations, Obligations…)
// are valid follow-elements.
// Grammar-valid up to the cursor: domain types need trailing ';', and the
// Contract rule requires >=2 parameters. Cursor is on the blank indented line
// after the contract header, where section keywords are valid follow-elements.
const lines = [
  'Domain d',
  '  Buyer isA Role with name : String;',
  'endDomain',
  'Contract C (a : String, b : String)',
  '  ',                       // <- request completion here (line 4)
  'endContract',
];
const source = lines.join('\n');
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 25000);
ws.on('open', () => send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ processId:process.pid, rootUri:null, capabilities:{} } }));
ws.on('message', (data) => {
  buf += data.toString('utf8'); let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) {
    send({ jsonrpc:'2.0', method:'initialized', params:{} });
    send({ jsonrpc:'2.0', method:'textDocument/didOpen', params:{ textDocument:{ uri:docUri, languageId:'symboleoac', version:1, text:source } } });
    setTimeout(() => send({ jsonrpc:'2.0', id:2, method:'textDocument/completion', params:{ textDocument:{ uri:docUri }, position:{ line:4, character:2 } } }), 1500);
    return;
  }
  if (m.id === 2) {
    const items = Array.isArray(m.result) ? m.result : (m.result?.items ?? []);
    console.log(`completion at 4:2 → ${items.length} item(s)`);
    console.log('  ', items.map(i => i.label).slice(0, 15).join(', '));
    clearTimeout(timeout); ws.close(); process.exit(items.length > 0 ? 0 : 3);
  }
});
ws.on('error', e => { console.error('ws error:', e.message); process.exit(2); });
function send(o){ ws.send(JSON.stringify(o)); }
