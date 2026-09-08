// Coverage statistics + rule table of the Explain tab's verbalizer. Reads out/corpus/*.json (output of `--model`),
// keeps error-free specifications, counts language constructs in the explanation model,
// counts idiom firings in the generated text, and writes Markdown + LaTeX to out/. Run via tools/explain-corpus/build-corpus.sh.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { slots, overview, plain } from '../../web/src/explain/verbalize.ts';
import { toMarkdown } from '../../web/src/explain/markdown.ts';
import { gherkinFeature, featureText } from '../../web/src/explain/gherkin.ts';
// Reference Gherkin parser, installed as a dev dependency of bridge/.
import { createRequire } from 'node:module';
const bridgeRequire = createRequire(join(__dirname, '..', '..', 'bridge', 'package.json'));
const { Parser, AstBuilder, GherkinClassicTokenMatcher } = bridgeRequire('@cucumber/gherkin');
const { IdGenerator } = bridgeRequire('@cucumber/messages');

const dir = join(__dirname, 'out', 'corpus');
const outDir = join(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------------ construct census
type Census = Record<string, number>;
const bump = (c: Census, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n; };

function walkProp(p: any, c: Census, ctx: { inConsequent: boolean }) {
  if (!p || typeof p !== 'object') return;
  switch (p.t) {
    case 'and': bump(c, 'and (conjunction)'); p.items.forEach((x: any) => walkProp(x, c, ctx)); return;
    case 'or': bump(c, 'or (alternatives)'); p.items.forEach((x: any) => walkProp(x, c, ctx)); return;
    case 'not':
      if (p.p?.t === 'happens') bump(c, 'not Happens(e)');
      else if (p.p?.t === 'fn') bump(c, 'not IsEqual/IsOwner(a, b)');
      else if (p.p?.t === 'cmp') bump(c, 'not (comparison)');
      else bump(c, 'not (other)');
      walkProp(p.p, c, ctx); return;
    case 'happens': walkEvent(p.event, c, 'Happens'); return;
    case 'before': bump(c, p.strict ? 'ShappensBefore(e, point)' : 'WhappensBefore(e, point)'); walkEvent(p.event, c, null); walkPoint(p.point, c); return;
    case 'beforeEvent': bump(c, 'S/WhappensBeforeE(e1, e2)'); return;
    case 'after': bump(c, 'HappensAfter(e, point)'); walkPoint(p.point, c); return;
    case 'within': bump(c, p.interval?.k === 'situation' ? 'HappensWithin(e, Situation)' : 'HappensWithin(e, Interval)'); walkEvent(p.event, c, null); return;
    case 'occurs': bump(c, 'Occurs(situation, interval)'); return;
    case 'happensAssign': bump(c, 'HappensAssign(e, x := expr)'); walkEvent(p.event, c, null); (p.assignments ?? []).forEach((a: any) => walkAssign(a, c)); return;
    case 'assign': bump(c, 'Assign(x := expr)'); (p.assignments ?? []).forEach((a: any) => walkAssign(a, c)); return;
    case 'cmp':
      if (p.right?.t === 'lit' && p.right.kind === 'bool') bump(c, 'x == true / false');
      else if (p.op === '==' && p.left?.t === 'var' && p.right?.t === 'var' && p.left.attrs?.length === 1 && p.right.attrs?.length === 1 && p.left.attrs[0] === p.right.attrs[0]) bump(c, 'a.k == b.k (same attribute)');
      else if (p.op === '!=' && p.left?.t === 'var' && p.right?.t === 'var') bump(c, 'a.k != b.k');
      else bump(c, `comparison ${p.op}`);
      walkProp(p.left, c, ctx); walkProp(p.right, c, ctx); return;
    case 'arith': bump(c, 'arithmetic (+ − × ÷)'); walkProp(p.left, c, ctx); walkProp(p.right, c, ctx); return;
    case 'fn': bump(c, `${p.name}(...)`); return;
    case 'lit': if (p.kind === 'bool') bump(c, 'literal true / false'); else bump(c, 'literal (number/string/date)'); return;
    case 'var': bump(c, p.attrs?.length ? 'attribute reference x.attr' : 'variable reference'); return;
    case 'enum': bump(c, 'enumeration value'); return;
    default: bump(c, `other: ${p.t}`);
  }
}
function walkEvent(e: any, c: Census, prefix: string | null) {
  if (!e) return;
  const label = e.k === 'var' ? (e.category === 'DataTransfer' ? 'data-transfer (alert) event' : 'event instance') : e.k === 'obligation' ? `obligation state (${e.state})` : e.k === 'power' ? `power state (${e.state})` : e.k === 'contract' ? `contract state (${e.state})` : 'unresolved event';
  bump(c, prefix ? `${prefix} · ${label}` : `(as point) ${label}`);
}
function walkPoint(p: any, c: Census) {
  if (!p) return;
  if (p.k === 'add') { bump(c, 'Date.add(point, n, unit)'); walkPoint(p.arg, c); }
  else if (p.k === 'var') bump(c, p.attrType === 'Date' ? 'point: Date attribute' : 'point: event/variable');
  else if (p.k2 === 'event') bump(c, 'point: norm/contract event');
}
function walkAssign(a: any, c: Census) {
  const e = a.expr;
  if (e?.t === 'arith' && e.left?.t === 'var' && e.left.ref === a.target?.ref && (e.op === '-' || e.op === '+')) bump(c, 'x := x ± expr (increment)');
  else bump(c, 'x := expr');
}

// ------------------------------------------------------------------ idioms in generated text
const IDIOMS: [string, RegExp][] = [
  ['correlation: "a, b and c all refer to the same k"', /refer to the same `?\w+`?/g],
  ['absence: "no e1, e2 ... occurs for the same k"', /\bno .* (alert|event) occurs for the same/g],
  ['range: "x is between lo and hi"', /is between /g],
  ['same-verb alternatives: "either A (e1) or B (e2, e3) <verb>"', /either .*\(.*\) or .*\(.*\) \w+/g],
  ['same-event-before: "e strictly before p1 or p2"', /(strictly|on or) before .* or /g],
  ['increment: "x is reduced/increased by"', /is (reduced|increased) by/g],
  ['boolean attribute: "x holds / does not hold"', /(holds|does not hold)/g],
  ['identity: "a and b are the same / different"', /are (the same|different)/g],
  ['deadline: "n units after point"', /\d+ (seconds|minutes|hours|days|weeks|months|years) after/g],
  ['generic fallback: "<party> performs e (Type)"', / performs /g],
  ['generic fallback: "it is not the case that"', /it is not the case/g],
];

// ------------------------------------------------------------------ run
type Row = { file: string; contract: string; norms: number; obligations: number; surviving: number; powers: number; rules: number; constructs: number; identifiers: number; normLinks: number; warnings: number;
  gRules: number; gScenarios: number; gOutlines: number; gSteps: number; gParse: 'ok' | string };
mkdirSync(join(outDir, 'features'), { recursive: true });
const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
function gherkinCheck(model: any, name: string) {
  const text = featureText(gherkinFeature(model, 'full'));
  writeFileSync(join(outDir, 'features', `${name}.feature`), text);
  let gParse: 'ok' | string = 'ok';
  let gRules = 0, gScenarios = 0, gOutlines = 0, gSteps = 0;
  try {
    const doc: any = parser.parse(text);
    const walkChildren = (children: any[]) => {
      for (const c of children ?? []) {
        if (c.rule) { gRules++; walkChildren(c.rule.children); }
        if (c.background) gSteps += c.background.steps?.length ?? 0;
        if (c.scenario) { gScenarios++; if (c.scenario.examples?.length) gOutlines++; gSteps += c.scenario.steps?.length ?? 0; }
      }
    };
    walkChildren(doc.feature?.children);
  } catch (e: any) {
    gParse = String(e?.message ?? e).split('\n')[0].slice(0, 160);
  }
  return { gRules, gScenarios, gOutlines, gSteps, gParse };
}
const rows: Row[] = [];
const census: Census = {}; const idioms: Census = {};
let totalNorms = 0, totalClauses = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const skipped: string[] = [];
for (const f of files) {
  let m: any; try { m = JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^\ufeff/, '')); } catch { skipped.push(`${f} (not JSON)`); continue; }
  if (!m.explain || m.explain.error) { skipped.push(`${f} (no explanation model)`); continue; }
  if ((m.diagnostics?.errors ?? 1) > 0) { skipped.push(`${f} (${m.diagnostics.errors} validation errors)`); continue; }
  const rules = m.rules ?? [];
  const local: Census = {};
  let identifiers = 0, normLinks = 0;
  const texts: string[] = [];
  for (const n of m.explain.norms) {
    totalNorms++;
    if (n.trigger) walkProp(n.trigger, local, { inConsequent: false }); else bump(local, 'no trigger (from contract start)');
    if (n.antecedent?.t === 'lit' && n.antecedent.value === true) bump(local, 'antecedent true (immediately)'); else walkProp(n.antecedent, local, { inConsequent: false });
    if (n.kind === 'power') bump(local, `power effect: ${n.consequent?.action}(${n.consequent?.target === 'contract' ? 'self' : n.consequent?.target})`);
    else walkProp(n.consequent, local, { inConsequent: true });
    if (n.controller) bump(local, 'with Controller');
    if (n.authorNote) bump(local, "specifier's comment above norm");
    const s = slots(n, rules);
    const rich = [s.created ?? [], ...(s.binding ?? []), ...s.must, ...s.deadlines];
    totalClauses += rich.length;
    for (const r of rich) for (const frag of r) { if (typeof frag === 'object' && 'code' in frag) identifiers++; if (typeof frag === 'object' && 'norm' in frag) normLinks++; }
    texts.push(...rich.map(plain));
  }
  const ov = overview(m.explain.contract, m.explain.norms, rules);
  texts.push(...[ov.summary, ...ov.preconditions, ...ov.constraints, ...ov.ends, ...ov.lifecycle].map(plain));
  for (const [k, v] of Object.entries(local)) bump(census, k, v);
  for (const [name, re] of IDIOMS) for (const t of texts) { const h = t.match(re); if (h) bump(idioms, name, h.length); }
  const g = gherkinCheck(m, f.replace(/\.json$/, ''));
  rows.push({ ...g, file: f.replace(/\.json$/, ''), contract: m.explain.contract.name, norms: m.explain.norms.length,
    obligations: m.explain.norms.filter((n: any) => n.kind === 'obligation').length,
    surviving: m.explain.norms.filter((n: any) => n.kind === 'survivingObligation').length,
    powers: m.explain.norms.filter((n: any) => n.kind === 'power').length, rules: rules.length,
    constructs: Object.values(local).reduce((a, b) => a + b, 0), identifiers, normLinks, warnings: m.diagnostics.warnings });
}

