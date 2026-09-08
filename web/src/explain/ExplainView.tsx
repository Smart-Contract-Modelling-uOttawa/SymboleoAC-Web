import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as monaco from '@codingame/monaco-vscode-editor-api';
import type { ContractModel } from '../model/api.js';
import type { ExplainNorm } from './types.js';
import {
  GLOSSARY, capitalize, joinList, overview, rulePhrase, slots,
  type NormSlots, type OverviewSlots, type Rich, type Frag,
} from './verbalize.js';
import { toMarkdown, proseRich, ruleRows, ruleFoot, type Detail } from './markdown.js';
import { saveBlobAs } from '../fileio.js';
import { buildDocumentHtml } from './document.js';

export type ExplainStyle = 'a' | 'b' | 'c';
const STYLE_KEY = 'symboleoac.explainStyle';
const DETAIL_KEY = 'symboleoac.explainDetail';
const STYLES: { id: ExplainStyle; label: string; hint: string }[] = [
  { id: 'a', label: 'Fact sheet', hint: 'Labelled slots, one per element of the formal norm; empty slots are shown as empty.' },
  { id: 'b', label: 'Plain-English clause', hint: 'One paragraph per norm, written as a plain-language clause.' },
  { id: 'c', label: 'If / then / otherwise', hint: 'A conditional rule mirroring trigger, condition, consequence and violation.' },
];

// Dark IDE palette (matches the other right-hand tabs).
const C = {
  bg: '#1e1e1e', panel: '#252526', line: '#3a3d41', text: '#d4d4d4', muted: '#9a9a9a',
  accent: '#9cdcfe', code: '#2a2d2e', note: '#2b2a22',
  obl: '#7fb0df', oblSoft: '#1f2e3d', surv: '#6cc5b4', survSoft: '#1b3330', pow: '#e0a15a', powSoft: '#3a2c1b',
  err: '#f48771', warn: '#cca700',
};
const kindColor = (k: ExplainNorm['kind']) => (k === 'power' ? [C.pow, C.powSoft] : k === 'survivingObligation' ? [C.surv, C.survSoft] : [C.obl, C.oblSoft]);
const KIND_LABEL: Record<ExplainNorm['kind'], string> = { obligation: 'Obligation', survivingObligation: 'Surviving obligation', power: 'Power' };
/** Slot label -> glossary entry (tooltip). */
const LABEL_GLOSS: Record<string, string> = {
  'Created': GLOSSARY.trigger, 'Arises': GLOSSARY.trigger, 'If': GLOSSARY.trigger, 'From': GLOSSARY.trigger,
  'Binding': GLOSSARY.antecedent, 'Exercisable': GLOSSARY.antecedent, 'When': GLOSSARY.antecedent,
  'Must bring about': GLOSSARY.consequent, 'Effect': GLOSSARY.consequent, 'Then': GLOSSARY.consequent, 'Cause': GLOSSARY.consequent,
  'Otherwise': GLOSSARY.violation, 'Deadline': GLOSSARY.deadline, 'By': GLOSSARY.deadline,
  'Access administered by': GLOSSARY.controller, 'Access rules': GLOSSARY.acRules,
  'Refers to': GLOSSARY.dependsOn, 'Referred to by': GLOSSARY.feeds, 'Survives': GLOSSARY.survivingObligation,
  'Who owes': GLOSSARY.obligation, 'Who holds it': GLOSSARY.power,
};

type Nav = (line?: number, col?: number) => void;
type Ctx = { nav: Nav; pos: Map<string, { line: number; col: number }>; normKinds: Map<string, ExplainNorm['kind']>; goToNorm: (n: string) => void };

