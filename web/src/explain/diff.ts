/**
 * Semantic comparison of two versions of a contract (issue #15).
 *
 * Works on the explanation models of a baseline and of the current text, not
 * on the text itself, so reformatting and comment edits are neutral, and a
 * change is reported in the words the Explain tab already uses: the slots of
 * the fact sheet (who owes, created, binding, must bring about, …), the access
 * rules, the declarations, and the contract overview.
 *
 * Alignment: items are matched by name first; a removed item and an added item
 * of the same kind whose normalized description is identical are reported as a
 * rename. Renames of declarations are applied before rules are compared, and
 * both before norms are compared, so that renaming `mcdc` to `government` does
 * not make every norm that mentions it look rewritten.
 */
import type { ContractModel, RuleModel } from '../model/api.js';
import type { DeclaredVar, ExplainNorm, NormKind } from './types.js';
import { overview, plain, rulePhrase, slots, type NormSlots, type OverviewSlots, type Rich } from './verbalize.js';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'renamed' | 'unchanged';

/** One slot of a norm (or of the overview) that differs. Lists give added/removed
 *  items; scalar slots give before/after. */
export type SlotChange = {
  slot: string;
  before?: Rich | null;
  after?: Rich | null;
  added: Rich[];
  removed: Rich[];
};

export type NormChange = {
  name: string;          // current name (old name for removed norms)
  oldName?: string;      // set when renamed
  kind: NormKind;
  change: ChangeKind;
  slots: SlotChange[];
  noteChanged: boolean;
  line: number; col: number;      // in the current text (baseline for removed norms)
  old?: NormSlots;                // baseline slots, renames applied (removed / changed / renamed)
  oldNorm?: ExplainNorm;          // baseline norm as extracted (removed / changed / renamed)
};

export type ItemChange = {
  group: string;         // 'Declarations' | 'Parameters' | 'Domain' | 'Access rules'
  name: string;
  oldName?: string;
  change: Exclude<ChangeKind, 'unchanged'>;
  before?: Rich;
  after?: Rich;
  line?: number;
};

export type ContractDiff = {
  baselineName: string;
  /** Every current norm (with its change kind) followed by the removed ones. */
  norms: NormChange[];
  /** Declarations, parameters, domain types and access rules that changed. */
  items: ItemChange[];
  /** Overview slots that changed (parties, preconditions, how it can end, …). */
  overview: SlotChange[];
  /** old identifier -> new identifier, for every detected rename. */
  renames: Map<string, string>;
  /** current name -> change kind, for outline and editor markers. */
  marks: Map<string, ChangeKind>;
  /** names that exist only in the baseline, with the outline section they belonged to. */
  removed: { name: string; section: string; line: number }[];
  total: number;
};

// ------------------------------------------------------------------ helpers

const key = (r: Rich): string => plain(r).replace(/\s+/g, ' ').trim();

/** Apply identifier renames to a rich fragment list (roots of dotted paths and norm names). */
export function renameRich(r: Rich, map: Map<string, string>): Rich {
  if (map.size === 0) return r;
  return r.map((f) => {
    if (typeof f === 'string') return f;
    if ('code' in f) {
      const [root, ...rest] = f.code.split('.');
      const nr = map.get(root);
      return nr ? { code: [nr, ...rest].join('.') } : f;
    }
    if ('norm' in f) { const nn = map.get(f.norm); return nn ? { norm: nn } : f; }
    return f;
  });
}

type Aligned<T> = { pairs: [T, T][]; added: T[]; removed: T[]; renamed: [T, T][] };

