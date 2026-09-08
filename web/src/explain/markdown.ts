/**
 * Markdown export of the Explain tab: the same slots the view renders, in the
 * chosen style and detail level. Norm names become in-document links.
 */
import type { ContractModel } from '../model/api.js';
import type { ExplainStyle } from './ExplainView.js';
import {
  capitalize, joinClauses, joinList, overview, rulePhrase, slots,
  type NormSlots, type OverviewSlots, type Rich,
} from './verbalize.js';

export type Detail = 'brief' | 'full';

const md = (r: Rich): string => r.map((f) => {
  if (typeof f === 'string') return f;
  if ('code' in f) return `\`${f.code}\``;
  if ('norm' in f) return `[${f.norm}](#${f.norm.toLowerCase()})`;
  if ('b' in f) return `**${f.b}**`;
  return `*${f.i}*`;
}).join('');

const KIND: Record<NormSlots['kind'], string> = { obligation: 'Obligation', survivingObligation: 'Surviving obligation', power: 'Power' };

export function toMarkdown(model: ContractModel, style: ExplainStyle, detail: Detail): string {
  const ex = model.explain!;
  const rules = model.rules ?? [];
  const ov = overview(ex.contract, ex.norms, rules);
  const out: string[] = [];
  out.push(`# ${ex.contract.name} — plain-language explanation`, '');
  out.push(`_Generated from the specification. Style: ${style === 'a' ? 'fact sheet' : style === 'b' ? 'plain-English clause' : 'if / then / otherwise'}; detail: ${detail}._`, '');
  out.push('## The contract as a whole', '', ...overviewMd(ov), '');

  const groups: [NormSlots['kind'], string][] = [['obligation', 'Obligations'], ['survivingObligation', 'Surviving obligations'], ['power', 'Powers']];
  for (const [kind, label] of groups) {
    const ns = ex.norms.filter((n) => n.kind === kind);
    if (!ns.length) continue;
    out.push(`## ${label}`, '');
    if (kind === 'survivingObligation') out.push('These remain enforceable after the contract has ended.', '');
    for (const n of ns) {
      const s = slots(n, rules);
      out.push(`### ${s.name}`, '', `_${KIND[s.kind]} (line ${s.line})_`, '');
      out.push(...(style === 'a' ? factSheetMd(s, detail) : style === 'b' ? proseMd(s, detail) : ruleMd(s, detail)));
      if (detail === 'full' && s.authorNote) out.push('', `> **Specifier's note:** ${s.authorNote}`);
      out.push('');
    }
  }
  return out.join('\n');
}

function overviewMd(ov: OverviewSlots): string[] {
  const o: string[] = [];
  const list = (title: string, items: Rich[], empty?: string) => {
    o.push(`**${title}**`, '');
    if (items.length) items.forEach((it) => o.push(`- ${md(it)}`)); else if (empty) o.push(`- _${empty}_`);
    o.push('');
  };
  o.push(md(ov.summary), '');
  list('Fixed when the contract is created', ov.fixed, 'nothing besides the parties');
  list('Comes into force only if', ov.preconditions, 'no preconditions');
  if (ov.timeUnit) o.push(`Time is counted in ${ov.timeUnit}.`, '');
  const c = ov.counts;
  o.push('**What the parties owe**', '', `- ${c.obligations} obligation(s) within the contract`, `- ${c.surviving} obligation(s) that survive termination`, `- ${c.powers} power(s)`, '');
  list('How it can end', ov.ends.map(capitalize), 'no power terminates the contract');
  if (ov.survives.length) list('Still owed after it ends', ov.survives);
  o.push('**Who controls access to information**', '', ov.access ? md(ov.access) : '_no access-control policy_', '');
  if (ov.sensors.length) list('Monitoring', ov.sensors);
  if (ov.postconditions.length) list('When it ends, the following must hold', ov.postconditions);
  if (ov.constraints.length) list('Throughout the contract', ov.constraints);
  if (ov.lifecycle.length) {
    o.push('**Normal course**', '');
    ov.lifecycle.forEach((it, i) => o.push(`${i + 1}. ${md(it)}`));
    o.push('');
  }
  if (ov.observations.length) list('Observations', ov.observations);
  return o;
}

const bullets = (items: Rich[]) => (items.length === 1 ? md(items[0]) : '\n' + items.map((it) => `  - ${md(it)}`).join('\n'));

function factSheetMd(s: NormSlots, detail: Detail): string[] {
  const rows: [string, string][] = s.isPower ? [
    ['Who holds it', `${md(s.debtorLong)}${s.debtorThird ? ' (third party)' : ''}, against ${md(s.creditorLong)}${s.creditorThird ? ' (third party)' : ''}`],
    ['Arises', s.created ? `when ${md(s.created)}` : 'at the start of the contract'],
    ['Exercisable', s.binding ? `once ${bullets(s.binding)}` : 'at will (no further condition)'],
    ['Effect', md(capitalize(s.must[0] ?? []))],
  ] : [
    ['Who owes', `${md(s.debtorLong)}${s.debtorThird ? ' (third party)' : ''} to ${md(s.creditorLong)}${s.creditorThird ? ' (third party)' : ''}`],
    ['Created', s.created ? `each time ${md(s.created)}` : 'at the start of the contract (no trigger)'],
    ['Binding', s.binding ? `once ${bullets(s.binding)}` : 'immediately (no condition)'],
    ['Must bring about', bullets(s.must)],
  ];
  if (detail === 'full') {
    if (!s.isPower) {
      rows.push(['Deadline', s.deadlines.length ? bullets(s.deadlines) : '_none stated_']);
      rows.push(['Otherwise', 'the obligation is violated']);
      if (s.survives) rows.push(['Survives', 'yes: still owed after the contract ends']);
    }
    rows.push(['Access administered by', s.controller ? md(s.controller) : '_not specified_']);
    rows.push(['Refers to', s.dependsOn.length ? md(joinList(s.dependsOn.map((n) => [{ norm: n }]), 'and')) : '_no other norm_']);
    rows.push(['Referred to by', s.feeds.length ? md(joinList(s.feeds.map((n) => [{ norm: n }]), 'and')) : '_no other norm_']);
    rows.push(['Access rules', s.acRules.length ? bullets(s.acRules.map(rulePhrase)) : '_none_']);
  }
  return rows.map(([k, v]) => `- **${k}:** ${v}`);
}

