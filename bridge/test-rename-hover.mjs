// Hover, prepareRename and rename probes on VaccineProcurement, at a plain-identifier
// reference (pfizer), a norm cross-reference (oAgreedOnRequest) and an attribute (reqID).
// Usage: node test-rename-hover.mjs [ws://localhost:3030/lsp]
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
const WS_URL = process.argv[2] ?? 'ws://localhost:3030/lsp';
const source = readFileSync(new URL('../web/public/VaccineProcurement.symboleo', import.meta.url), 'utf8').replace(/^﻿/, '');
const ws = new WebSocket(WS_URL);
const uri = 'file:///workspace/Ren.symboleo';
let buf = ''; const pending = new Map(); let nextId = 2;
const timeout = setTimeout(() => { console.error('timeout'); process.exit(2); }, 30000);
const send = (o) => ws.send(JSON.stringify(o));
const req = (method, params) => { const id = nextId++; return new Promise((r) => { pending.set(id, r); send({ jsonrpc: '2.0', id, method, params }); }); };
function pos(needle, word) {
  const i = source.indexOf(needle); const j = source.indexOf(word, i);
  const upto = source.slice(0, j + 1);
  return { line: (upto.match(/\n/g) || []).length, character: upto.length - upto.lastIndexOf('\n') - 1 };
}
let failed = 0;
const check = (ok, label, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`); };
// occurrences in code only: comments are stripped first (rename must not touch them)
const stripComments = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const count = (s, w) => (stripComments(s).match(new RegExp(`(?<![\\w.])${w}(?!\\w)`, 'g')) || []).length;

ws.on('open', () => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } }));
ws.on('message', async (data) => {
  buf += data.toString('utf8'); let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) {
    check(m.result?.capabilities?.renameProvider != null, 'server advertises rename', JSON.stringify(m.result?.capabilities?.renameProvider));
    check(m.result?.capabilities?.hoverProvider != null, 'server advertises hover');
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'symboleoac', version: 1, text: source } } });
    await new Promise((r) => setTimeout(r, 1500));

    // hover
    for (const [label, needle, word, expectRe] of [
      ['hover variable', 'O(pfizer, mcdc', 'pfizer', /Declared role instance of type Manufacturer/],
      ['hover norm', 'Fulfilled(obligations.oAgreedOnRequest)', 'oAgreedOnRequest', /Obligation: mcdc owes pfizer[\s\S]*A Request must satisfy/],
      ['hover attribute', 'delivered.reqID == requested.reqID', 'reqID', /Attribute of type String \(Env\) of Delivered/],
      ['hover power', 'pStopWork:', 'pStopWork', /Power: held by mcdc against pfizer/],
    ]) {
      const h = await req('textDocument/hover', { textDocument: { uri }, position: pos(needle, word) });
      const v = h?.contents?.value ?? '';
      check(expectRe.test(v), label, JSON.stringify(v.split('\n')[0]).slice(0, 90));
    }

    // prepareRename + rename of a plain-identifier variable
    const p = pos('O(pfizer, mcdc', 'pfizer');
    const prep = await req('textDocument/prepareRename', { textDocument: { uri }, position: p });
    check(prep && prep.start && prep.end && prep.end.character - prep.start.character === 6, 'prepareRename range = "pfizer"', JSON.stringify(prep));
    const we = await req('textDocument/rename', { textDocument: { uri }, position: p, newName: 'manufacturer' });
    const edits = we?.changes?.[uri] ?? [];
    const expected = count(source, 'pfizer');
    check(edits.length === expected && edits.every((e) => e.newText === 'manufacturer'), `rename pfizer -> manufacturer edits all ${expected} occurrences`, `${edits.length} edits`);
    const touchesAttr = edits.some((e) => { const lineText = source.split('\n')[e.range.start.line]; return lineText.slice(0, e.range.start.character).endsWith('.'); });
    check(!touchesAttr, 'rename leaves attribute names after "." alone');

    // rename to a keyword must be refused
    const bad = await new Promise((r) => { const id = nextId++; pending.set(id, (res, err) => r(err)); send({ jsonrpc: '2.0', id, method: 'textDocument/rename', params: { textDocument: { uri }, position: p, newName: 'Obligations' } }); });
    check(bad && /keyword/.test(bad.message ?? ''), 'rename to a keyword is refused', JSON.stringify(bad?.message));

    // rename of an attribute goes through Xtext's own rename
    const pa = pos('delivered.reqID == requested.reqID', 'reqID');
    const wa = await req('textDocument/rename', { textDocument: { uri }, position: pa, newName: 'requestId' });
    const ea = wa?.changes?.[uri] ?? wa?.documentChanges?.flatMap((d) => d.edits ?? []) ?? [];
    check(ea.length >= 2, 'rename attribute reqID of Delivered (Xtext cross-references)', `${ea.length} edits`);

    clearTimeout(timeout); ws.close(); process.exit(failed ? 1 : 0);
  }
  if (pending.has(m.id)) { pending.get(m.id)(m.result, m.error); pending.delete(m.id); }
});