// ------------------------------------------------------------------ rule table (construct -> phrasing)
const PHRASING: Record<string, string> = {
  'Happens · event instance': '"<performer> <verb> (`e`)" from the event-type lexicon; else "<performer> performs `e` (Type)"',
  'Happens · data-transfer (alert) event': '"`e` (Type) is raised by <performer>"',
  'Happens · obligation state (Fulfilled)': '"obligation [X] has been fulfilled" (link to X)',
  'Happens · obligation state (Violated)': '"obligation [X] is violated"',
  'Happens · contract state (Terminated)': '"the contract is terminated"',
  'not Happens(e)': '"`e` does not occur"',
  'ShappensBefore(e, point)': '"<e-clause> strictly before <point>"; a time point is also listed under Deadline',
  'WhappensBefore(e, point)': '"<e-clause> on or before <point>"; a time point is also listed under Deadline',
  'HappensWithin(e, Interval)': '"<e-clause> between <p1> and <p2>"',
  'HappensWithin(e, Situation)': '"<e-clause> while obligation [X] is <state>"',
  'HappensAssign(e, x := expr)': '"when <e-clause>, <assignments>"',
  'Assign(x := expr)': '"<assignments>"',
  'x := expr': '"`x` is set to <expr>"',
  'x := x ± expr (increment)': '"`x` is reduced by / increased by <expr>"',
  'Date.add(point, n, unit)': '"<n> <unit> after <point>"',
  'a.k == b.k (same attribute)': 'collected per attribute: "`a`, `b` and `c` all refer to the same `k`"',
  'a.k != b.k': 'with "not Happens(e) or e.k != f.k": "no `e1`, `e2` ... alert occurs for the same `k` as `f`"',
  'x == true / false': '"`x` holds" / "`x` does not hold"',
  'comparison ==': '"<l> equals <r>"', 'comparison !=': '"<l> differs from <r>"',
  'comparison >=': '"<l> is at least <r>"; with a matching <= on the same x: "`x` is between lo and hi"',
  'comparison <=': '"<l> is at most <r>"; with a matching >= on the same x: "`x` is between lo and hi"',
  'comparison >': '"<l> is more than <r>"', 'comparison <': '"<l> is less than <r>"',
  'arithmetic (+ − × ÷)': 'infix with typographic operators: "`a` × `b`"',
  'and (conjunction)': 'bullet list (fact sheet) / "(1) …; (2) …; and (3) …" (prose)',
  'or (alternatives)': '"either … or …"; same-verb events merge: "either A (`e1`) or B (`e2`, `e3`) <verb>"; same event before several points merges: "<e> strictly before p1 or p2"',
  'IsEqual(...)': '"`a` and `b` are the same"', 'not IsEqual/IsOwner(a, b)': '"`a` and `b` are different" / "`a` does not own `b`"',
  'literal true / false': 'antecedent true → "immediately (no condition)"; power → "at will"',
  'antecedent true (immediately)': '"immediately (no condition)" / power: "exercisable at will"',
  'no trigger (from contract start)': '"at the start of the contract (no trigger)"',
  'with Controller': '"Access administered by <controller>"',
  "specifier's comment above norm": 'shown verbatim as "Specifier\'s note", separated from generated text',
  'power effect: Terminated(self)': '"the contract is terminated"',
  'power effect: Suspended(obligation)': '"obligation [X] is suspended"',
  'power effect: Resumed(obligation)': '"obligation [X] is resumed"',
  'variable reference': 'exact identifier in code font, click → declaration',
  'attribute reference x.attr': 'exact reference `x.attr`',
  'enumeration value': 'the value name',
};