export function ExplainView({ model, editor, getSource }: { model: ContractModel | null; editor: monaco.editor.IStandaloneCodeEditor | null; getSource: () => string }) {
  const [style, setStyle] = useState<ExplainStyle>(() => {
    try { const s = localStorage.getItem(STYLE_KEY); if (s === 'a' || s === 'b' || s === 'c') return s; } catch { /* ignore */ }
    return 'a';
  });
  useEffect(() => { try { localStorage.setItem(STYLE_KEY, style); } catch { /* ignore */ } }, [style]);
  const [detail, setDetail] = useState<Detail>(() => {
    try { return localStorage.getItem(DETAIL_KEY) === 'brief' ? 'brief' : 'full'; } catch { return 'full'; }
  });
  useEffect(() => { try { localStorage.setItem(DETAIL_KEY, detail); } catch { /* ignore */ } }, [detail]);
  const [note, setNote] = useState<string>('');

  const nav = useCallback<Nav>((line, col) => {
    if (!editor || !line) return;
    const cn = col ?? 1;
    editor.revealRangeInCenterIfOutsideViewport({ startLineNumber: line, startColumn: cn, endLineNumber: line, endColumn: cn });
    editor.setPosition({ lineNumber: line, column: cn });
    editor.focus();
  }, [editor]);

  const goToNorm = useCallback((name: string) => {
    const el = document.getElementById(`explain-norm-${name}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.outline = `2px solid ${C.accent}`;
    setTimeout(() => { el.style.outline = 'none'; }, 1200);
  }, []);

  const ctx = useMemo<Ctx | null>(() => {
    if (!model?.explain) return null;
    const pos = new Map<string, { line: number; col: number }>();
    for (const v of model.variables ?? []) pos.set(v.name, v);
    for (const r of model.rules ?? []) pos.set(r.name, r);
    for (const n of model.explain.norms) pos.set(n.name, n);
    const normKinds = new Map(model.explain.norms.map((n) => [n.name, n.kind]));
    return { nav, pos, normKinds, goToNorm };
  }, [model, nav, goToNorm]);

  if (!model) return <Msg>Explanations appear after the model loads.</Msg>;
  if (!model.explain || !model.diagnostics) {
    return <Msg>This server does not provide the explanation model. Rebuild the bridge image.</Msg>;
  }
  if (model.explain.error) return <Msg>The explanation model could not be built: <code>{model.explain.error}</code></Msg>;

  const d = model.diagnostics;
  if (d.errors > 0) {
    const errs = d.issues.filter((i) => i.severity === 'error');
    return (
      <div style={{ padding: 16, color: C.text, fontSize: 13, lineHeight: 1.5 }}>
        <p style={{ margin: 0 }}>
          Explanations are generated only for specifications without errors. This one has{' '}
          <b style={{ color: C.err }}>{d.errors} error{d.errors === 1 ? '' : 's'}</b>
          {d.warnings ? ` and ${d.warnings} warning${d.warnings === 1 ? '' : 's'}` : ''}. Fix the errors (see the editor squiggles or the Diagnostics tab) and the explanation will appear.
        </p>
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: C.muted }}>
          {errs.slice(0, 8).map((e, i) => (
            <li key={i}>
              <button type="button" onClick={() => nav(e.line, e.column)} style={linkBtn}>line {e.line}</button>: {e.message}
            </li>
          ))}
          {errs.length > 8 && <li>… and {errs.length - 8} more</li>}
        </ul>
      </div>
    );
  }

  const ex = model.explain;
  const rules = model.rules ?? [];
  const ov = overview(ex.contract, ex.norms, rules);
  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(''), 2500); };
  const copyMd = async () => {
    try { await navigator.clipboard.writeText(toMarkdown(model, style, detail)); flash('Markdown copied to clipboard'); }
    catch { flash('Copy failed — use Save instead'); }
  };
  const saveMd = async () => {
    const text = toMarkdown(model, style, detail);
    const ok = await saveBlobAs(`${ex.contract.name || 'contract'}-explained.md`, new Blob([text], { type: 'text/markdown' }), { 'text/markdown': ['.md'] });
    if (ok) flash('Markdown saved');
  };
  // Integrated documentation: overview + diagrams + policy + explanations + source, one HTML file.
  const buildDoc = async () => {
    flash('Building documentation…');
    const html = await buildDocumentHtml(model, getSource(), { style, detail });
    return new Blob([html], { type: 'text/html;charset=utf-8' });
  };
  const previewDoc = async () => {
    try {
      const blob = await buildDoc();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      flash('Documentation opened in a new tab');
    } catch (e) { flash(`Documentation failed: ${(e as Error).message}`); }
  };
  const saveDoc = async () => {
    try {
      const blob = await buildDoc();
      const ok = await saveBlobAs(`${ex.contract.name || 'contract'}-documentation.html`, blob, { 'text/html': ['.html'] });
      if (ok) flash('Documentation saved');
    } catch (e) { flash(`Documentation failed: ${(e as Error).message}`); }
  };
  const groups: [ExplainNorm['kind'], string, string][] = [
    ['obligation', 'Obligations', ''],
    ['survivingObligation', 'Surviving obligations', 'These remain enforceable after the contract has ended.'],
    ['power', 'Powers', ''],
  ];

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.bg, color: C.text, fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ padding: '10px 16px 24px', maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div role="group" aria-label="Explanation style" style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden' }}>
            {STYLES.map((s) => (
              <button key={s.id} type="button" onClick={() => setStyle(s.id)} aria-pressed={style === s.id} title={s.hint}
                style={{
                  padding: '4px 10px', border: 'none', borderRight: `1px solid ${C.line}`, cursor: 'pointer', font: 'inherit', fontSize: 12,
                  background: style === s.id ? C.accent : 'transparent', color: style === s.id ? '#1e1e1e' : C.accent, fontWeight: style === s.id ? 600 : 400,
                }}>
                {s.label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Detail level" style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden' }}>
            {(['brief', 'full'] as Detail[]).map((dl) => (
              <button key={dl} type="button" onClick={() => setDetail(dl)} aria-pressed={detail === dl}
                title={dl === 'brief' ? 'Only who, when and what' : 'All slots: deadlines, violation, access, cross-references, notes'}
                style={{
                  padding: '4px 10px', border: 'none', borderRight: dl === 'brief' ? `1px solid ${C.line}` : 'none', cursor: 'pointer', font: 'inherit', fontSize: 12,
                  background: detail === dl ? C.accent : 'transparent', color: detail === dl ? '#1e1e1e' : C.accent, fontWeight: detail === dl ? 600 : 400,
                }}>
                {dl === 'brief' ? 'Brief' : 'Full'}
              </button>
            ))}
          </div>
          <button type="button" onClick={copyMd} style={toolBtn} title="Copy the whole explanation as Markdown">Copy Markdown</button>
          <button type="button" onClick={saveMd} style={toolBtn} title="Save the whole explanation as a .md file">Save Markdown…</button>
          <span style={{ width: 1, height: 18, background: C.line }} />
          <button type="button" onClick={previewDoc} style={toolBtn} title="Open the integrated documentation (overview, diagrams, policy, explanations, source) in a new tab">Documentation</button>
          <button type="button" onClick={saveDoc} style={toolBtn} title="Save the integrated documentation as one self-contained HTML file">Save documentation…</button>
          {note && <span style={{ color: C.muted, fontSize: 12 }}>{note}</span>}
          {d.warnings > 0 && <span style={{ color: C.warn, fontSize: 12, marginLeft: 'auto' }}>{d.warnings} warning{d.warnings === 1 ? '' : 's'} (tolerated)</span>}
        </div>
        <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 12 }}>{STYLES.find((s) => s.id === style)?.hint}</p>

        <H2>The contract as a whole</H2>
        <Overview ov={ov} ctx={ctx!} contractName={ex.contract.name} />

        {groups.map(([kind, label, lede]) => {
          const ns = ex.norms.filter((n) => n.kind === kind);
          if (ns.length === 0) return null;
          return (
            <section key={kind}>
              <H2>{label}</H2>
              {lede && <p style={{ margin: '0 0 8px', color: C.muted }}>{lede}</p>}
              {ns.map((n) => <NormBlock key={n.name} s={slots(n, rules)} style={style} detail={detail} ctx={ctx!} />)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ rich text rendering

function RichText({ r, ctx }: { r: Rich; ctx: Ctx }) {
  return <>{r.map((f, i) => <FragView key={i} f={f} ctx={ctx} />)}</>;
}

function FragView({ f, ctx }: { f: Frag; ctx: Ctx }) {
  if (typeof f === 'string') return <>{f}</>;
  if ('b' in f) return <b>{f.b}</b>;
  if ('i' in f) return <span style={{ color: C.muted }}>{f.i}</span>;
  if ('norm' in f) {
    const kind = ctx.normKinds.get(f.norm);
    const color = kind ? kindColor(kind)[0] : C.accent;
    return (
      <a href={`#explain-norm-${f.norm}`} onClick={(e) => { e.preventDefault(); ctx.goToNorm(f.norm); }}
         title="Go to this norm's explanation"
         style={{ color, fontFamily: 'ui-monospace, monospace', fontSize: 12, textDecoration: 'underline dotted', cursor: 'pointer' }}>
        {f.norm}
      </a>
    );
  }
  const root = f.code.split('.')[0];
  const p = ctx.pos.get(root);
  return (
    <code onClick={p ? () => ctx.nav(p.line, p.col) : undefined} title={p ? `Go to line ${p.line}` : undefined}
          style={{ background: C.code, padding: '0 4px', borderRadius: 3, fontSize: 12, cursor: p ? 'pointer' : 'default', color: C.text }}>
      {f.code}
    </code>
  );
}

const Bullets = ({ items, ctx }: { items: Rich[]; ctx: Ctx }) => (
  items.length === 1
    ? <RichText r={items[0]} ctx={ctx} />
    : <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((it, i) => <li key={i}><RichText r={it} ctx={ctx} /></li>)}</ul>
);

