/**
 * Integrated documentation export: one self-contained HTML file (inline CSS,
 * SVG and JS, no network) combining the contract overview, the domain class
 * diagram, the parties/norms/rules diagram, the access-control matrix, the
 * plain-language explanations in all three styles (switchable, with the
 * Brief/Full toggle), and the specification source with line anchors so every
 * identifier in the text jumps to where it is declared.
 */
import mermaid from 'mermaid';
import type { ContractModel } from '../model/api.js';
import { buildClassDiagramDef } from '../model/ClassDiagram.js';
import { buildRulesDiagramDef } from '../model/Diagram.js';
import { matrixTableHtml } from '../model/Matrix.js';
import type { ExplainNorm } from './types.js';
import { GLOSSARY, capitalize, joinList, overview, rulePhrase, slots, type NormSlots, type Rich } from './verbalize.js';
import { proseRich, type Detail } from './markdown.js';
import { gherkinNorm, gherkinText, type GLine } from './gherkin.js';
import { symboleoacKeywords, symboleoacControlKeywords, symboleoacBuiltins } from '../editor/symboleoac.monarch.js';
import type { ExplainStyle } from './ExplainView.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Ctx = { pos: Map<string, number>; kinds: Map<string, ExplainNorm['kind']> };

function richHtml(r: Rich, ctx: Ctx): string {
  return r.map((f) => {
    if (typeof f === 'string') return esc(f);
    if ('b' in f) return `<b>${esc(f.b)}</b>`;
    if ('i' in f) return `<span class="muted">${esc(f.i)}</span>`;
    if ('norm' in f) return `<a class="norm ${ctx.kinds.get(f.norm) ?? ''}" href="#norm-${esc(f.norm)}">${esc(f.norm)}</a>`;
    const line = ctx.pos.get(f.code.split('.')[0]);
    return line ? `<code class="id" data-line="${line}" title="Declared at line ${line}">${esc(f.code)}</code>` : `<code>${esc(f.code)}</code>`;
  }).join('');
}

const bullets = (items: Rich[], ctx: Ctx) =>
  items.length === 1 ? richHtml(items[0], ctx) : `<ul>${items.map((it) => `<li>${richHtml(it, ctx)}</li>`).join('')}</ul>`;
const empty = (t: string) => `<span class="empty">${esc(t)}</span>`;
const KIND: Record<ExplainNorm['kind'], string> = { obligation: 'Obligation', survivingObligation: 'Surviving obligation', power: 'Power' };

// ------------------------------------------------------------------ norm blocks