/** Match by name, then pair leftovers with identical signatures as renames. */
function align<T>(olds: T[], news: T[], name: (t: T) => string, sig: (t: T) => string): Aligned<T> {
  const byOld = new Map(olds.map((o) => [name(o), o]));
  const byNew = new Map(news.map((n) => [name(n), n]));
  const pairs: [T, T][] = [];
  const removed: T[] = []; const added: T[] = [];
  for (const o of olds) { const n = byNew.get(name(o)); if (n) pairs.push([o, n]); else removed.push(o); }
  for (const n of news) if (!byOld.has(name(n))) added.push(n);
  const renamed: [T, T][] = [];
  for (const o of removed.slice()) {
    const s = sig(o);
    const cands = added.filter((n) => sig(n) === s);
    if (cands.length === 1) {
      renamed.push([o, cands[0]]);
      removed.splice(removed.indexOf(o), 1);
      added.splice(added.indexOf(cands[0]), 1);
    }
  }
  return { pairs, added, removed, renamed };
}

function listChange(slot: string, before: Rich[], after: Rich[]): SlotChange | null {
  const bk = new Map(before.map((r) => [key(r), r]));
  const ak = new Map(after.map((r) => [key(r), r]));
  const added = after.filter((r) => !bk.has(key(r)));
  const removed = before.filter((r) => !ak.has(key(r)));
  return added.length || removed.length ? { slot, added, removed } : null;
}

function scalarChange(slot: string, before: Rich | null, after: Rich | null): SlotChange | null {
  const b = before ? key(before) : '', a = after ? key(after) : '';
  return b === a ? null : { slot, before, after, added: [], removed: [] };
}

// ------------------------------------------------------------------ declarations, domain, rules

type Decl = DeclaredVar & { section: string };

function declarations(m: ContractModel): Decl[] {
  const c = m.explain!.contract;
  const tag = (xs: DeclaredVar[], section: string): Decl[] => xs.map((d) => ({ ...d, section }));
  return [
    ...tag(c.parties, 'Declarations'), ...tag(c.events, 'Declarations'), ...tag(c.assets, 'Declarations'),
    ...tag(c.sensors, 'Declarations'), ...tag(c.others, 'Declarations'),
  ];
}

const declRich = (d: DeclaredVar): Rich => {
  const init = Object.entries(d.init ?? {});
  return [{ code: d.var }, ` (${d.type}${d.thirdParty ? ', third party' : ''})`,
    ...(init.length ? [': ', ...init.flatMap(([k, v], i) => [i ? ', ' : '', `${k} := `, { code: exprText(v) }] as Rich)] : [])];
};
const exprText = (e: unknown): string => {
  if (!e || typeof e !== 'object') return String(e);
  const o = e as Record<string, unknown>;
  if (o['t'] === 'var') return String(o['ref']);
  if (o['t'] === 'lit') return typeof o['value'] === 'string' ? `"${o['value']}"` : String(o['value']);
  if (o['t'] === 'enum') return `${o['enum']}.${o['item']}`;
  return JSON.stringify(e);
};
const declSig = (d: DeclaredVar, map: Map<string, string>): string =>
  `${d.category}|${d.type}|${!!d.thirdParty}|${key(renameRich(declRich({ ...d, var: '@' }), map))}`;

type DomainItem = { name: string; line: number; kind: 'type' | 'enum'; sig: string; text: Rich };
function domainItems(m: ContractModel): DomainItem[] {
  const out: DomainItem[] = [];
  for (const t of m.domainModel?.types ?? []) {
    const attrs = t.attributes.map((a) => `${a.modifier ? a.modifier + ' ' : ''}${a.type} ${a.name}`);
    out.push({ name: t.name, line: t.line, kind: 'type', sig: `${t.category}|${t.parent ?? ''}|${t.thirdParty}|${attrs.join(';')}`,
      text: [{ code: t.name }, t.parent ? ` isA ${t.parent}` : '', attrs.length ? ` { ${attrs.join('; ')} }` : ''] });
  }
  for (const e of m.domainModel?.enums ?? []) {
    out.push({ name: e.name, line: e.line, kind: 'enum', sig: `enum|${e.items.join(',')}`, text: [{ code: e.name }, ` { ${e.items.join(', ')} }`] });
  }
  return out;
}