// ------------------------------------------------------------------ overview

function Overview({ ov, ctx, contractName }: { ov: OverviewSlots; ctx: Ctx; contractName: string }) {
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: 'grid', gap: 2 }}>
      <div style={eyebrow}>{label}</div>
      <div>{children}</div>
    </div>
  );
  const c = ov.counts;
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: '14px 16px', display: 'grid', gap: '14px 24px', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      <div style={{ gridColumn: '1 / -1' }}><Field label="Summary"><RichText r={ov.summary} ctx={ctx} /></Field></div>
      <Field label="Fixed when the contract is created">
        {ov.fixed.length ? <ul style={ul}>{ov.fixed.map((f, i) => <li key={i}><RichText r={f} ctx={ctx} /></li>)}</ul> : <Empty>nothing besides the parties</Empty>}
      </Field>
      <Field label="Comes into force only if">
        {ov.preconditions.length ? <Bullets items={ov.preconditions} ctx={ctx} /> : <Empty>no preconditions</Empty>}
        {ov.timeUnit && <div style={{ marginTop: 6, color: C.muted }}>Time is counted in {ov.timeUnit}.</div>}
      </Field>
      <Field label="What the parties owe">
        <ul style={ul}>
          <li>{c.obligations} obligation{c.obligations === 1 ? '' : 's'} within the contract</li>
          <li>{c.surviving} obligation{c.surviving === 1 ? '' : 's'} that survive{c.surviving === 1 ? 's' : ''} termination</li>
          <li>{c.powers} power{c.powers === 1 ? '' : 's'}</li>
        </ul>
      </Field>
      <Field label="How it can end">
        {ov.ends.length ? <ul style={ul}>{ov.ends.map((f, i) => <li key={i}><RichText r={capitalize(f)} ctx={ctx} /></li>)}</ul> : <Empty>no power terminates the contract</Empty>}
      </Field>
      {ov.survives.length > 0 && (
        <Field label="Still owed after it ends"><ul style={ul}>{ov.survives.map((f, i) => <li key={i}><RichText r={f} ctx={ctx} /></li>)}</ul></Field>
      )}
      <Field label="Who controls access to information">{ov.access ? <RichText r={ov.access} ctx={ctx} /> : <Empty>no access-control policy</Empty>}</Field>
      {ov.sensors.length > 0 && (
        <Field label="Monitoring"><ul style={ul}>{ov.sensors.map((f, i) => <li key={i}><RichText r={f} ctx={ctx} /></li>)}</ul></Field>
      )}
      {ov.postconditions.length > 0 && <Field label="When it ends, the following must hold"><Bullets items={ov.postconditions} ctx={ctx} /></Field>}
      {ov.constraints.length > 0 && <Field label="Throughout the contract"><Bullets items={ov.constraints} ctx={ctx} /></Field>}
      {ov.lifecycle.length > 0 && (
        <div style={{ gridColumn: '1 / -1', borderLeft: `3px solid ${C.line}`, paddingLeft: 12 }}>
          <Field label="Normal course (obligations in dependency order)">
            <ol style={{ margin: 0, paddingLeft: 20 }}>{ov.lifecycle.map((f, i) => <li key={i}><RichText r={f} ctx={ctx} /></li>)}</ol>
          </Field>
        </div>
      )}
      {ov.observations.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Observations">
            <ul style={{ ...ul, color: C.muted }}>{ov.observations.map((f, i) => <li key={i}><RichText r={f} ctx={ctx} /></li>)}</ul>
          </Field>
        </div>
      )}
      <div style={{ gridColumn: '1 / -1', color: C.muted, fontSize: 11 }}>Generated from the specification of <code style={{ fontSize: 11 }}>{contractName}</code>; identifiers jump to the source, norm names jump to their explanation.</div>
    </div>
  );
}

