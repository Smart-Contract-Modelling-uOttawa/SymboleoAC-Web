// Go-to-definition probes on VaccineProcurement: variable, norm (cross-ref), domain type,
// attribute (cross-ref), parameter (declared in the Contract signature). Prints the 1-based target line for each.
// Usage: node test-definition.mjs [ws://localhost:3030/lsp]
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
const WS_URL = process.argv[2] ?? 'ws://localhost:3030/lsp';
const source = readFileSync(new URL('../web/public/VaccineProcurement.symboleo', import.meta.url), 'utf8').replace(/^﻿/, '');
const ws = new WebSocket(WS_URL);
const uri = 'file:///workspace/Def.symboleo';
let buf = ''; const pending = new Map(); let nextId = 2;
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 25000);
const send = (o) => ws.send(JSON.stringify(o));
const req = (method, params) => { const id = nextId++; return new Promise((r) => { pending.set(id, r); send({ jsonrpc: '2.0', id, method, params }); }); };
function pos(needle, word) {
  const i = source.indexOf(needle); const j = source.indexOf(word, i);
  const upto = source.slice(0, j + 1);
  return { line: (upto.match(/\n/g) || []).length, character: upto.length - upto.lastIndexOf('\n') - 1 };
}
const PROBES = [
  ['variable reference', 'O(pfizer, mcdc', 'pfizer', /^\s*pfizer:/],
  ['norm reference', 'Fulfilled(obligations.oAgreedOnRequest)', 'oAgreedOnRequest', /^\s*oAgreedOnRequest:/],
  ['domain type', 'requested : Requested', 'Requested', /^\s*Requested isA/],
  ['attribute', 'delivered.reqID == requested.reqID', 'reqID', /Delivered isA Event/],
  ['parameter', 'price := unitPrice', 'unitPrice', /unitPrice : Number/],
];
const lines = source.split('\n');
ws.on('open', () => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } }));
ws.on('message', async (data) => {
  buf += data.toString('utf8'); let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) {
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'symboleoac', version: 1, text: source } } });
    await new Promise((r) => setTimeout(r, 1500));
    let failed = 0;
    for (const [label, needle, word, expect] of PROBES) {
      if (source.indexOf(needle) < 0) { console.log(`skip ${label}: needle not found`); continue; }
      const def = await req('textDocument/definition', { textDocument: { uri }, position: pos(needle, word) });
      const target = Array.isArray(def) && def[0] ? def[0].range.start.line : null;
      const ok = target !== null && expect.test(lines[target] ?? '');
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(18)} ${word.padEnd(18)} -> ${target === null ? 'no definition' : `line ${target + 1}: ${lines[target].trim().slice(0, 60)}`}`);
    }
    clearTimeout(timeout); ws.close(); process.exit(failed ? 1 : 0);
  }
  if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
