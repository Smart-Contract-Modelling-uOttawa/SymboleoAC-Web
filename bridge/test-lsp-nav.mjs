// Probe hover / definition / references / rename at a role *reference*.
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
const URL = process.argv[2] ?? 'ws://localhost:3030/lsp';
const source = readFileSync('../upstream/SymboleoAC-IDE/samples/MeatSale.symboleo', 'utf8').replace(/^﻿/, '');
const ws = new WebSocket(URL);
const uri = 'file:///workspace/Nav.symboleo';
let buf = ''; const pending = new Map(); let nextId = 2;
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 25000);
const send = (o) => ws.send(JSON.stringify(o));
const req = (method, params) => { const id = nextId++; return new Promise((r) => { pending.set(id, r); send({ jsonrpc: '2.0', id, method, params }); }); };

// position on the "seller" reference inside "Obligation(seller,"
function pos(needle, word) {
  const i = source.indexOf(needle); const j = source.indexOf(word, i);
  const upto = source.slice(0, j + 1);
  return { line: (upto.match(/\n/g) || []).length, character: upto.length - upto.lastIndexOf('\n') - 1 };
}

ws.on('open', () => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } }));
ws.on('message', async (data) => {
  buf += data.toString('utf8'); let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) {
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'symboleoac', version: 1, text: source } } });
    await new Promise((r) => setTimeout(r, 1200));
    const p = pos('Obligation(seller', 'seller');
    console.log('probe position:', JSON.stringify(p));
    const hov = await req('textDocument/hover', { textDocument: { uri }, position: p });
    console.log('hover:', JSON.stringify(hov)?.slice(0, 160));
    const def = await req('textDocument/definition', { textDocument: { uri }, position: p });
    console.log('definition:', JSON.stringify(def)?.slice(0, 200));
    const refs = await req('textDocument/references', { textDocument: { uri }, position: p, context: { includeDeclaration: true } });
    console.log('references count:', Array.isArray(refs) ? refs.length : refs);
    const rn = await req('textDocument/prepareRename', { textDocument: { uri }, position: p });
    console.log('prepareRename:', JSON.stringify(rn)?.slice(0, 160));
    clearTimeout(timeout); ws.close(); process.exit(0);
  }
  if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(2); });