const ruleSig = (r: RuleModel, map: Map<string, string>): string => {
  const mp = (s: string) => { const [root, ...rest] = s.split('.'); return [map.get(root) ?? root, ...rest].join('.'); };
  return `${r.action}|${r.permission}|${mp(r.role)}|${mp(r.resource)}|${mp(r.controller)}`;
};

// ------------------------------------------------------------------ norms

const SCALAR_SLOTS = (s: NormSlots): [string, Rich | null][] => [
  ['Kind', [s.kind]],
  [s.isPower ? 'Who holds it' : 'Who owes', [...s.debtorLong, ' / ', ...s.creditorLong]],
  [s.isPower ? 'Arises' : 'Created', s.created],
  ['Access administered by', s.controller],
];
const LIST_SLOTS = (s: NormSlots): [string, Rich[]][] => [
  [s.isPower ? 'Exercisable' : 'Binding', s.binding ?? []],
  [s.isPower ? 'Effect' : 'Must bring about', s.must],
  ['Deadline', s.deadlines],
  ['Refers to', s.dependsOn.map((n) => [{ norm: n }])],
  ['Referred to by', s.feeds.map((n) => [{ norm: n }])],
  ['Access rules', s.acRules.map(rulePhrase)],
];

function mapSlots(s: NormSlots, map: Map<string, string>): NormSlots {
  const m = (r: Rich) => renameRich(r, map);
  const ml = (rs: Rich[]) => rs.map(m);
  return {
    ...s,
    debtor: m(s.debtor), creditor: m(s.creditor), debtorLong: m(s.debtorLong), creditorLong: m(s.creditorLong),
    created: s.created ? m(s.created) : null, binding: s.binding ? ml(s.binding) : null, must: ml(s.must),
    deadlines: ml(s.deadlines), controller: s.controller ? m(s.controller) : null,
    dependsOn: s.dependsOn.map((n) => map.get(n) ?? n), feeds: s.feeds.map((n) => map.get(n) ?? n),
    acRules: s.acRules.map((r) => ({ ...r, name: map.get(r.name) ?? r.name,
      role: map.get(r.role.split('.')[0]) ? [map.get(r.role.split('.')[0])!, ...r.role.split('.').slice(1)].join('.') : r.role,
      resource: map.get(r.resource.split('.')[0]) ? [map.get(r.resource.split('.')[0])!, ...r.resource.split('.').slice(1)].join('.') : r.resource,
      controller: map.get(r.controller) ?? r.controller })),
  };
}

/** Signature of a norm with its own name blanked, for rename detection. */
function normSig(s: NormSlots): string {
  const self = new Map([[s.name, '@self']]);
  const t = mapSlots(s, self);
  return [t.kind, ...SCALAR_SLOTS(t).map(([, r]) => (r ? key(r) : '')), ...LIST_SLOTS(t).map(([, rs]) => rs.map(key).sort().join('|'))].join('#');
}

function normSlotChanges(before: NormSlots, after: NormSlots): SlotChange[] {
  const out: SlotChange[] = [];
  const bs = SCALAR_SLOTS(before), as = SCALAR_SLOTS(after);
  as.forEach(([slot, r], i) => { const c = scalarChange(slot, bs[i]?.[1] ?? null, r); if (c) out.push(c); });
  const bl = LIST_SLOTS(before), al = LIST_SLOTS(after);
  al.forEach(([slot, rs], i) => { const c = listChange(slot, bl[i]?.[1] ?? [], rs); if (c) out.push(c); });
  return out;
}

// ------------------------------------------------------------------ main