// ------------------------------------------------------------------ norm blocks

function NormBlock({ s, style, detail, ctx }: { s: NormSlots; style: ExplainStyle; detail: Detail; ctx: Ctx }) {
  const [color, soft] = kindColor(s.kind);
  return (
    <article id={`explain-norm-${s.name}`} style={{ marginTop: 12, border: `1px solid ${C.line}`, borderRadius: 6, background: C.panel, overflow: 'hidden', transition: 'outline .2s' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 14px', borderBottom: `1px solid ${C.line}` }}>
        <span title={GLOSSARY[s.kind]} style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, padding: '1px 7px', borderRadius: 3, color, background: soft, cursor: 'help' }}>{KIND_LABEL[s.kind]}</span>
        <span style={{ fontWeight: 600 }}><code style={{ fontSize: 13, color: C.text }}>{s.name}</code></span>
        <button type="button" onClick={() => ctx.nav(s.line, s.col)} style={{ ...linkBtn, marginLeft: 'auto' }} title="Go to the source">line {s.line}</button>
      </header>
      <div style={{ padding: '12px 14px 14px' }}>
        {style === 'a' && <FactSheet s={s} detail={detail} ctx={ctx} />}
        {style === 'b' && <Prose s={s} detail={detail} ctx={ctx} />}
        {style === 'c' && <RuleForm s={s} detail={detail} ctx={ctx} color={color} />}
        {detail === 'full' && s.authorNote && (
          <p style={{ margin: '12px 0 0', padding: '6px 10px', background: C.note, borderRadius: 4, color: C.muted, fontStyle: 'italic', fontSize: 12.5 }}>
            <b style={{ fontStyle: 'normal', color: C.text }}>Specifier's note:</b> {s.authorNote}
          </p>
        )}
      </div>
    </article>
  );
}

