// Semantic tokens probe on VaccineProcurement: the server must advertise a legend and
// return tokens; a few known identifiers must carry the expected token type.
// Usage: node test-semantic-tokens.mjs [ws://localhost:3030/lsp]
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
const WS_URL = process.argv[2] ?? 'ws://localhost:3030/lsp';
const source = readFileSync(new URL('../web/public/VaccineProcurement.symboleo', import.meta.url), 'utf8').replace(/^﻿/, '');
const lines = source.split('\n');
const ws = new WebSocket(WS_URL);
const uri = 'file:///workspace/Sem.symboleo';
let buf = ''; const pending = new Map(); let nextId = 2;
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 30000);
const send = (o) => ws.send(JSON.stringify(o));
const req = (method, params) => { const id = nextId++; return new Promise((r) => { pending.set(id, r); send({ jsonrpc: '2.0', id, method, params }); }); };
let failed = 0;
const check = (ok, label, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`); };
function pos(needle, word) {
  const i = source.indexOf(needle); const j = source.indexOf(word, i);
  const upto = source.slice(0, j + 1);
  return { line: (upto.match(/\n/g) || []).length, character: upto.length - upto.lastIndexOf('\n') - 1 };
}

ws.on('open', () => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null,
  capabilities: { textDocument: { semanticTokens: { requests: { full: true }, tokenTypes: [], tokenModifiers: [], formats: ['relative'] } } } } }));
ws.on('message', async (data) => {
  buf += data.toString('utf8'); let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) {
    const legend = m.result?.capabilities?.semanticTokensProvider?.legend;
    check(!!legend?.tokenTypes?.length, 'server advertises a semantic-token legend', `${legend?.tokenTypes?.length ?? 0} types, ${legend?.tokenModifiers?.length ?? 0} modifiers`);
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'symboleoac', version: 1, text: source } } });
    await new Promise((r) => setTimeout(r, 1500));
    const res = await req('textDocument/semanticTokens/full', { textDocument: { uri } });
    const data = res?.data ?? [];
    check(data.length > 0 && data.length % 5 === 0, 'semanticTokens/full returns tokens', `${data.length / 5} tokens`);
    // decode relative encoding into absolute tokens
    const toks = []; let line = 0, ch = 0;
    for (let i = 0; i < data.length; i += 5) {
      line += data[i]; ch = data[i] === 0 ? ch + data[i + 1] : data[i + 1];
      toks.push({ line, ch, len: data[i + 2], type: legend.tokenTypes[data[i + 3]], mods: data[i + 4], text: lines[line]?.slice(ch, ch + data[i + 2]) });
    }
    const at = (needle, word) => { const p = pos(needle, word); return toks.find((t) => t.line === p.line && t.ch === p.character - 1); };
    for (const [label, needle, word, type] of [
      ['role instance', 'O(pfizer, mcdc', 'pfizer', 'variable'],
      ['event instance', 'Happens(requested) -> O(mcdc', 'requested', 'event'],
      ['obligation reference', 'Fulfilled(obligations.oAgreedOnRequest)', 'oAgreedOnRequest', 'function'],
      ['type reference', 'requested : Requested', 'Requested', 'class'],
      ['attribute', 'delivered.reqID == requested.reqID', 'reqID', 'property'],
      ['parameter', 'price := unitPrice', 'unitPrice', 'parameter'],
      ['rule declaration', 'Rule1: Grant', 'Rule1', 'macro'],
      ['power declaration', 'pStopWork:', 'pStopWork', 'function'],
    ]) {
      const t = at(needle, word);
      check(t?.type === type && t?.text === word, `${label.padEnd(22)} ${word.padEnd(18)} -> ${type}`, t ? `got ${t.type}${t.mods ? ' +declaration' : ''}` : 'no token');
    }
    const byType = {}; for (const t of toks) byType[t.type] = (byType[t.type] ?? 0) + 1;
    console.log('token types:', JSON.stringify(byType));
    clearTimeout(timeout); ws.close(); process.exit(failed ? 1 : 0);
  }
  if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