export function compareModels(base: ContractModel, cur: ContractModel, baselineName: string): ContractDiff | null {
  if (!base.explain || !cur.explain || base.explain.error || cur.explain.error) return null;
  const items: ItemChange[] = [];
  const marks = new Map<string, ChangeKind>();
  const removed: ContractDiff['removed'] = [];
  const renames = new Map<string, string>();

  // 1. Declarations (roles, assets, events, sensors, …) and parameters.
  const dA = align(declarations(base), declarations(cur), (d) => d.var, (d) => declSig(d, new Map()));
  for (const [o, n] of dA.renamed) { renames.set(o.var, n.var); marks.set(n.var, 'renamed'); items.push({ group: 'Declarations', name: n.var, oldName: o.var, change: 'renamed', before: declRich(o), after: declRich(n), line: n.line }); }
  for (const [o, n] of dA.pairs) {
    if (declSig(o, renames) !== declSig(n, new Map())) { marks.set(n.var, 'changed'); items.push({ group: 'Declarations', name: n.var, change: 'changed', before: renameRich(declRich(o), renames), after: declRich(n), line: n.line }); }
  }
  for (const n of dA.added) { marks.set(n.var, 'added'); items.push({ group: 'Declarations', name: n.var, change: 'added', after: declRich(n), line: n.line }); }
  for (const o of dA.removed) { removed.push({ name: o.var, section: 'Declarations', line: o.line }); items.push({ group: 'Declarations', name: o.var, change: 'removed', before: declRich(o), line: o.line }); }

  const pA = align(base.explain.contract.parameters, cur.explain.contract.parameters, (p) => p.name, (p) => p.type);
  const paramRich = (p: { name: string; type: string }): Rich => [{ code: p.name }, ` (${p.type})`];
  for (const [o, n] of pA.renamed) { renames.set(o.name, n.name); items.push({ group: 'Parameters', name: n.name, oldName: o.name, change: 'renamed', before: paramRich(o), after: paramRich(n) }); }
  for (const [o, n] of pA.pairs) if (o.type !== n.type) items.push({ group: 'Parameters', name: n.name, change: 'changed', before: paramRich(o), after: paramRich(n) });
  for (const n of pA.added) items.push({ group: 'Parameters', name: n.name, change: 'added', after: paramRich(n) });
  for (const o of pA.removed) items.push({ group: 'Parameters', name: o.name, change: 'removed', before: paramRich(o) });

  // 2. Domain types and enumerations.
  const tA = align(domainItems(base), domainItems(cur), (t) => t.name, (t) => `${t.kind}|${t.sig}`);
  for (const [o, n] of tA.renamed) { renames.set(o.name, n.name); marks.set(n.name, 'renamed'); items.push({ group: 'Domain', name: n.name, oldName: o.name, change: 'renamed', before: o.text, after: n.text, line: n.line }); }
  for (const [o, n] of tA.pairs) if (o.sig !== n.sig) { marks.set(n.name, 'changed'); items.push({ group: 'Domain', name: n.name, change: 'changed', before: o.text, after: n.text, line: n.line }); }
  for (const n of tA.added) { marks.set(n.name, 'added'); items.push({ group: 'Domain', name: n.name, change: 'added', after: n.text, line: n.line }); }
  for (const o of tA.removed) { removed.push({ name: o.name, section: 'Domain', line: o.line }); items.push({ group: 'Domain', name: o.name, change: 'removed', before: o.text, line: o.line }); }

  // 3. Access rules (declaration renames applied to the baseline side).
  const rA = align(base.rules ?? [], cur.rules ?? [], (r) => r.name, (r) => ruleSig(r, renames));
  const ruleOld = (r: RuleModel): Rich => renameRich(rulePhrase(r), renames);
  for (const [o, n] of rA.renamed) { renames.set(o.name, n.name); marks.set(n.name, 'renamed'); items.push({ group: 'Access rules', name: n.name, oldName: o.name, change: 'renamed', before: ruleOld(o), after: rulePhrase(n), line: n.line }); }
  for (const [o, n] of rA.pairs) if (ruleSig(o, renames) !== ruleSig(n, new Map())) { marks.set(n.name, 'changed'); items.push({ group: 'Access rules', name: n.name, change: 'changed', before: ruleOld(o), after: rulePhrase(n), line: n.line }); }
  for (const n of rA.added) { marks.set(n.name, 'added'); items.push({ group: 'Access rules', name: n.name, change: 'added', after: rulePhrase(n), line: n.line }); }
  for (const o of rA.removed) { removed.push({ name: o.name, section: 'ACPolicy', line: o.line }); items.push({ group: 'Access rules', name: o.name, change: 'removed', before: ruleOld(o), line: o.line }); }

  // 4. Norms: slots of the baseline are computed with the baseline's rules, then renamed.
  const oldSlots = new Map(base.explain.norms.map((n) => [n.name, mapSlots(slots(n, base.rules ?? []), renames)]));
  const newSlots = new Map(cur.explain.norms.map((n) => [n.name, slots(n, cur.rules ?? [])]));
  const baseNorms = new Set(base.explain.norms);
  const nA = align(base.explain.norms, cur.explain.norms, (n) => n.name, (n) => normSig(baseNorms.has(n) ? oldSlots.get(n.name)! : newSlots.get(n.name)!));
  // Norm renames must also be applied to references inside other norms' slots.
  for (const [o, n] of nA.renamed) renames.set(o.name, n.name);
  const normRen = new Map([...nA.renamed].map(([o, n]) => [o.name, n.name]));
  const oldMapped = (name: string) => mapSlots(oldSlots.get(name)!, normRen);

  const norms: NormChange[] = [];
  const section = (k: NormKind) => (k === 'power' ? 'Powers' : k === 'survivingObligation' ? 'Surviving' : 'Obligations');
  const noteOf = (n: ExplainNorm) => (n.authorNote ?? '').trim();
  for (const n of cur.explain.norms) {
    const s = newSlots.get(n.name)!;
    const pair = nA.pairs.find(([, x]) => x.name === n.name);
    const ren = nA.renamed.find(([, x]) => x.name === n.name);
    if (!pair && !ren) {
      marks.set(n.name, 'added');
      norms.push({ name: n.name, kind: n.kind, change: 'added', slots: [], noteChanged: false, line: n.line, col: n.col });
      continue;
    }
    const oldNorm = (pair ?? ren)![0];
    const old = oldMapped(oldNorm.name);
    const sc = normSlotChanges(old, s);
    const noteChanged = noteOf(oldNorm) !== noteOf(n);
    const change: ChangeKind = ren ? 'renamed' : sc.length || noteChanged ? 'changed' : 'unchanged';
    if (change !== 'unchanged') marks.set(n.name, change);
    norms.push({ name: n.name, oldName: ren ? oldNorm.name : undefined, kind: n.kind, change, slots: sc, noteChanged, line: n.line, col: n.col, old, oldNorm });
  }
  for (const o of nA.removed) {
    removed.push({ name: o.name, section: section(o.kind), line: o.line });
    norms.push({ name: o.name, kind: o.kind, change: 'removed', slots: [], noteChanged: false, line: o.line, col: o.col, old: oldMapped(o.name), oldNorm: o });
  }

  // 5. Contract overview (lists compared as sets, after renames).
  const ovB = overview(base.explain.contract, base.explain.norms, base.rules ?? []);
  const ovC = overview(cur.explain.contract, cur.explain.norms, cur.rules ?? []);
  const ovChanges: SlotChange[] = [];
  const ml = (rs: Rich[]) => rs.map((r) => renameRich(r, renames));
  const push = (c: SlotChange | null) => { if (c) ovChanges.push(c); };
  push(scalarChange('Summary', renameRich(ovB.summary, renames), ovC.summary));
  const lists: [string, keyof OverviewSlots][] = [
    ['Fixed when the contract is created', 'fixed'], ['Comes into force only if', 'preconditions'], ['How it can end', 'ends'],
    ['Still owed after it ends', 'survives'], ['Monitoring', 'sensors'], ['When it ends, the following must hold', 'postconditions'],
    ['Throughout the contract', 'constraints'],
  ];
  for (const [label, k] of lists) push(listChange(label, ml(ovB[k] as Rich[]), ovC[k] as Rich[]));
  push(scalarChange('Who controls access to information', ovB.access ? renameRich(ovB.access, renames) : null, ovC.access));

  const total = norms.filter((n) => n.change !== 'unchanged').length + items.length + ovChanges.length;
  return { baselineName, norms, items, overview: ovChanges, renames, marks, removed, total };
}

