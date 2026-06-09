// Probe which LSP features the server actually returns: documentSymbol (outline),
// semanticTokens (highlighting legend + data), signatureHelp, hover.
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
const URL = process.argv[2] ?? 'ws://localhost:3030/lsp';
const file = process.argv[3] ?? '../upstream/SymboleoAC-IDE/samples/MeatSale.symboleo';
const source = readFileSync(file, 'utf8').replace(/^﻿/, '');
const ws = new WebSocket(URL);
const uri = 'file:///workspace/Probe.symboleo';
let buf = '';
const pending = new Map();
let nextId = 2;
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 25000);

function send(o) { ws.send(JSON.stringify(o)); }
function req(method, params) {
  const id = nextId++;
  return new Promise((res) => { pending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });
}

ws.on('open', () => send({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { processId: process.pid, rootUri: null, capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } } } }));

ws.on('message', async (data) => {
  buf += data.toString('utf8');
  let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) {
    const caps = m.result.capabilities;
    console.log('semanticTokens legend types:', caps.semanticTokensProvider?.legend?.tokenTypes?.join(', ') ?? '(none)');
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'symboleoac', version: 1, text: source } } });
    await new Promise((r) => setTimeout(r, 1200));

    const sym = await req('textDocument/documentSymbol', { textDocument: { uri } });
    console.log('\n=== documentSymbol ===');
    const arr = sym ?? [];
    console.log('count:', arr.length, ' hierarchical:', arr[0] && 'children' in arr[0]);
    console.log('sample:', arr.slice(0, 8).map((s) => `${s.name}${s.kind ? ` (kind ${s.kind})` : ''}`).join(', '));

    const st = await req('textDocument/semanticTokens/full', { textDocument: { uri } });
    console.log('\n=== semanticTokens/full ===');
    console.log('data length:', st?.data?.length ?? '(null)');

    const sig = await req('textDocument/signatureHelp', { textDocument: { uri }, position: findAfter(source, 'Happens(') });
    console.log('\n=== signatureHelp (after a "Happens(") ===');
    console.log(JSON.stringify(sig)?.slice(0, 200));

    clearTimeout(timeout); ws.close(); process.exit(0);
  }
  if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(2); });

function findAfter(text, needle) {
  const idx = text.indexOf(needle);
  if (idx < 0) return { line: 0, character: 0 };
  const upto = text.slice(0, idx + needle.length);
  const line = (upto.match(/\n/g) || []).length;
  const character = upto.length - (upto.lastIndexOf('\n') + 1);
  return { line, character };
}
