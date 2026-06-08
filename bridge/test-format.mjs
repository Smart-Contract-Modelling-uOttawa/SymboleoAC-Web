// Request textDocument/formatting for a sample and print the resulting text.
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
const URL = process.argv[2] ?? 'ws://localhost:3030/lsp';
const file = process.argv[3] ?? '../upstream/SymboleoAC-IDE/samples/MeatSale.symboleo';
const source = readFileSync(file, 'utf8').replace(/^﻿/, '');
const ws = new WebSocket(URL);
let buf = '';
const docUri = 'file:///workspace/Fmt.symboleo';
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 25000);
ws.on('open', () => send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ processId:process.pid, rootUri:null, capabilities:{} } }));
ws.on('message', (data) => {
  buf += data.toString('utf8'); let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) {
    send({ jsonrpc:'2.0', method:'initialized', params:{} });
    send({ jsonrpc:'2.0', method:'textDocument/didOpen', params:{ textDocument:{ uri:docUri, languageId:'symboleoac', version:1, text:source } } });
    setTimeout(() => send({ jsonrpc:'2.0', id:2, method:'textDocument/formatting', params:{ textDocument:{ uri:docUri }, options:{ tabSize:3, insertSpaces:true } } }), 1500);
    return;
  }
  if (m.id === 2) {
    const edits = m.result ?? [];
    clearTimeout(timeout);
    if (!Array.isArray(edits) || edits.length === 0) { console.log('(no formatting edits returned)'); ws.close(); process.exit(0); }
    // Apply edits to the source to show the formatted result. Sort by start desc.
    const lines = source.split('\n');
    const offsetAt = (line, ch) => lines.slice(0, line).reduce((a,l)=>a+l.length+1,0) + ch;
    let text = source;
    const sorted = edits.map(e => ({ s: offsetAt(e.range.start.line, e.range.start.character), en: offsetAt(e.range.end.line, e.range.end.character), t: e.newText })).sort((a,b)=>b.s-a.s);
    for (const e of sorted) text = text.slice(0, e.s) + e.t + text.slice(e.en);
    console.log(`--- ${edits.length} edit(s); formatted result: ---`);
    console.log(text);
    ws.close(); process.exit(0);
  }
});
ws.on('error', e => { console.error('ws error:', e.message); process.exit(2); });
function send(o){ ws.send(JSON.stringify(o)); }