// ------------------------------------------------------------------ line diff (for the editor gutter)

export type Hunk = { aStart: number; aLen: number; bStart: number; bLen: number }; // 0-based line indices

/** Line-level diff (LCS); trims the common prefix/suffix first so typical edits are cheap. */
export function lineDiff(a: string[], b: string[]): Hunk[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const n = A.length, m = B.length;
  if (n === 0 && m === 0) return [];
  if (n * m > 4_000_000) return [{ aStart: pre, aLen: n, bStart: pre, bLen: m }]; // one coarse hunk for huge edits
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks: Hunk[] = [];
  let i = 0, j = 0;
  let cur: Hunk | null = null;
  const open = () => { if (!cur) cur = { aStart: pre + i, aLen: 0, bStart: pre + j, bLen: 0 }; };
  const close = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { close(); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { open(); cur!.bLen++; j++; }
    else { open(); cur!.aLen++; i++; }
  }
  close();
  return hunks;
}

// ------------------------------------------------------------------ change note (Markdown)

const md = (r: Rich | null | undefined): string => (r ? r.map((f) => (typeof f === 'string' ? f : 'code' in f ? `\`${f.code}\`` : 'norm' in f ? `\`${f.norm}\`` : 'b' in f ? `**${f.b}**` : `*${f.i}*`)).join('') : '');

