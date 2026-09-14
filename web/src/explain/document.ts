/**
 * Integrated documentation export: one self-contained HTML file (inline CSS,
 * SVG and JS, no network) combining the contract overview, the domain class
 * diagram, the parties/norms/rules diagram, the access-control matrix, the
 * plain-language explanations in all three styles (switchable, with the
 * Brief/Full toggle), and the specification source with line anchors so every
 * identifier in the text jumps to where it is declared.
 */
import mermaid from 'mermaid';
import type { ContractModel, RuleModel } from '../model/api.js';
import { buildClassDiagramDef } from '../model/ClassDiagram.js';
import { buildRulesDiagramDef } from '../model/Diagram.js';
import { matrixTableHtml } from '../model/Matrix.js';
import type { ExplainNorm } from './types.js';
import { GLOSSARY, capitalize, joinList, overview, rulePhrase, slots, type NormSlots, type Rich } from './verbalize.js';
import { proseRich, type Detail } from './markdown.js';
import { gherkinNorm, gherkinText, gherkinNormDiff, scenarioNames, type GDiffLine } from './gherkin.js';
import type { ContractDiff, NormChange, SlotChange } from './diff.js';
import { symboleoacKeywords, symboleoacControlKeywords, symboleoacBuiltins } from '../editor/symboleoac.monarch.js';
import { currentTheme } from '../editor/theme.js';

/** Kind of a declared identifier, for the same colours as the editor's semantic tokens. */
type IdKind = 'type' | 'enumMember' | 'attribute' | 'parameter' | 'instance' | 'event' | 'norm' | 'rule';
type Decls = { line: Map<string, number>; kind: Map<string, IdKind>; attrs: Set<string> };
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

function gherkinHtml(lines: GDiffLine[], ctx: Ctx): string {
  const quoted = (r: Rich): Rich => r.flatMap((f): Rich => (typeof f !== 'string' && ('code' in f || 'norm' in f) ? ['"', f, '"'] : [f]));
  const marked = lines.some((l) => l.mark);
  const cls = (l: GDiffLine, base = '') => {
    const parts = [base, l.full ? 'full-only' : '', l.mark === 'added' ? 'g-add' : l.mark === 'removed' ? 'g-del' : ''].filter(Boolean);
    return parts.length ? ` class="${parts.join(' ')}"` : '';
  };
  // With a baseline, a two-character gutter: "+" added, "−" removed.
  const gut = (l: GDiffLine) => (marked ? `<span class="g-gutter">${l.mark === 'added' ? '+ ' : l.mark === 'removed' ? '− ' : '  '}</span>` : '');
  const body = lines.map((l) => {
    const pad = '  '.repeat(Math.max(0, l.indent - 1));
    switch (l.kind) {
      case 'blank': return `<span${cls(l)}>${marked ? '  ' : ''}\n</span>`;
      case 'header': return `<span${cls(l)}>${gut(l)}${pad}<span class="gk struct">${esc(l.kw ?? '')}:</span>${l.text.length ? ' ' + richHtml(l.text, ctx) : ''}\n</span>`;
      case 'step': return `<span${cls(l)}>${gut(l)}${pad}<span class="gk step">${esc(l.kw ?? '')}</span> ${richHtml(quoted(l.text), ctx)}\n</span>`;
      case 'comment': return `<span${cls(l, 'cmt')}>${gut(l)}${pad}# ${esc(gherkinText(l.text))}\n</span>`;
      case 'row': return `<span${cls(l, 'row')}>${gut(l)}${pad}${esc(gherkinText(l.text))}\n</span>`;
      default: return `<span${cls(l, 'desc')}>${gut(l)}${pad}${richHtml(l.text, ctx)}\n</span>`;
    }
  }).join('');
  return `<pre class="gherkin">${body}</pre>`;
}

const chgBadge = (c: NormChange | undefined) => (c && c.change !== 'unchanged'
  ? `<span class="chg chg-${c.change}">${c.change === 'renamed' ? `renamed from <code>${esc(c.oldName ?? '')}</code>` : c.change}${c.noteChanged ? ', note changed' : ''}</span>` : '');

