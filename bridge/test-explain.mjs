// Checks that POST /model returns the explanation model used by the Explain tab.
// Usage: node test-explain.mjs [http://localhost:3030]
// For every sample in ../web/public: `explain` and `diagnostics` must be present;
// error-free samples must have no unresolved references and one explain entry per norm.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3030';
const dir = join(import.meta.dirname, '..', 'web', 'public');
let failed = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith('.symboleo')).sort()) {
  const source = readFileSync(join(dir, f), 'utf8');
  const res = await fetch(`${base}/model`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }),
  });
  const m = await res.json();
  const problems = [];
  if (!m.explain) problems.push('no explain block');
  if (!m.diagnostics) problems.push('no diagnostics block');
  if (m.explain?.error) problems.push(`explain error: ${m.explain.error}`);
  if (m.explain && m.diagnostics) {
    const expected = (m.obligations?.length ?? 0) + (m.survivingObligations?.length ?? 0) + (m.powers?.length ?? 0);
    if (m.explain.norms.length !== expected) problems.push(`${m.explain.norms.length} explained norms, ${expected} in model`);
    if (m.diagnostics.errors === 0) {
      const unresolved = JSON.stringify(m.explain).match(/"unresolved"/g)?.length ?? 0;
      if (unresolved) problems.push(`${unresolved} unresolved reference(s) in an error-free spec`);
    }
  }
  const d = m.diagnostics ?? {};
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${f.padEnd(28)} errors=${d.errors ?? '?'} warnings=${d.warnings ?? '?'} norms=${m.explain?.norms?.length ?? '?'}${problems.length ? '  ' + problems.join('; ') : ''}`);
  if (problems.length) failed++;
}
process.exit(failed ? 1 : 0);