const sortDesc = (c: Census) => Object.entries(c).sort((a, b) => b[1] - a[1]);
const esc = (s: string) => s.replace(/([&%$#_{}])/g, '\\$1').replace(/`([^`]*)`/g, '\\texttt{$1}').replace(/→/g, '$\\rightarrow$').replace(/×/g, '$\\times$').replace(/÷/g, '$\\div$').replace(/−/g, '$-$').replace(/±/g, '$\\pm$').replace(/…/g, '\\ldots{}').replace(/</g, '$<$').replace(/>/g, '$>$');

let md = `# Corpus statistics (generated ${new Date().toISOString().slice(0, 10)})\n\n`;
md += `Specifications with an explanation model and no validation errors: **${rows.length}** (of ${files.length} local .symboleo files; ${skipped.length} skipped — see end). Norms explained: **${totalNorms}**; clauses produced: **${totalClauses}**.\n\n`;
md += `## Per specification\n\n| Specification | Contract | Obligations | Surviving | Powers | AC rules | Constructs | Identifier links | Norm links | Warnings | Gherkin rules | Scenarios | Outlines | Steps | Parses |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|\n`;
for (const r of rows) md += `| ${r.file} | ${r.contract} | ${r.obligations} | ${r.surviving} | ${r.powers} | ${r.rules} | ${r.constructs} | ${r.identifiers} | ${r.normLinks} | ${r.warnings} | ${r.gRules} | ${r.gScenarios} | ${r.gOutlines} | ${r.gSteps} | ${r.gParse} |\n`;
const tot = rows.reduce((a, r) => ({ obligations: a.obligations + r.obligations, surviving: a.surviving + r.surviving, powers: a.powers + r.powers, rules: a.rules + r.rules, constructs: a.constructs + r.constructs, identifiers: a.identifiers + r.identifiers, normLinks: a.normLinks + r.normLinks, gRules: a.gRules + r.gRules, gScenarios: a.gScenarios + r.gScenarios, gOutlines: a.gOutlines + r.gOutlines, gSteps: a.gSteps + r.gSteps, parsed: a.parsed + (r.gParse === 'ok' ? 1 : 0) }), { obligations: 0, surviving: 0, powers: 0, rules: 0, constructs: 0, identifiers: 0, normLinks: 0, gRules: 0, gScenarios: 0, gOutlines: 0, gSteps: 0, parsed: 0 });
md += `| **Total** | | **${tot.obligations}** | **${tot.surviving}** | **${tot.powers}** | **${tot.rules}** | **${tot.constructs}** | **${tot.identifiers}** | **${tot.normLinks}** | | **${tot.gRules}** | **${tot.gScenarios}** | **${tot.gOutlines}** | **${tot.gSteps}** | ${tot.parsed}/${rows.length} |\n\n`;
md += `## Gherkin\n\nEach contract rendered as one Feature (\`out/features/*.feature\`), parsed with @cucumber/gherkin: ${tot.parsed} of ${rows.length} parse without error; ${tot.gRules} Rules (one per norm), ${tot.gScenarios} scenarios (${tot.gOutlines} of them Scenario Outlines with Examples), ${tot.gSteps} steps.\n\n`;
md += `## Idiom firings in the generated text\n\n| Idiom | Firings |\n|---|--:|\n`;
for (const [name, re] of IDIOMS) md += `| ${name} | ${idioms[name] ?? 0} |\n`;
md += `\n## Rule table: construct → phrasing, with corpus frequency\n\n| Construct (explanation model) | Occurrences | Phrasing rule |\n|---|--:|---|\n`;
for (const [k, v] of sortDesc(census)) md += `| ${k} | ${v} | ${PHRASING[k] ?? ''} |\n`;
md += `\n## Skipped files\n\n${skipped.map((s) => `- ${s}`).join('\n')}\n`;
writeFileSync(join(outDir, 'corpus-stats.md'), md);

// LaTeX
let tex = `% Generated by stats.ts on ${new Date().toISOString().slice(0, 10)}. Requires booktabs.\n`;
tex += `\\begin{table}[t]\\centering\\small\n\\caption{Corpus: error-free SymboleoAC specifications and the explanations generated for them.}\\label{tab:corpus}\n`;
tex += `\\begin{tabular}{lrrrrrrrrrr}\\toprule\nContract & Obl. & Surv. & Pow. & Rules & Constructs & Id.\\ links & Norm links & Scen. & Steps & Parses\\\\\\midrule\n`;
for (const r of rows) tex += `${esc(r.contract)} & ${r.obligations} & ${r.surviving} & ${r.powers} & ${r.rules} & ${r.constructs} & ${r.identifiers} & ${r.normLinks} & ${r.gScenarios} & ${r.gSteps} & ${r.gParse === 'ok' ? '\\checkmark' : 'no'}\\\\\n`;
tex += `\\midrule\nTotal & ${tot.obligations} & ${tot.surviving} & ${tot.powers} & ${tot.rules} & ${tot.constructs} & ${tot.identifiers} & ${tot.normLinks} & ${tot.gScenarios} & ${tot.gSteps} & ${tot.parsed}/${rows.length}\\\\\\bottomrule\n\\end{tabular}\\end{table}\n\n`;
tex += `\\begin{table}[t]\\centering\\small\n\\caption{Verbalization rules: SymboleoAC constructs, their occurrences in the corpus, and the phrasing produced.}\\label{tab:rules}\n\\begin{tabular}{p{4.2cm}rp{7.3cm}}\\toprule\nConstruct & n & Phrasing\\\\\\midrule\n`;
for (const [k, v] of sortDesc(census)) if (PHRASING[k]) tex += `${esc(k)} & ${v} & ${esc(PHRASING[k])}\\\\\n`;
tex += `\\bottomrule\\end{tabular}\\end{table}\n\n`;
tex += `\\begin{table}[t]\\centering\\small\n\\caption{Idioms that merge several constructs into one clause, and how often they fired on the corpus.}\\label{tab:idioms}\n\\begin{tabular}{p{9cm}r}\\toprule\nIdiom & Firings\\\\\\midrule\n`;
for (const [name] of IDIOMS) tex += `${esc(name)} & ${idioms[name] ?? 0}\\\\\n`;
tex += `\\bottomrule\\end{tabular}\\end{table}\n`;
writeFileSync(join(outDir, 'corpus-tables.tex'), tex);

// Vaccine materials in all three styles
const vac = JSON.parse(readFileSync(join(dir, 'VaccineProcurement.json'), 'utf8').replace(/^\ufeff/, ''));
for (const style of ['a', 'b', 'c'] as const) writeFileSync(join(outDir, `vaccine-style-${style}.md`), toMarkdown(vac, style, 'full'));
console.log(md.split('\n').slice(0, 60).join('\n'));
console.log(`\nwritten to ${outDir}`);
