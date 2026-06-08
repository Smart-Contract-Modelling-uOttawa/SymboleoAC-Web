import { readFileSync } from 'node:fs';
const path = process.argv[2] ?? '../upstream/SymboleoAC-IDE/samples/MeatSale.symboleo';
const source = readFileSync(path, 'utf8');
const body = JSON.stringify({ source });
console.log(`POST /generate  source=${source.length}B  envelope=${body.length}B`);
const r = await fetch('http://localhost:3030/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body,
});
const text = await r.text();
console.log(`status ${r.status}`);
if (!r.ok) { console.log(text.slice(0, 500)); process.exit(1); }
const j = JSON.parse(text);
console.log('summary:', j.summary);
const names = Object.keys(j.files).sort();
console.log('files:', names.length);
console.log(names.slice(0, 4).join('\n'));
console.log('...');
console.log('index.js head:\n' + j.files[`${names[0].split('/')[0]}/index.js`]?.slice(0, 200));