const Links = ({ names, ctx }: { names: string[]; ctx: Ctx }) => (
  <RichText r={joinList(names.map((n) => [{ norm: n }]), 'and')} ctx={ctx} />
);

// --- Style A: fact sheet -------------------------------------------------------

function FactSheet({ s, detail, ctx }: { s: NormSlots; detail: Detail; ctx: Ctx }) {
  const third = (b: boolean) => (b ? <span style={{ color: C.muted }}> — third party</span> : null);
  const rows: [string, React.ReactNode][] = s.isPower ? [
    ['Who holds it', <><RichText r={s.debtorLong} ctx={ctx} />{third(s.debtorThird)}, against <RichText r={s.creditorLong} ctx={ctx} />{third(s.creditorThird)}</>],
    ['Arises', s.created ? <>when <RichText r={s.created} ctx={ctx} /></> : 'at the start of the contract'],
    ['Exercisable', s.binding ? <>once <Bullets items={s.binding} ctx={ctx} /></> : 'at will (no further condition)'],
    ['Effect', <b><RichText r={capitalize(s.must[0] ?? [])} ctx={ctx} /></b>],
  ] : [
    ['Who owes', <><RichText r={s.debtorLong} ctx={ctx} />{third(s.debtorThird)} to <RichText r={s.creditorLong} ctx={ctx} />{third(s.creditorThird)}</>],
    ['Created', s.created ? <>each time <RichText r={s.created} ctx={ctx} /></> : 'at the start of the contract (no trigger)'],
    ['Binding', s.binding ? <>once <Bullets items={s.binding} ctx={ctx} /></> : 'immediately (no condition)'],
    ['Must bring about', <Bullets items={s.must} ctx={ctx} />],
  ];
  if (detail === 'brief') return <Rows rows={rows} />;
  if (!s.isPower) {
    rows.push(['Deadline', s.deadlines.length ? <Bullets items={s.deadlines} ctx={ctx} /> : <Empty>none stated</Empty>]);
    rows.push(['Otherwise', 'the obligation is violated']);
    if (s.survives) rows.push(['Survives', 'yes: still owed after the contract ends']);
  }
  rows.push(['Access administered by', s.controller ? <RichText r={s.controller} ctx={ctx} /> : <Empty>not specified</Empty>]);
  rows.push(['Refers to', s.dependsOn.length ? <Links names={s.dependsOn} ctx={ctx} /> : <Empty>no other norm</Empty>]);
  rows.push(['Referred to by', s.feeds.length ? <Links names={s.feeds} ctx={ctx} /> : <Empty>no other norm</Empty>]);
  rows.push(['Access rules', s.acRules.length
    ? <ul style={ul}>{s.acRules.map((r) => <li key={r.name}><RichText r={rulePhrase(r)} ctx={ctx} /></li>)}</ul>
    : <Empty>none touch this {s.isPower ? 'power' : 'obligation'}</Empty>]);
  return <Rows rows={rows} />;
}