function factSheet(s: NormSlots, ctx: Ctx): string {
  const third = (b: boolean) => (b ? '<span class="muted"> — third party</span>' : '');
  const rows: [string, string, boolean][] = s.isPower ? [
    ['Who holds it', `${richHtml(s.debtorLong, ctx)}${third(s.debtorThird)}, against ${richHtml(s.creditorLong, ctx)}${third(s.creditorThird)}`, false],
    ['Arises', s.created ? `when ${richHtml(s.created, ctx)}` : 'at the start of the contract', false],
    ['Exercisable', s.binding ? `once ${bullets(s.binding, ctx)}` : 'at will (no further condition)', false],
    ['Effect', `<b>${richHtml(capitalize(s.must[0] ?? []), ctx)}</b>`, false],
  ] : [
    ['Who owes', `${richHtml(s.debtorLong, ctx)}${third(s.debtorThird)} to ${richHtml(s.creditorLong, ctx)}${third(s.creditorThird)}`, false],
    ['Created', s.created ? `each time ${richHtml(s.created, ctx)}` : 'at the start of the contract (no trigger)', false],
    ['Binding', s.binding ? `once ${bullets(s.binding, ctx)}` : 'immediately (no condition)', false],
    ['Must bring about', bullets(s.must, ctx), false],
    ['Deadline', s.deadlines.length ? bullets(s.deadlines, ctx) : empty('none stated'), true],
    ['Otherwise', 'the obligation is violated', true],
  ];
  if (s.survives) rows.push(['Survives', 'yes: still owed after the contract ends', true]);
  rows.push(['Access administered by', s.controller ? richHtml(s.controller, ctx) : empty('not specified'), true]);
  rows.push(['Refers to', s.dependsOn.length ? richHtml(joinList(s.dependsOn.map((n) => [{ norm: n }]), 'and'), ctx) : empty('no other norm'), true]);
  rows.push(['Referred to by', s.feeds.length ? richHtml(joinList(s.feeds.map((n) => [{ norm: n }]), 'and'), ctx) : empty('no other norm'), true]);
  rows.push(['Access rules', s.acRules.length ? `<ul>${s.acRules.map((r) => `<li>${richHtml(rulePhrase(r), ctx)}</li>`).join('')}</ul>` : empty(`none touch this ${s.isPower ? 'power' : 'obligation'}`), true]);
  const gloss: Record<string, string> = {
    'Created': GLOSSARY.trigger, 'Arises': GLOSSARY.trigger, 'Binding': GLOSSARY.antecedent, 'Exercisable': GLOSSARY.antecedent,
    'Must bring about': GLOSSARY.consequent, 'Effect': GLOSSARY.consequent, 'Otherwise': GLOSSARY.violation, 'Deadline': GLOSSARY.deadline,
    'Access administered by': GLOSSARY.controller, 'Access rules': GLOSSARY.acRules, 'Refers to': GLOSSARY.dependsOn, 'Referred to by': GLOSSARY.feeds,
    'Survives': GLOSSARY.survivingObligation, 'Who owes': GLOSSARY.obligation, 'Who holds it': GLOSSARY.power,
  };
  return `<dl class="sheet">${rows.map(([k, v, full]) =>
    `<div class="row${full ? ' full-only' : ''}"><dt title="${esc(gloss[k] ?? '')}">${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function prose(s: NormSlots, ctx: Ctx): string {
  const { main, tail } = proseRich(s, 'full');
  return `<div class="prose"><p>${richHtml(main, ctx)}</p>${tail.length ? `<p class="tail full-only">${richHtml(tail, ctx)}</p>` : ''}</div>`;
}

function gherkinHtml(lines: GLine[], ctx: Ctx): string {
  const quoted = (r: Rich): Rich => r.flatMap((f): Rich => (typeof f !== 'string' && ('code' in f || 'norm' in f) ? ['"', f, '"'] : [f]));
  const body = lines.map((l) => {
    const pad = '  '.repeat(Math.max(0, l.indent - 1));
    const full = l.full ? ' class="full-only"' : '';
    switch (l.kind) {
      case 'blank': return `<span${full}>\n</span>`;
      case 'header': return `<span${full}>${pad}<span class="gk struct">${esc(l.kw ?? '')}:</span>${l.text.length ? ' ' + richHtml(l.text, ctx) : ''}\n</span>`;
      case 'step': return `<span${full}>${pad}<span class="gk step">${esc(l.kw ?? '')}</span> ${richHtml(quoted(l.text), ctx)}\n</span>`;
      case 'comment': return `<span class="cmt${l.full ? ' full-only' : ''}">${pad}# ${esc(gherkinText(l.text))}\n</span>`;
      case 'row': return `<span class="row${l.full ? ' full-only' : ''}">${pad}${esc(gherkinText(l.text))}\n</span>`;
      default: return `<span class="desc${l.full ? ' full-only' : ''}">${pad}${richHtml(l.text, ctx)}\n</span>`;
    }
  }).join('');
  return `<pre class="gherkin">${body}</pre>`;
}

function normBlock(n: ExplainNorm, s: NormSlots, ctx: Ctx): string {
  return `<article class="norm-block ${s.kind}" id="norm-${esc(s.name)}">
<header><span class="kind" title="${esc(GLOSSARY[s.kind])}">${KIND[s.kind]}</span><code class="name">${esc(s.name)}</code><a class="src" href="#L${s.line}" data-line="${s.line}">line ${s.line}</a></header>
<div class="body">
<div class="style style-a">${factSheet(s, ctx)}</div>
<div class="style style-b">${prose(s, ctx)}</div>
<div class="style style-c">${gherkinHtml(gherkinNorm(n, s), ctx)}</div>
${s.authorNote ? `<p class="note full-only"><b>Specifier's note:</b> ${esc(s.authorNote)}</p>` : ''}
</div></article>`;
}

// ------------------------------------------------------------------ specification source

/**
 * Syntax colouring of the source with the same token classes as the editor's
 * Monarch grammar (keywords, control keywords, dotted built-ins, identifiers,
 * numbers, strings, operators, comments), rendered with the editor's dark
 * theme colours. Identifiers that name a declared element link to its
 * declaration line (except on that line itself; attribute names after "."
 * are not linked).
 */
function highlightSpec(source: string, decl: Map<string, number>): string {
  const KW = new Set(symboleoacKeywords), CTRL = new Set(symboleoacControlKeywords), BUILT = new Set(symboleoacBuiltins);
  const lines = source.replace(/^\ufeff/, '').split(/\r?\n/);
  let inBlockComment = false;
  const out: string[] = [];
  lines.forEach((line, idx) => {
    const ln = idx + 1;
    let i = 0;
    let html = '';
    while (i < line.length) {
      const rest = line.slice(i);
      let m: RegExpMatchArray | null;
      if (inBlockComment) {
        const end = rest.indexOf('*/');
        const chunk = end >= 0 ? rest.slice(0, end + 2) : rest;
        html += `<span class="t-comment">${esc(chunk)}</span>`;
        i += chunk.length;
        if (end >= 0) inBlockComment = false;
        continue;
      }
      if ((m = rest.match(/^[ \t]+/))) { html += m[0]; i += m[0].length; continue; }
      if (rest.startsWith('//')) { html += `<span class="t-comment">${esc(rest)}</span>`; break; }
      if (rest.startsWith('/*')) { inBlockComment = true; continue; }
      if ((m = rest.match(/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+/))) {
        // dotted: built-in (Math.pow, Date.add) or a reference chain (delivered.reqID)
        if (BUILT.has(m[0])) html += `<span class="t-predefined">${esc(m[0])}</span>`;
        else {
          const parts = m[0].split('.');
          html += parts.map((part, k) => (k === 0 ? ident(part, ln, decl) : `<span class="t-identifier">${esc(part)}</span>`)).join('<span class="t-delimiter">.</span>');
        }
        i += m[0].length; continue;
      }
      if ((m = rest.match(/^[A-Za-z_][\w]*/))) {
        const w = m[0];
        if (CTRL.has(w)) html += `<span class="t-control">${esc(w)}</span>`;
        else if (KW.has(w)) html += `<span class="t-keyword">${esc(w)}</span>`;
        else html += ident(w, ln, decl);
        i += w.length; continue;
      }
      if ((m = rest.match(/^\d+(?:\.\d+)?/))) { html += `<span class="t-number">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = rest.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/))) { html += `<span class="t-string">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = rest.match(/^(?::=|==|!=|>=|<=|->|[+\-*/%<>!:=])/))) { html += `<span class="t-operator">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = rest.match(/^[;,.(){}\[\]]/))) { html += `<span class="t-delimiter">${esc(m[0])}</span>`; i += 1; continue; }
      html += esc(rest[0]); i += 1;
    }
    out.push(`<span class="ln" id="L${ln}"><span class="n">${ln}</span>${html || ' '}</span>`);
  });
  return `<pre class="spec">${out.join('')}</pre>`;
}

