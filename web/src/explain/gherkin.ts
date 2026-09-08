/**
 * Gherkin rendering of the explanation model.
 *
 * The contract is a `Feature`, its preconditions a `Background`, and every
 * norm a `Rule` with one scenario per outcome: an obligation has a
 * "fulfilled" and a "violated" scenario, a power an "exercised" scenario.
 * `Given` carries what the norm presupposes (trigger, antecedent), `When`
 * what happens in that execution (the consequent's events, or a missed
 * deadline), `Then` the resulting norm state or effect. A trigger that is a
 * disjunction of same-kind events becomes a `Scenario Outline` with an
 * `Examples` table. Identifiers are double-quoted so they can serve as
 * parameters of Cucumber step definitions.
 *
 * Only Gherkin keywords are used (Feature, Background, Rule, Scenario,
 * Scenario Outline, Examples, Given, When, Then, And, #-comments), so the
 * output parses with the reference parser (@cucumber/gherkin); the corpus tool
 * checks this for every contract.
 */
import type { ContractModel } from '../model/api.js';
import type { EventRef, ExplainNorm, Prop, VarRef } from './types.js';
import {
  EVENT_VERBS, clauses, effectPhrase, eventNoun, isTrue, overview, partyPhrase, pointPhrase, propPhrase,
  rulePhrase, slots, type NormSlots, type Rich,
} from './verbalize.js';

/** One line of Gherkin: structural keyword (Feature/Rule/Scenario/...), step keyword, comment, table row, or plain text. */
export type GLine = {
  indent: number;
  kind: 'header' | 'step' | 'text' | 'comment' | 'row' | 'blank';
  kw?: string;          // Feature | Background | Rule | Scenario | Scenario Outline | Examples | Given | When | Then | And
  text: Rich;
  full?: boolean;       // shown only in Full detail
};

const R = (...parts: (Rich | string | null | undefined | false)[]): Rich => {
  const out: Rich = [];
  for (const p of parts) { if (!p) continue; if (typeof p === 'string') out.push(p); else out.push(...p); }
  return out;
};
const L = (indent: number, kind: GLine['kind'], text: Rich, kw?: string, full?: boolean): GLine => ({ indent, kind, kw, text, full });

/** Header text (Feature/Rule/Scenario names): identifiers unquoted. */
function plainText(r: Rich): string {
  return r.map((f) => (typeof f === 'string' ? f : 'code' in f ? f.code : 'norm' in f ? f.norm : 'b' in f ? f.b : f.i)).join('');
}

/** Plain Gherkin text: identifiers and norm names in double quotes. */
export function gherkinText(r: Rich): string {
  return r.map((f) => {
    if (typeof f === 'string') return f;
    if ('code' in f) return `"${f.code}"`;
    if ('norm' in f) return `"${f.norm}"`;
    if ('b' in f) return f.b;
    return f.i;
  }).join('');
}

// ------------------------------------------------------------------ norms

/** The trigger as a Scenario Outline when it is a disjunction of same-verb events; else null. */
function outlineTrigger(trigger: Prop | null): { verb: string; rows: { party: string; event: string }[] } | null {
  if (!trigger || trigger.t !== 'or' || trigger.items.length < 2) return null;
  const rows: { party: string; event: string }[] = [];
  let verb: string | null = null;
  for (const it of trigger.items) {
    if (it.t !== 'happens' || it.event.k !== 'var' || !it.event.type) return null;
    const v = EVENT_VERBS[it.event.type];
    if (!v || (verb && v !== verb)) return null;
    verb = v;
    rows.push({ party: it.event.performer?.var ?? '?', event: it.event.var });
  }
  return verb ? { verb, rows } : null;
}

/** "e does not occur strictly before p" for every deadline in a consequent. */
function missedDeadlines(p: Prop | null | undefined): Rich[] {
  const out: Rich[] = [];
  const walk = (q: unknown) => {
    if (!q || typeof q !== 'object' || !('t' in q)) return;
    const o = q as Prop;
    if (o.t === 'and' || o.t === 'or') (o.items as Prop[]).forEach(walk);
    else if (o.t === 'before' && (o.point.k === 'add' || (o.point.k === 'var' && !('k2' in o.point) && (o.point as VarRef).attrType === 'Date'))) {
      out.push(R(eventNoun(o.event), ' does not occur ', o.strict ? 'strictly before ' : 'on or before ', pointPhrase(o.point)));
    } else if (o.t === 'within' && o.interval.k === 'interval') {
      out.push(R(eventNoun(o.event), ' does not occur between ', pointPhrase(o.interval.from), ' and ', pointPhrase(o.interval.to)));
    }
  };
  walk(p);
  return out;
}

function steps(indent: number, first: string, items: Rich[]): GLine[] {
  return items.map((it, i) => L(indent, 'step', it, i === 0 ? first : 'And'));
}