export function diffMarkdown(d: ContractDiff, contractName: string): string {
  const out: string[] = [`# Changes to ${contractName} since ${d.baselineName}`, ''];
  if (d.total === 0) { out.push('No change in meaning: the two versions describe the same contract.'); return out.join('\n'); }
  const slotLines = (sc: SlotChange[]): string[] => sc.flatMap((c) => c.added.length || c.removed.length
    ? [`  - ${c.slot}:`, ...c.added.map((r) => `    - added: ${md(r)}`), ...c.removed.map((r) => `    - removed: ~~${md(r)}~~`)]
    : [`  - ${c.slot}: ${c.before ? `~~${md(c.before)}~~` : '*(none)*'} → ${c.after ? md(c.after) : '*(none)*'}`]);
  const changedNorms = d.norms.filter((n) => n.change !== 'unchanged');
  if (changedNorms.length) {
    out.push('## Obligations and powers', '');
    for (const n of changedNorms) {
      const head = n.change === 'renamed' ? `renamed from \`${n.oldName}\`` : n.change;
      out.push(`- \`${n.name}\` (${n.kind === 'survivingObligation' ? 'surviving obligation' : n.kind}): **${head}**${n.noteChanged ? ', specifier\'s note changed' : ''}`);
      out.push(...slotLines(n.slots));
    }
    out.push('');
  }
  for (const group of ['Declarations', 'Parameters', 'Domain', 'Access rules']) {
    const xs = d.items.filter((it) => it.group === group);
    if (!xs.length) continue;
    out.push(`## ${group}`, '');
    for (const it of xs) {
      if (it.change === 'added') out.push(`- added: ${md(it.after)}`);
      else if (it.change === 'removed') out.push(`- removed: ~~${md(it.before)}~~`);
      else if (it.change === 'renamed') out.push(`- \`${it.oldName}\` renamed to \`${it.name}\`${key(it.before ?? []) !== key(it.after ?? []) ? `: ${md(it.after)}` : ''}`);
      else out.push(`- \`${it.name}\`: ~~${md(it.before)}~~ → ${md(it.after)}`);
    }
    out.push('');
  }
  if (d.overview.length) { out.push('## The contract as a whole', ''); out.push(...slotLines(d.overview).map((l) => l.replace(/^  /, ''))); out.push(''); }
  return out.join('\n');
}