export function proseRich(s: NormSlots, detail: Detail): { main: Rich; tail: Rich } {
  const third = (b: boolean, r: Rich): Rich => (b ? [...r, ' (a third party)'] : r);
  let main: Rich;
  if (s.isPower) {
    main = [
      ...(s.created ? ['If ', ...s.created, ', '] : ['From the start of the contract, ']),
      ...third(s.debtorThird, s.debtor), ' gains the power, against ', ...third(s.creditorThird, s.creditor), ', to bring it about that ',
      ...(s.must[0] ?? []), '. ',
      ...(s.binding ? ['It may be exercised once ', ...joinClauses(s.binding), '.'] : ['It may be exercised at will.']),
    ];
  } else {
    main = [
      ...(s.created ? ['Each time ', ...s.created, ', this obligation is created. '] : ['This obligation exists from the start of the contract. ']),
      ...(s.binding ? ['It becomes binding once ', ...joinClauses(s.binding), '. '] : ['It is binding immediately. ']),
      ...capitalize(third(s.debtorThird, s.debtor)), ' must then, for ', ...third(s.creditorThird, s.creditor), ', ensure that ',
      ...joinClauses(s.must), '. ',
      ...(s.deadlines.length ? ['Deadline: ', ...joinList(s.deadlines, 'and'), '. '] : []),
      'Otherwise the obligation is violated.',
      ...(s.survives ? [' It remains enforceable after the contract ends.'] : []),
    ];
  }
  const bits: Rich[] = [];
  if (detail === 'full') {
    if (s.controller) bits.push(['Access to this ', s.isPower ? 'power' : 'obligation', ' is administered by ', ...s.controller, '.']);
    if (s.dependsOn.length) bits.push(['It refers to ', ...joinList(s.dependsOn.map((n) => [{ norm: n }]), 'and'), '.']);
    if (s.feeds.length) bits.push(['It is referred to by ', ...joinList(s.feeds.map((n) => [{ norm: n }]), 'and'), '.']);
    if (s.acRules.length) bits.push(['Access rules that apply: ', ...joinList(s.acRules.map(rulePhrase), 'and'), '.']);
  }
  return { main, tail: bits.flatMap((b, i) => (i ? [' ', ...b] : b)) };
}

function proseMd(s: NormSlots, detail: Detail): string[] {
  const { main, tail } = proseRich(s, detail);
  return tail.length ? [md(main), '', md(tail)] : [md(main)];
}

export function ruleRows(s: NormSlots): [string, Rich | Rich[]][] {
  const rows: [string, Rich | Rich[]][] = [];
  const start: [string, Rich] = [s.created ? 'If' : 'From', s.created ? [...s.created, ','] : ['the start of the contract,']];
  rows.push(start);
  if (s.isPower) {
    if (s.binding) rows.push(['When', s.binding]);
    rows.push(['Then', [...s.debtor, ' ', { b: 'may' }, ', against ', ...s.creditor, ',', ...(s.binding ? [] : [' at will,'])]]);
    rows.push(['Cause', [...(s.must[0] ?? []), '.']]);
  } else {
    rows.push(['When', s.binding ?? ['immediately,']]);
    rows.push(['Then', [...s.debtor, ' must, for ', ...s.creditor, ', ensure that']]);
    rows.push(['', s.must]);
    if (s.deadlines.length) rows.push(['By', s.deadlines]);
    rows.push(['Otherwise', ['the obligation is violated.']]);
  }
  return rows;
}

export function ruleFoot(s: NormSlots): Rich[] {
  const foot: Rich[] = [];
  if (s.survives) foot.push(['Survives termination.']);
  if (s.controller) foot.push(['Access administered by ', ...s.controller, '.']);
  if (s.dependsOn.length) foot.push(['Refers to ', ...joinList(s.dependsOn.map((n) => [{ norm: n }]), 'and'), '.']);
  if (s.feeds.length) foot.push(['Referred to by ', ...joinList(s.feeds.map((n) => [{ norm: n }]), 'and'), '.']);
  if (s.acRules.length) foot.push([`Rule${s.acRules.length === 1 ? '' : 's'} `, ...joinList(s.acRules.map((r) => [{ code: r.name }]), 'and'), ' apply.']);
  return foot;
}

function ruleMd(s: NormSlots, detail: Detail): string[] {
  const o: string[] = [];
  for (const [k, v] of ruleRows(s)) {
    const isList = Array.isArray(v[0]);
    const body = isList ? bullets(v as Rich[]) : md(v as Rich);
    o.push(k ? `- **${k.toUpperCase()}** ${body}` : `  ${body.trim().startsWith('-') ? body.trim() : '- ' + body}`);
  }
  if (detail === 'full') {
    const foot = ruleFoot(s);
    if (foot.length) o.push('', `_${foot.map(md).join(' ')}_`);
  }
  return o;
}