/** The `Rule:` block for one norm. */
export function gherkinNorm(n: ExplainNorm, s: NormSlots): GLine[] {
  const out: GLine[] = [];
  const name = n.name;
  out.push(L(1, 'header', [{ code: name }], 'Rule'));
  // description (Full): what kind of norm, between whom, controller, cross-references, access rules
  if (s.isPower) out.push(L(2, 'text', R('Power held by ', partyPhrase(n.creditor), ' against ', partyPhrase(n.debtor), '.'), undefined, true));
  else out.push(L(2, 'text', R(s.survives ? 'Surviving obligation (still owed after the contract ends): ' : 'Obligation: ', partyPhrase(n.debtor), ' owes ', partyPhrase(n.creditor), '.'), undefined, true));
  if (s.controller) out.push(L(2, 'text', R('Access administered by ', s.controller, '.'), undefined, true));
  if (s.dependsOn.length) out.push(L(2, 'text', R('Refers to ', s.dependsOn.map((x) => ({ norm: x })).flatMap((f, i) => (i ? [', ', f] : [f])), '.'), undefined, true));
  if (s.feeds.length) out.push(L(2, 'text', R('Referred to by ', s.feeds.map((x) => ({ norm: x })).flatMap((f, i) => (i ? [', ', f] : [f])), '.'), undefined, true));
  for (const r of s.acRules) out.push(L(2, 'text', R('Access rule ', rulePhrase(r), '.'), undefined, true));
  if (s.authorNote) out.push(L(2, 'comment', [`Specifier's note: ${s.authorNote}`], undefined, true));

  // Given: trigger (+ antecedent)
  const outline = outlineTrigger(n.trigger);
  const given: Rich[] = [];
  if (n.trigger && !isTrue(n.trigger) && !outline) given.push(propPhrase(n.trigger));
  const binding = isTrue(n.antecedent) ? [] : clauses(n.antecedent);
  const scenarioKw = outline ? 'Scenario Outline' : 'Scenario';
  const givenLines = (indent: number): GLine[] => {
    const lines: GLine[] = [];
    if (outline) lines.push(L(indent, 'step', R([{ code: '<party>' }], ` ${outline.verb} (`, [{ code: '<event>' }], ')'), 'Given'));
    const rest = [...given, ...(s.isPower ? [] : binding)];
    if (!outline && rest.length === 0) lines.push(L(indent, 'step', ['the contract is in force'], 'Given'));
    lines.push(...steps(indent, outline || lines.length ? 'And' : 'Given', rest));
    return lines;
  };
  const examples = (indent: number): GLine[] => outline ? [
    L(indent, 'header', [], 'Examples'),
    L(indent + 1, 'row', ['| party | event |']),
    ...outline.rows.map((r) => L(indent + 1, 'row', [`| ${r.party} | ${r.event} |`])),
  ] : [];

  if (s.isPower) {
    out.push(L(2, 'blank', []));
    out.push(L(2, 'header', R([{ code: name }], ' is exercised'), scenarioKw));
    out.push(...givenLines(3));
    const when = binding.length ? binding : [R(partyPhrase(n.creditor), ' exercises the power')];
    out.push(...steps(3, 'When', when));
    out.push(L(3, 'step', effectPhrase(n.consequent), 'Then'));
    out.push(...examples(3));
    return out;
  }

  // fulfilled
  out.push(L(2, 'blank', []));
  out.push(L(2, 'header', R([{ code: name }], ' is fulfilled'), scenarioKw));
  out.push(...givenLines(3));
  out.push(...steps(3, 'When', clauses(n.consequent as Prop)));
  out.push(L(3, 'step', R('obligation ', [{ norm: name }], ' is fulfilled'), 'Then'));
  out.push(...examples(3));
  // violated
  out.push(L(2, 'blank', []));
  out.push(L(2, 'header', R([{ code: name }], ' is violated'), scenarioKw));
  out.push(...givenLines(3));
  const misses = missedDeadlines(n.consequent as Prop);
  out.push(...steps(3, 'When', misses.length ? misses : [['any of the required conditions does not come about']]));
  out.push(L(3, 'step', R('obligation ', [{ norm: name }], ' is violated'), 'Then'));
  out.push(...examples(3));
  return out;
}

// ------------------------------------------------------------------ feature

/** The whole contract as one Feature. */
export function gherkinFeature(model: ContractModel, detail: 'brief' | 'full' = 'full'): GLine[] {
  const ex = model.explain!;
  const rules = model.rules ?? [];
  const ov = overview(ex.contract, ex.norms, rules);
  const out: GLine[] = [];
  out.push(L(0, 'header', [ex.contract.name || model.contractName || 'Contract'], 'Feature'));
  out.push(L(1, 'text', ov.summary));
  if (ov.timeUnit) out.push(L(1, 'text', [`Time is counted in ${ov.timeUnit}.`]));
  for (const c of ov.constraints) out.push(L(1, 'text', R('Throughout the contract, ', c, '.')));
  if (ov.preconditions.length) {
    out.push(L(0, 'blank', []));
    out.push(L(1, 'header', [], 'Background'));
    out.push(...steps(2, 'Given', ov.preconditions));
  }
  for (const n of ex.norms) {
    out.push(L(0, 'blank', []));
    out.push(...gherkinNorm(n, slots(n, rules)).filter((l) => detail === 'full' || !l.full));
  }
  return out;
}

/** Serialize lines to a .feature file. */
export function featureText(lines: GLine[]): string {
  return lines.map((l) => {
    const pad = '  '.repeat(l.indent);
    switch (l.kind) {
      case 'blank': return '';
      case 'header': return `${pad}${l.kw}:${l.text.length ? ' ' + plainText(l.text) : ''}`;
      case 'step': return `${pad}${l.kw} ${gherkinText(l.text)}`;
      case 'comment': return `${pad}# ${gherkinText(l.text)}`;
      case 'row': return `${pad}${gherkinText(l.text)}`;
      default: return `${pad}${gherkinText(l.text)}`;
    }
  }).join('\n') + '\n';
}

// Re-exported for renderers that need the event ref helpers.
export type { EventRef };