function normBlock(n: ExplainNorm, s: NormSlots, ctx: Ctx, chg?: NormChange, renames?: Map<string, string>): string {
  const gherkinLines: GDiffLine[] = chg?.oldNorm && chg.old && renames ? gherkinNormDiff(chg.oldNorm, chg.old, n, s, renames).lines : gherkinNorm(n, s);
  return `<article class="norm-block ${s.kind}${chg ? ` changed-${chg.change}` : ''}" id="norm-${esc(s.name)}">
<header><span class="kind" title="${esc(GLOSSARY[s.kind])}">${KIND[s.kind]}</span><code class="name">${esc(s.name)}</code>${chgBadge(chg)}<a class="src" href="#L${s.line}" data-line="${s.line}">line ${s.line}</a></header>
<div class="body">
<div class="style style-a">${factSheet(s, ctx)}</div>
<div class="style style-b">${prose(s, ctx)}</div>
<div class="style style-c">${gherkinHtml(gherkinLines, ctx)}</div>
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
function highlightSpec(source: string, decl: Decls): string {
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
          // `obligations.X` / `powers.X`: the prefix is grammar keyword, X a norm reference.
          const normRef = parts.length === 2 && (parts[0] === 'obligations' || parts[0] === 'powers');
          html += parts.map((part, k) => (k === 0
            ? (normRef ? `<span class="t-keyword">${esc(part)}</span>` : ident(part, ln, decl))
            : (normRef ? ident(part, ln, decl) : `<span class="t-attribute">${esc(part)}</span>`))).join('<span class="t-delimiter">.</span>');
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

function ident(w: string, line: number, decl: Decls): string {
  const target = decl.line.get(w);
  const kind = decl.kind.get(w);
  const cls = kind ? `t-${kind}` : decl.attrs.has(w) ? 't-attribute' : 't-identifier';
  if (target && target !== line) return `<a class="ref ${cls}" href="#L${target}" data-line="${target}" title="Declared at line ${target}">${esc(w)}</a>`;
  if (target) return `<span class="${cls} t-decl" title="Declaration">${esc(w)}</span>`;
  return `<span class="${cls}">${esc(w)}</span>`;
}

// ------------------------------------------------------------------ changes since a baseline (issue #15)

function changesHtml(diff: ContractDiff, ctx: Ctx, norms: ExplainNorm[], rules: RuleModel[]): string {
  const codes = (xs: string[]) => xs.map((x) => `<code>${esc(x)}</code>`).join(', ');
  const slotList = (sc: SlotChange[]) => `<ul class="slots">${sc.map((c) => c.added.length || c.removed.length
    ? `<li><span class="slot">${esc(c.slot)}:</span><ul>${c.added.map((r) => `<li><span class="chg chg-added">added</span>${richHtml(r, ctx)}</li>`).join('')}${c.removed.map((r) => `<li><span class="chg chg-removed">removed</span><span class="gone">${richHtml(r, ctx)}</span></li>`).join('')}</ul></li>`
    : `<li><span class="slot">${esc(c.slot)}:</span> ${c.before ? `<span class="gone">${richHtml(c.before, ctx)}</span>` : empty('nothing')} <span class="muted">→</span> ${c.after ? richHtml(c.after, ctx) : empty('nothing')}</li>`).join('')}</ul>`;
  const kindWord = (k: ExplainNorm['kind']) => (k === 'survivingObligation' ? 'surviving obligation' : k);
  const scen = (n: NormChange): string => {
    const cur = norms.find((x) => x.name === n.name);
    const parts: string[] = [];
    if (n.change === 'added' && cur) parts.push(`scenarios added: ${codes(scenarioNames(cur, slots(cur, rules)))}`);
    else if (n.change === 'removed' && n.oldNorm && n.old) parts.push(`scenarios removed: ${codes(scenarioNames(n.oldNorm, n.old))}`);
    else if (cur && n.oldNorm && n.old) {
      const d = gherkinNormDiff(n.oldNorm, n.old, cur, slots(cur, rules), diff.renames);
      if (d.changed.length) parts.push(`scenarios changed: ${codes(d.changed)}`);
      if (d.added.length) parts.push(`scenarios added: ${codes(d.added)}`);
      if (d.removed.length) parts.push(`scenarios removed: ${codes(d.removed)}`);
    }
    return parts.length ? `<div class="muted scen">${parts.join(' · ')}</div>` : '';
  };
  const changedNorms = diff.norms.filter((n) => n.change !== 'unchanged');
  const count = (k: string) => changedNorms.filter((n) => n.change === k).length;
  if (diff.total === 0) return `<p class="lede">No change in meaning since <b>${esc(diff.baselineName)}</b>: both versions describe the same contract (formatting and comments aside).</p>`;
  let html = `<p class="lede">${diff.total} change${diff.total === 1 ? '' : 's'} in meaning since <b>${esc(diff.baselineName)}</b>${changedNorms.length ? `: norms ${count('added')} added, ${count('removed')} removed, ${count('changed')} changed, ${count('renamed')} renamed` : ''}${diff.items.length ? `; ${diff.items.length} in declarations, domain or access rules` : ''}${diff.overview.length ? `; ${diff.overview.length} in the contract overview` : ''}. Formatting and comment edits are not counted. Changed norms carry a badge below; in the Gherkin style, their baseline steps appear struck through.</p>`;
  if (changedNorms.length) {
    html += `<div class="eyebrow">Obligations and powers</div><ul class="changes">${changedNorms.map((n) => {
      const head = n.change === 'removed' ? `<code class="gone">${esc(n.name)}</code>` : `<a class="norm ${n.kind}" href="#norm-${esc(n.name)}">${esc(n.name)}</a>`;
      const meta = `<span class="muted"> (${kindWord(n.kind)}${n.oldName ? `, was <code>${esc(n.oldName)}</code>` : ''}${n.noteChanged ? ", specifier's note changed" : ''})</span>`;
      const was = n.change === 'removed' && n.old
        ? `<div class="muted">was: ${richHtml(n.old.debtorLong, ctx)} ${n.old.isPower ? 'held a power against' : 'owed'} ${richHtml(n.old.creditorLong, ctx)}${n.old.must.length ? `; ${n.old.isPower ? 'effect' : 'had to bring about'}: ${richHtml(joinList(n.old.must, 'and'), ctx)}` : ''}</div>` : '';
      return `<li><span class="chg chg-${n.change}">${n.change}</span>${head}${meta}${was}${n.slots.length ? slotList(n.slots) : ''}${scen(n)}</li>`;
    }).join('')}</ul>`;
  }
  for (const g of ['Declarations', 'Parameters', 'Domain', 'Access rules']) {
    const xs = diff.items.filter((it) => it.group === g);
    if (!xs.length) continue;
    html += `<div class="eyebrow">${esc(g)}</div><ul class="changes">${xs.map((it) => {
      const before = it.before ? richHtml(it.before, ctx) : '', after = it.after ? richHtml(it.after, ctx) : '';
      const body = it.change === 'added' ? after : it.change === 'removed' ? `<span class="gone">${before}</span>`
        : it.change === 'renamed' ? `<code>${esc(it.oldName ?? '')}</code> <span class="muted">→</span> ${after}` : `<span class="gone">${before}</span> <span class="muted">→</span> ${after}`;
      return `<li><span class="chg chg-${it.change}">${it.change}</span>${body}${it.line ? ` <a class="src" href="#L${it.line}" data-line="${it.line}">line ${it.line}</a>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  if (diff.overview.length) html += `<div class="eyebrow">The contract as a whole</div>${slotList(diff.overview)}`;
  return html;
}

// ------------------------------------------------------------------ document

export type DocOptions = { style: ExplainStyle; detail: Detail; diff?: ContractDiff | null };

export async function buildDocumentHtml(model: ContractModel, source: string, opts: DocOptions): Promise<string> {
  const ex = model.explain!;
  const rules = model.rules ?? [];
  const ov = overview(ex.contract, ex.norms, rules);
  const pos = new Map<string, number>();
  for (const v of model.variables ?? []) pos.set(v.name, v.line);
  for (const r of rules) pos.set(r.name, r.line);
  for (const n of ex.norms) pos.set(n.name, n.line);
  const ctx: Ctx = { pos, kinds: new Map(ex.norms.map((n) => [n.name, n.kind])) };
  // Declarations: line of each declared name and its kind, as the editor's semantic tokens classify them.
  const decl: Decls = { line: new Map<string, number>(pos), kind: new Map(), attrs: new Set() };
  for (const items of Object.values(model.domainCategories ?? {})) for (const t of items) decl.line.set(t.name, t.line);
  const contractLine = model.keywords?.['Contract']?.line;
  if (contractLine) for (const p of ex.contract.parameters) if (!decl.line.has(p.name)) decl.line.set(p.name, contractLine);
  for (const t of model.domainModel?.types ?? []) { decl.kind.set(t.name, 'type'); for (const a of t.attributes) if (a.name) decl.attrs.add(a.name); }
  for (const e of model.domainModel?.enums ?? []) { decl.kind.set(e.name, 'type'); for (const it of e.items) decl.kind.set(it, 'enumMember'); }
  for (const p of ex.contract.parameters) decl.kind.set(p.name, 'parameter');
  for (const v of [...ex.contract.parties, ...ex.contract.assets, ...ex.contract.sensors, ...ex.contract.others]) decl.kind.set(v.var, 'instance');
  for (const v of ex.contract.events) decl.kind.set(v.var, 'event');
  for (const n of ex.norms) decl.kind.set(n.name, 'norm');
  for (const r of rules) decl.kind.set(r.name, 'rule');
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
    return `<section id="${kind}s"><h2>${esc(title)}</h2>${lede ? `<p class="lede">${esc(lede)}</p>` : ''}${ns.map((n) => normBlock(n, slots(n, rules), ctx, diff?.norms.find((c) => c.name === n.name && c.change !== 'unchanged' && c.change !== 'removed'), diff?.renames)).join('\n')}</section>`;
  };

  const diff = opts.diff ?? null;
  const ruleList = rules.length ? `<ul class="rules">${rules.map((r) => `<li>${richHtml(rulePhrase(r), ctx)}</li>`).join('')}</ul>` : '';
  const specHtml = highlightSpec(source, decl);

  const contents: [string, string][] = [
    ['overview', 'Overview'], ...(diff ? [['changes', 'Changes'] as [string, string]] : []), ...(hasTypes ? [['domain', 'Domain'] as [string, string]] : []), ...(hasNorms ? [['relations', 'Parties & norms'] as [string, string]] : []),
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
${cssFor()}
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
${diff ? `<section id="changes"><h2>Changes since ${esc(diff.baselineName)}</h2>${changesHtml(diff, ctx, ex.norms, rules)}</section>` : ''}
${hasTypes ? `<section id="domain"><h2>Domain</h2><p class="lede">The domain model as a UML class diagram: base types (Role / Asset / Event / DataTransfer), inheritance, «Enumeration» and «thirdParty» stereotypes, and named associations for domain-typed attributes.</p>${domainFig}</section>` : ''}
${hasNorms ? `<section id="relations"><h2>Parties &amp; norms</h2><p class="lede">Parties (blue) with obligations (solid) and powers (dashed), debtor → creditor. Rules (yellow) point to their <i>To</i> role: green = Grant, red = Revoke, labelled with the permission.</p>${rulesFig}</section>` : ''}
${rules.length ? `<section id="policy"><h2>Access policy</h2><p class="lede">Roles (rows) × resources (columns).${ex.contract.acControllers.length ? ` Policy controller: <b>${esc(ex.contract.acControllers.join(', '))}</b>.` : ''}</p><div class="tablewrap">${matrixTableHtml(model)}</div>${ruleList}</section>` : ''}
${group('obligation', 'Obligations', '')}
${group('survivingObligation', 'Surviving obligations', 'These remain enforceable after the contract has ended.')}
${group('power', 'Powers', '')}
<section id="specification"><h2>Specification</h2><p class="lede">The SymboleoAC source this documentation was generated from, coloured as in the editor. Identifiers in the text above jump to their declaration here; inside the source, references are linked to their declarations.</p>${specHtml}</section>
</main>
<footer>Generated by the SymboleoAC Web IDE from the specification of <code>${esc(name)}</code>${diff ? `, compared with <code>${esc(diff.baselineName)}</code>` : ''}. The explanations are derived mechanically from the specification; specifier's notes are the author's comments.</footer>
<script>
${JS}
</script>
</body>
</html>
`;
}

/** Stylesheet of the document; the specification block reproduces the editor's selected theme. */
function cssFor(theme = currentTheme()): string {
  const dark = theme.base === 'vs-dark';
  const syn = theme.syntax;
  const sem = theme.semantic ?? { type: syn.identifier, enumMember: syn.identifier, attribute: syn.identifier, parameter: syn.identifier, instance: syn.identifier, event: syn.identifier, norm: syn.identifier, rule: syn.identifier };
  const semanticOn = theme.semantic !== null;
  const specBg = dark ? '#1e1e1e' : '#fffffe';
  const lineNo = dark ? '#858585' : '#9a9a9a';
  const flash = dark ? '#3a3d41' : '#e6eef7';
  return `
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
pre.spec { background: ${specBg}; color: #${syn.identifier}; border: 1px solid var(--line); border-radius: 8px; padding: 10px 0; overflow-x: auto; font: 13px/1.45 Consolas, "Courier New", ui-monospace, monospace; margin: 0; }
pre.spec .ln { display: block; padding: 0 12px; scroll-margin-top: 90px; white-space: pre; } pre.spec .ln .n { display: inline-block; width: 3.5em; color: ${lineNo}; user-select: none; }
pre.spec .ln.flash { background: ${flash}; }
.t-keyword { color: #${syn.keyword}; } .t-control { color: #${syn.control}; } .t-predefined { color: #${syn.predefined}; } .t-identifier { color: #${syn.identifier}; }
.t-type { color: #${sem.type}; } .t-enumMember { color: #${sem.enumMember}; } .t-attribute { color: #${sem.attribute}; }
.t-parameter { color: #${sem.parameter}; ${semanticOn ? 'font-style: italic;' : ''} } .t-instance { color: #${sem.instance}; } .t-event { color: #${sem.event}; }
.t-norm { color: #${sem.norm}; } .t-rule { color: #${sem.rule}; }
.t-number { color: #${syn.number}; } .t-string { color: #${syn.string}; } .t-comment { color: #${syn.comment}; } .t-operator, .t-delimiter { color: #${syn.operator}; }
pre.spec a.ref { text-decoration: underline dotted; } pre.spec a.ref:hover { text-decoration: underline; }
.chg { display: inline-block; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; font-weight: 600; padding: 1px 6px; border-radius: 3px; margin-right: 8px; vertical-align: middle; }
.norm-block header .chg { margin-left: 4px; }
.chg-added { color: #1a7f37; background: #e6f4ea; } .chg-removed { color: #b42318; background: #fbe9e7; } .chg-changed { color: #1d4ed8; background: #e8eefc; } .chg-renamed { color: #7e22ce; background: #f3e8ff; }
.gone { text-decoration: line-through; color: #b42318; }
ul.changes { margin: 4px 0 12px; } ul.changes > li { margin: 6px 0; } ul.slots { margin: 4px 0 0; } .slot { color: var(--muted); font-weight: 600; font-size: 13px; } .scen { font-size: 13px; margin-top: 2px; }
.norm-block.changed-added { border-left: 3px solid #1a7f37; } .norm-block.changed-changed { border-left: 3px solid #1d4ed8; } .norm-block.changed-renamed { border-left: 3px solid #7e22ce; }
pre.gherkin .g-add { background: #e6f4ea; } pre.gherkin .g-del { background: #fbe9e7; text-decoration: line-through; opacity: .8; } pre.gherkin .g-gutter { color: var(--muted); user-select: none; }
pre.spec .t-decl { font-weight: 600; }
footer { max-width: 1500px; margin: 0 auto; padding: 0 24px 40px; color: var(--muted); font-size: 12.5px; }
@media (max-width: 640px) { dl.sheet, .rule { grid-template-columns: 1fr; } }
@media print { header.top { position: static; } .controls, nav.contents { display: none; } .norm-block, figure.diagram, .tablewrap { break-inside: avoid; } body { background: #fff; } }
`;
}

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