function ident(w: string, line: number, decl: Map<string, number>): string {
  const target = decl.get(w);
  if (target && target !== line) return `<a class="ref t-identifier" href="#L${target}" data-line="${target}" title="Declared at line ${target}">${esc(w)}</a>`;
  if (target) return `<span class="t-identifier t-decl" title="Declaration">${esc(w)}</span>`;
  return `<span class="t-identifier">${esc(w)}</span>`;
}

// ------------------------------------------------------------------ document

export type DocOptions = { style: ExplainStyle; detail: Detail };

export async function buildDocumentHtml(model: ContractModel, source: string, opts: DocOptions): Promise<string> {
  const ex = model.explain!;
  const rules = model.rules ?? [];
  const ov = overview(ex.contract, ex.norms, rules);
  const pos = new Map<string, number>();
  for (const v of model.variables ?? []) pos.set(v.name, v.line);
  for (const r of rules) pos.set(r.name, r.line);
  for (const n of ex.norms) pos.set(n.name, n.line);
  const ctx: Ctx = { pos, kinds: new Map(ex.norms.map((n) => [n.name, n.kind])) };
  const decl = new Map<string, number>(pos);
  for (const items of Object.values(model.domainCategories ?? {})) for (const t of items) decl.set(t.name, t.line);
  const contractLine = model.keywords?.['Contract']?.line;
  if (contractLine) for (const p of ex.contract.parameters) if (!decl.has(p.name)) decl.set(p.name, contractLine);
  const name = ex.contract.name || model.contractName || 'Contract';

  // Diagrams: rendered here (light theme) and inlined as SVG.
  mermaid.initialize({
    startOnLoad: false, theme: 'default', securityLevel: 'loose',
    flowchart: { useMaxWidth: false, curve: 'basis' },
    class: { useMaxWidth: false, hideEmptyMembersBox: true },
  });
  const hasTypes = model.domainModel.types.length + model.domainModel.enums.length > 0;
  const hasNorms = ex.norms.length + rules.length > 0;
  // Both layouts are embedded so the reader can pick: left-to-right stacks classes in
  // tall columns, top-to-bottom spreads them in wide rows. Default: the one closer to
  // the page's aspect ratio.
  const render = async (id: string, def: string) => {
    try { return (await mermaid.render(`${id}-${Date.now()}`, def)).svg; }
    catch (e) { return `<p class="empty">diagram error: ${esc(String(e))}</p>`; }
  };
  const figure = async (id: string, defs: { LR: string; TB: string }) => {
    const svgs = { LR: await render(`${id}-lr`, defs.LR), TB: await render(`${id}-tb`, defs.TB) };
    const dims = (svg: string) => { const m = svg.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"\s*/); return m ? { w: Math.round(+m[1]), h: Math.round(+m[2]) } : null; };
    const dLR = dims(svgs.LR), dTB = dims(svgs.TB);
    // prefer the layout that fits a ~1200px page without shrinking below ~70%
    const dir = dTB && dTB.w <= 1700 ? 'TB' : 'LR';
    const size = (d: { w: number; h: number } | null) => (d ? ` (${d.w}×${d.h})` : '');
    return `<figure class="diagram" data-dir="${dir}" data-fit="fit">
<div class="figbar"><span class="seg"><button type="button" data-dir="LR">Left → right${size(dLR)}</button><button type="button" data-dir="TB">Top → bottom${size(dTB)}</button></span>
<span class="seg"><button type="button" data-fit="fit">Fit width</button><button type="button" data-fit="actual">Actual size</button></span></div>
<div class="svg LR" style="--w:${dLR?.w ?? 800}px">${svgs.LR}</div><div class="svg TB" style="--w:${dTB?.w ?? 800}px">${svgs.TB}</div></figure>`;
  };
  const domainFig = hasTypes ? await figure('doc-domain', { LR: buildClassDiagramDef(model, 'LR'), TB: buildClassDiagramDef(model, 'TB') }) : '';
  const rulesFig = hasNorms ? await figure('doc-rules', { LR: buildRulesDiagramDef(model, 'LR').def, TB: buildRulesDiagramDef(model, 'TB').def }) : '';

  const field = (label: string, body: string, full = false) => `<div class="field${full ? ' span' : ''}"><div class="eyebrow">${esc(label)}</div><div>${body}</div></div>`;
  const list = (items: Rich[], emptyText: string) => (items.length ? `<ul>${items.map((f) => `<li>${richHtml(f, ctx)}</li>`).join('')}</ul>` : empty(emptyText));
  const c = ov.counts;
  const overviewHtml = `<div class="overview">
${field('Summary', richHtml(ov.summary, ctx), true)}
${field('Fixed when the contract is created', list(ov.fixed, 'nothing besides the parties'))}
${field('Comes into force only if', (ov.preconditions.length ? bullets(ov.preconditions, ctx) : empty('no preconditions')) + (ov.timeUnit ? `<div class="muted">Time is counted in ${esc(ov.timeUnit)}.</div>` : ''))}
${field('What the parties owe', `<ul><li>${c.obligations} obligation${c.obligations === 1 ? '' : 's'} within the contract</li><li>${c.surviving} obligation${c.surviving === 1 ? '' : 's'} that survive${c.surviving === 1 ? 's' : ''} termination</li><li>${c.powers} power${c.powers === 1 ? '' : 's'}</li></ul>`)}
${field('How it can end', list(ov.ends.map(capitalize), 'no power terminates the contract'))}
${ov.survives.length ? field('Still owed after it ends', list(ov.survives, '')) : ''}
${field('Who controls access to information', ov.access ? richHtml(ov.access, ctx) : empty('no access-control policy'))}
${ov.sensors.length ? field('Monitoring', list(ov.sensors, '')) : ''}
${ov.postconditions.length ? field('When it ends, the following must hold', bullets(ov.postconditions, ctx)) : ''}
${ov.constraints.length ? field('Throughout the contract', bullets(ov.constraints, ctx)) : ''}
${ov.lifecycle.length ? field('Normal course (obligations in dependency order)', `<ol>${ov.lifecycle.map((f) => `<li>${richHtml(f, ctx)}</li>`).join('')}</ol>`, true) : ''}
${ov.observations.length ? field('Observations', `<ul class="muted">${ov.observations.map((f) => `<li>${richHtml(f, ctx)}</li>`).join('')}</ul>`, true) : ''}
</div>`;

  const group = (kind: ExplainNorm['kind'], title: string, lede: string) => {
    const ns = ex.norms.filter((n) => n.kind === kind);
    if (!ns.length) return '';
    return `<section id="${kind}s"><h2>${esc(title)}</h2>${lede ? `<p class="lede">${esc(lede)}</p>` : ''}${ns.map((n) => normBlock(n, slots(n, rules), ctx)).join('\n')}</section>`;
  };

  const ruleList = rules.length ? `<ul class="rules">${rules.map((r) => `<li>${richHtml(rulePhrase(r), ctx)}</li>`).join('')}</ul>` : '';
  const specHtml = highlightSpec(source, decl);

  const contents: [string, string][] = [
    ['overview', 'Overview'], ...(hasTypes ? [['domain', 'Domain'] as [string, string]] : []), ...(hasNorms ? [['relations', 'Parties & norms'] as [string, string]] : []),
    ...(rules.length ? [['policy', 'Access policy'] as [string, string]] : []),
    ...(ex.norms.some((n) => n.kind === 'obligation') ? [['obligations', 'Obligations'] as [string, string]] : []),
    ...(ex.norms.some((n) => n.kind === 'survivingObligation') ? [['survivingObligations', 'Surviving obligations'] as [string, string]] : []),
    ...(ex.norms.some((n) => n.kind === 'power') ? [['powers', 'Powers'] as [string, string]] : []),
    ['specification', 'Specification'],
  ];

  return `<!doctype html>
<html lang="en" data-style="${opts.style}" data-detail="${opts.detail}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — documentation</title>
<style>
${CSS}
</style>
</head>
<body>
<header class="top">
  <div class="title"><b>${esc(name)}</b><span class="muted"> · contract documentation</span></div>
  <nav class="contents">${contents.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>
  <div class="controls">
    <span class="seg" role="group" aria-label="Explanation style">
      <button type="button" data-set-style="a" title="Labelled slots, one per element of the formal norm">Fact sheet</button><button type="button" data-set-style="b" title="One paragraph per norm">Plain-English clause</button><button type="button" data-set-style="c" title="Each norm as a Gherkin Rule with one scenario per outcome">Gherkin</button>
    </span>
    <span class="seg" role="group" aria-label="Detail level">
      <button type="button" data-set-detail="brief" title="Only who, when and what">Brief</button><button type="button" data-set-detail="full" title="All slots, cross-references and notes">Full</button>
    </span>
    <button type="button" class="plain" onclick="window.print()" title="Print or save as PDF">Print</button>
  </div>
</header>
<main>
<section id="overview"><h2>The contract as a whole</h2>${overviewHtml}</section>
${hasTypes ? `<section id="domain"><h2>Domain</h2><p class="lede">The domain model as a UML class diagram: base types (Role / Asset / Event / DataTransfer), inheritance, «Enumeration» and «thirdParty» stereotypes, and named associations for domain-typed attributes.</p>${domainFig}</section>` : ''}
${hasNorms ? `<section id="relations"><h2>Parties &amp; norms</h2><p class="lede">Parties (blue) with obligations (solid) and powers (dashed), debtor → creditor. Rules (yellow) point to their <i>To</i> role: green = Grant, red = Revoke, labelled with the permission.</p>${rulesFig}</section>` : ''}
${rules.length ? `<section id="policy"><h2>Access policy</h2><p class="lede">Roles (rows) × resources (columns).${ex.contract.acControllers.length ? ` Policy controller: <b>${esc(ex.contract.acControllers.join(', '))}</b>.` : ''}</p><div class="tablewrap">${matrixTableHtml(model)}</div>${ruleList}</section>` : ''}
${group('obligation', 'Obligations', '')}
${group('survivingObligation', 'Surviving obligations', 'These remain enforceable after the contract has ended.')}
${group('power', 'Powers', '')}
<section id="specification"><h2>Specification</h2><p class="lede">The SymboleoAC source this documentation was generated from, coloured as in the editor. Identifiers in the text above jump to their declaration here; inside the source, references are linked to their declarations.</p>${specHtml}</section>
</main>
<footer>Generated by the SymboleoAC Web IDE from the specification of <code>${esc(name)}</code>. The explanations are derived mechanically from the specification; specifier's notes are the author's comments.</footer>
<script>
${JS}
</script>
</body>
</html>
`;
}

const CSS = `
:root { --paper:#f7f8f6; --panel:#fff; --ink:#1e262b; --muted:#66707a; --line:#d8ddd9; --code:#eef0ec; --accent:#2e5e8c;
  --obl:#2e5e8c; --obl-soft:#e7eef6; --surv:#1d7a6c; --surv-soft:#e3f1ee; --pow:#9c5a18; --pow-soft:#f7ecdf; --note:#f1f0e6; }
* { box-sizing: border-box; }
body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
code { font: 13px/1 ui-monospace, Consolas, monospace; background: var(--code); padding: 1px 4px; border-radius: 3px; }
code.id { cursor: pointer; text-decoration: underline dotted; }
a { color: var(--accent); }
a.norm { font: 13px ui-monospace, Consolas, monospace; text-decoration: underline dotted; }
a.norm.obligation { color: var(--obl); } a.norm.survivingObligation { color: var(--surv); } a.norm.power { color: var(--pow); }
.muted { color: var(--muted); } .empty { color: var(--muted); font-style: italic; }
header.top { position: sticky; top: 0; z-index: 2; background: var(--panel); border-bottom: 1px solid var(--line); padding: 8px 20px; display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
header.top .title { font-size: 16px; }
nav.contents { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 13px; }
.controls { margin-left: auto; display: flex; gap: 10px; align-items: center; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
.seg button { font: 600 12.5px/1.2 inherit; font-family: inherit; padding: 5px 10px; border: 0; border-right: 1px solid var(--line); background: var(--panel); color: var(--muted); cursor: pointer; }
.seg button:last-child { border-right: 0; }
.seg button[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
button.plain { font: 600 12.5px inherit; font-family: inherit; padding: 5px 10px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); color: var(--muted); cursor: pointer; }
main { max-width: 1500px; margin: 0 auto; padding: 12px 24px 60px; }
h2 { font-size: 20px; margin: 34px 0 8px; }
.lede { color: var(--muted); margin: 0 0 10px; max-width: 70ch; }
.overview { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px 26px; }
.field .eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin-bottom: 3px; }
.field.span { grid-column: 1 / -1; }
ul, ol { margin: 0; padding-left: 20px; } li { margin: 2px 0; }
figure.diagram { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px; overflow: auto; }
figure.diagram .figbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
figure.diagram .svg { overflow: auto; }
figure.diagram svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
figure.diagram[data-dir="LR"] .svg.TB, figure.diagram[data-dir="TB"] .svg.LR { display: none; }
figure.diagram[data-fit="actual"] svg { width: var(--w) !important; max-width: none !important; margin: 0; }
.tablewrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
table { border-collapse: collapse; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 5px 9px; vertical-align: top; text-align: left; white-space: nowrap; }
thead th { background: #f0f3f7; } th.corner { background: #e8ecf1; } th.role { background: #f7f9fb; font-weight: 600; }
.grant { color: #1a7f37; } .revoke { color: #b42318; }
ul.rules { margin-top: 10px; font-size: 14px; }
.norm-block { margin-top: 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; scroll-margin-top: 90px; }
.norm-block header { display: flex; align-items: baseline; gap: 10px; padding: 9px 16px; border-bottom: 1px solid var(--line); }
.norm-block header .kind { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; padding: 2px 7px; border-radius: 3px; cursor: help; }
.obligation header .kind { color: var(--obl); background: var(--obl-soft); } .survivingObligation header .kind { color: var(--surv); background: var(--surv-soft); } .power header .kind { color: var(--pow); background: var(--pow-soft); }
.norm-block header code.name { font-size: 14px; font-weight: 600; background: none; }
.norm-block header .src { margin-left: auto; font-size: 12.5px; color: var(--muted); }
.norm-block .body { padding: 12px 16px 14px; }
.norm-block.flash { outline: 2px solid var(--accent); }
dl.sheet { margin: 0; display: grid; grid-template-columns: 160px 1fr; gap: 6px 14px; }
dl.sheet .row { display: contents; }
dl.sheet dt { color: var(--muted); font-weight: 600; font-size: 12.5px; cursor: help; } dl.sheet dd { margin: 0; }
.prose { max-width: 70ch; } .prose p { margin: 0; } .prose .tail { margin-top: 8px; color: var(--muted); font-size: 13.5px; }
.rule { display: grid; grid-template-columns: 96px 1fr; gap: 5px 12px; }
.rule .kw { font: 600 11.5px/1.7 ui-monospace, Consolas, monospace; letter-spacing: .05em; text-transform: uppercase; }
.obligation .rule .kw { color: var(--obl); } .survivingObligation .rule .kw { color: var(--surv); } .power .rule .kw { color: var(--pow); }
.rule .foot { grid-column: 1 / -1; color: var(--muted); font-size: 13.5px; border-top: 1px dashed var(--line); padding-top: 6px; margin-top: 4px; }
pre.gherkin { margin: 0; font: 13px/1.55 ui-monospace, Consolas, monospace; white-space: pre-wrap; } pre.gherkin .gk { font-weight: 600; } pre.gherkin .gk.struct { color: var(--accent); }
.obligation pre.gherkin .gk.step { color: var(--obl); } .survivingObligation pre.gherkin .gk.step { color: var(--surv); } .power pre.gherkin .gk.step { color: var(--pow); }
pre.gherkin .desc, pre.gherkin .cmt, pre.gherkin .row { color: var(--muted); }
.note { margin: 12px 0 0; padding: 7px 11px; background: var(--note); border-radius: 4px; color: var(--muted); font-style: italic; font-size: 13.5px; } .note b { font-style: normal; color: var(--ink); }
html[data-style="a"] .style:not(.style-a), html[data-style="b"] .style:not(.style-b), html[data-style="c"] .style:not(.style-c) { display: none; }
html[data-detail="brief"] .full-only { display: none !important; }
pre.spec { background: #1e1e1e; color: #d4d4d4; border-radius: 8px; padding: 10px 0; overflow-x: auto; font: 13px/1.45 Consolas, "Courier New", ui-monospace, monospace; margin: 0; }
pre.spec .ln { display: block; padding: 0 12px; scroll-margin-top: 90px; white-space: pre; } pre.spec .ln .n { display: inline-block; width: 3.5em; color: #858585; user-select: none; }
pre.spec .ln.flash { background: #3a3d41; }
.t-keyword { color: #569cd6; } .t-control { color: #c586c0; } .t-predefined { color: #dcdcaa; } .t-identifier { color: #9cdcfe; }
.t-number { color: #b5cea8; } .t-string { color: #ce9178; } .t-comment { color: #6a9955; } .t-operator, .t-delimiter { color: #d4d4d4; }
pre.spec a.ref { text-decoration: underline dotted; } pre.spec a.ref:hover { text-decoration: underline; }
pre.spec .t-decl { font-weight: 600; }
footer { max-width: 1500px; margin: 0 auto; padding: 0 24px 40px; color: var(--muted); font-size: 12.5px; }
@media (max-width: 640px) { dl.sheet, .rule { grid-template-columns: 1fr; } }
@media print { header.top { position: static; } .controls, nav.contents { display: none; } .norm-block, figure.diagram, .tablewrap { break-inside: avoid; } body { background: #fff; } }
`;

const JS = `
(function () {
  var root = document.documentElement;
  function sync() {
    document.querySelectorAll('[data-set-style]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.setStyle === root.dataset.style)); });
    document.querySelectorAll('[data-set-detail]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.setDetail === root.dataset.detail)); });
  }
  document.querySelectorAll('[data-set-style]').forEach(function (b) { b.addEventListener('click', function () { root.dataset.style = b.dataset.setStyle; sync(); }); });
  document.querySelectorAll('[data-set-detail]').forEach(function (b) { b.addEventListener('click', function () { root.dataset.detail = b.dataset.setDetail; sync(); }); });
  sync();
  function syncFig(fig) {
    fig.querySelectorAll('[data-dir]').forEach(function (b) { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.dir === fig.dataset.dir)); });
    fig.querySelectorAll('[data-fit]').forEach(function (b) { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.fit === fig.dataset.fit)); });
  }
  document.querySelectorAll('figure.diagram').forEach(function (fig) {
    syncFig(fig);
    fig.querySelectorAll('button[data-dir]').forEach(function (b) { b.addEventListener('click', function () { fig.dataset.dir = b.dataset.dir; syncFig(fig); }); });
    fig.querySelectorAll('button[data-fit]').forEach(function (b) { b.addEventListener('click', function () { fig.dataset.fit = b.dataset.fit; syncFig(fig); }); });
  });
  function flash(el, cls) { el.classList.add(cls); setTimeout(function () { el.classList.remove(cls); }, 1500); }
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!(t instanceof Element)) return;
    var idEl = t.closest('code.id, a.src, a.ref');
    if (idEl && idEl.dataset.line) {
      var ln = document.getElementById('L' + idEl.dataset.line);
      if (ln) { ev.preventDefault(); ln.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(ln, 'flash'); }
      return;
    }
    var link = t.closest('a.norm');
    if (link) {
      var target = document.getElementById(link.getAttribute('href').slice(1));
      if (target) { ev.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); flash(target, 'flash'); }
    }
  });
})();
`;