const Rows = ({ rows }: { rows: [string, React.ReactNode][] }) => (
  <dl style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '6px 14px', margin: 0 }}>
    {rows.map(([k, v]) => (
      <div key={k} style={{ display: 'contents' }}>
        <dt title={LABEL_GLOSS[k]} style={{ color: C.muted, fontWeight: 600, fontSize: 12, cursor: LABEL_GLOSS[k] ? 'help' : 'default' }}>{k}</dt>
        <dd style={{ margin: 0 }}>{v}</dd>
      </div>
    ))}
  </dl>
);

// --- Style B: plain-English clause -------------------------------------------

function Prose({ s, detail, ctx }: { s: NormSlots; detail: Detail; ctx: Ctx }) {
  const { main, tail } = proseRich(s, detail);
  return (
    <div style={{ maxWidth: '70ch' }}>
      <p style={{ margin: 0 }}><RichText r={main} ctx={ctx} /></p>
      {tail.length > 0 && <p style={{ margin: '8px 0 0', color: C.muted, fontSize: 12.5 }}><RichText r={tail} ctx={ctx} /></p>}
    </div>
  );
}

// --- Style C: if / then / otherwise -------------------------------------------

function RuleForm({ s, detail, ctx, color }: { s: NormSlots; detail: Detail; ctx: Ctx; color: string }) {
  const kw = (t: string) => <span title={LABEL_GLOSS[t]} style={{ font: '600 11.5px/1.7 ui-monospace, monospace', letterSpacing: '.05em', textTransform: 'uppercase', color, cursor: LABEL_GLOSS[t] ? 'help' : 'default' }}>{t}</span>;
  const rows = ruleRows(s);
  const foot = detail === 'full' ? ruleFoot(s) : [];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '4px 12px' }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div>{k ? kw(k) : null}</div>
          <div>{Array.isArray(v[0]) ? <Bullets items={v as Rich[]} ctx={ctx} /> : <RichText r={v as Rich} ctx={ctx} />}</div>
        </div>
      ))}
      {foot.length > 0 && (
        <div style={{ gridColumn: '1 / -1', color: C.muted, fontSize: 12.5, borderTop: `1px dashed ${C.line}`, paddingTop: 6, marginTop: 4 }}>
          <RichText r={foot.flatMap((f, i) => (i ? [' ', ...f] : f))} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ small bits

const eyebrow: React.CSSProperties = { fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 };
const ul: React.CSSProperties = { margin: 0, paddingLeft: 18 };
const toolBtn: React.CSSProperties = { padding: '3px 9px', background: '#3a3d41', color: '#fff', border: `1px solid #555`, borderRadius: 3, cursor: 'pointer', font: 'inherit', fontSize: 12 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.accent, cursor: 'pointer', font: 'inherit', fontSize: 12, padding: 0 };
const H2 = ({ children }: { children: React.ReactNode }) => <h2 style={{ fontSize: 15, margin: '20px 0 8px', color: C.accent, fontWeight: 600 }}>{children}</h2>;
const Empty = ({ children }: { children: React.ReactNode }) => <span style={{ color: C.muted, fontStyle: 'italic' }}>{children}</span>;
const Msg = ({ children }: { children: React.ReactNode }) => <div style={{ padding: 12, color: C.accent, fontSize: 13 }}>{children}</div>;
