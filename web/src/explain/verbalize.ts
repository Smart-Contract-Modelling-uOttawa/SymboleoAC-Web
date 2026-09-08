/**
 * Deterministic verbalizer: turns the structured explanation model into
 * "rich text" fragments (plain strings, code identifiers that jump to the
 * source, and links to other norms). The three visual styles all render the
 * same fragments; nothing here depends on React.
 *
 * Every rule below maps one construct of the language to one phrasing, so the
 * text is faithful to the specification by construction. Where an idiom
 * collapses several constructs into one sentence (e.g. several `x.id == y.id`
 * comparisons into "all refer to the same id"), the idiom is documented at the
 * rule.
 */
import type {
  Assignment, EventRef, ExplainContract, ExplainNorm, Expr, IntervalRef, Party,
  PointRef, Prop, SituationRef, VarRef, Effect,
} from './types.js';
import type { RuleModel } from '../model/api.js';

// ------------------------------------------------------------------ fragments

export type Frag =
  | string
  | { code: string }            // identifier; renderer makes it jump to the source
  | { norm: string }            // reference to another obligation/power; renderer links it
  | { b: string }               // emphasis
  | { i: string };              // de-emphasis (meta remarks)
export type Rich = Frag[];

const R = (...parts: (Frag | Rich | null | undefined | false)[]): Rich => {
  const out: Rich = [];
  for (const p of parts) {
    if (p === null || p === undefined || p === false) continue;
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return out;
};
const code = (s: string): Frag => ({ code: s });
const norm = (s: string): Frag => ({ norm: s });

/** Join rich items with ", " and a final connective ("and" / "or"). */
export function joinList(items: Rich[], conj = 'and'): Rich {
  if (items.length === 0) return [];
  if (items.length === 1) return items[0];
  if (items.length === 2) return R(items[0], ` ${conj} `, items[1]);
  const out: Rich = [];
  items.forEach((it, i) => {
    if (i > 0) out.push(i === items.length - 1 ? `, ${conj} ` : ', ');
    out.push(...it);
  });
  return out;
}

/**
 * Join clauses for running prose. Three or more clauses are enumerated
 * "(1) …; (2) …; and (3) …" so nested "and"/"or" inside a clause stays unambiguous.
 */
export function joinClauses(items: Rich[]): Rich {
  if (items.length < 3) return joinList(items, 'and');
  const out: Rich = [];
  items.forEach((it, i) => {
    if (i > 0) out.push(i === items.length - 1 ? '; and ' : '; ');
    out.push(`(${i + 1}) `, ...it);
  });
  return out;
}

/** Plain-text projection (used for titles, tooltips, Markdown). */
export function plain(r: Rich): string {
  return r.map((f) => (typeof f === 'string' ? f
    : 'code' in f ? f.code : 'norm' in f ? f.norm : 'b' in f ? f.b : f.i)).join('');
}

export function capitalize(r: Rich): Rich {
  if (r.length === 0) return r;
  const [h, ...rest] = r;
  if (typeof h === 'string' && h.length > 0) return [h[0].toUpperCase() + h.slice(1), ...rest];
  return r;
}

// ------------------------------------------------------------------ naming

/** "LeadtimeInformedNegotiated" -> "leadtime informed negotiated"; "FDAapproval" -> "FDA approval". */
export function humanize(id: string): string {
  if (!id) return '';
  return id
    .replace(/_/g, ' ')
    .replace(/([A-Z]{2,})([a-z]{3,})/g, '$1 $2')   // FDAapproval -> FDA approval
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.toLowerCase()))
    .join(' ');
}

/** Present-tense verb phrases for common event types. Fallback is generic; see eventPhrase(). */
const EVENT_VERBS: Record<string, string> = {
  Requested: 'submits a request',
  Invoiced: 'records an invoice',
  Paid: 'pays',
  Delivered: 'delivers',
  Confirmed: 'confirms',
  Agreed: 'agrees',
  NotifiedOfDelivery: 'gives notice of the delivery date',
  LeadtimeInformedNegotiated: 'informs the negotiated lead time',
  Risk: 'declares an outside risk',
  WithdrewApproval: 'withdraws approval',
  StopWork: 'issues a stop-work order',
  ThirdPartyStopWork: 'issues a stop-work order',
  TerminateAgreementG: 'declares the agreement terminated',
  TerminateAgreementM: 'declares the agreement terminated',
  // trade / Incoterms-style events
  InvoiceProvided: 'provides the invoice',
  PackagedAndMarked: 'packages and marks',
  ExportCleared: 'clears for export',
  ImportClearedByBuyer: 'clears for import',
  SecurityComplied: 'complies with security requirements',
  VesselNominated: 'nominates the vessel',
  VesselFailedToLoad: 'records that the vessel failed to load',
  LoadedOnBoard: 'loads on board',
  ProcuredSoDelivered: 'procures goods so delivered',
  BillOfLadingIssued: 'issues the bill of lading',
  DocumentsProvided: 'provides the documents',
  DeliveryNoticeGiven: 'gives notice of delivery',
  GoodsTakenOver: 'takes over the goods',
  GoodsIdentified: 'identifies the goods',
  AdditionalCostsPaid: 'pays the additional costs',
  AssistanceToBuyerRequested: 'requests assistance',
  AssistanceToSellerRequested: 'requests assistance',
  AssistanceToBuyerProvided: 'provides the assistance',
  AssistanceToSellerProvided: 'provides the assistance',
  AssistanceToBuyerReimbursed: 'reimburses the assistance',
  AssistanceToSellerReimbursed: 'reimburses the assistance',
  // sale / rental events
  PaidLate: 'pays late',
  UnLoaded: 'unloads',
  InspectedQuality: 'inspects the quality',
  Inspected: 'inspects',
  PasswordNotification: 'sends the password notification',
  Returned: 'returns',
  Disclosed: 'discloses',
};

const STATE_WORDS: Record<string, string> = {
  Fulfilled: 'has been fulfilled', Violated: 'is violated', Triggered: 'is triggered',
  Activated: 'becomes active', Suspended: 'is suspended', Resumed: 'is resumed',
  Discharged: 'is discharged', Expired: 'expires', Terminated: 'is terminated',
  Exerted: 'is exercised', Rescinded: 'is rescinded',
  FulfilledObligations: 'has fulfilled all its obligations',
  RevokedParty: 'has a party revoked', AssignedParty: 'has a party assigned',
};

const SITUATION_WORDS: Record<string, string> = {
  Create: 'created', Discharge: 'discharged', Active: 'active', InEffect: 'in effect',
  Suspension: 'suspended', Violation: 'violated', Fulfillment: 'fulfilled',
  UnsuccessfulTermination: 'terminated unsuccessfully', SuccessfulTermination: 'terminated successfully',
  Form: 'being formed', UnAssign: 'unassigned', Rescission: 'rescinded',
};

const UNIT_WORDS: Record<string, string> = {
  seconds: 'seconds', minutes: 'minutes', hours: 'hours', days: 'days', weeks: 'weeks', months: 'months', years: 'years',
};

// ------------------------------------------------------------------ parties

/** A party by its exact identifier: `mcdc`. */
export function partyPhrase(p: Party | VarRef | undefined | null): Rich {
  if (!p) return ['an unspecified party'];
  const v = 'var' in p ? p.var : '';
  return R(code(v || ('ref' in p ? p.ref : '?')));
}

/** Identifier with its declared type: `mcdc` (Government). */
export function partyLong(p: Party | VarRef | undefined | null): Rich {
  if (!p) return ['an unspecified party'];
  const type = 'type' in p ? p.type : undefined;
  return R(partyPhrase(p), type ? ` (${type})` : '');
}

// ------------------------------------------------------------------ events

/** Declarative clause for an event happening: "the Government submits a request (`requested`)". */
export function eventPhrase(e: EventRef): Rich {
  switch (e.k) {
    case 'var': {
      const verb = e.type ? EVENT_VERBS[e.type] : undefined;
      const who = e.performer ? partyPhrase(e.performer) : null;
      if (verb && who) return R(who, ` ${verb} (`, code(e.var), ')');
      if (verb) return R(code(e.var), ` (${e.type}) occurs`);
      if (e.category === 'DataTransfer') {
        return R(code(e.var), e.type ? ` (${e.type})` : '', who ? R(' is raised by ', who) : ' is received');
      }
      const type = e.type ? ` (${e.type})` : '';
      if (who) return R(who, ' performs ', code(e.var), type);
      return R(code(e.var), type, ' occurs');
    }
    case 'obligation':
      return R('obligation ', norm(e.norm), ' ', STATE_WORDS[e.state] ?? `is ${humanize(e.state)}`);
    case 'power':
      return R('power ', norm(e.norm), ' ', STATE_WORDS[e.state] ?? `is ${humanize(e.state)}`);
    case 'contract':
      return R('the contract ', STATE_WORDS[e.state] ?? `is ${humanize(e.state)}`);
    default:
      return [code(e.text || '?')];
  }
}

/** Noun phrase for an event (for "before X"): "the Government's confirmation (`confirmed`)" is hard
 *  to derive generically, so we use "the moment <clause>" only when needed and otherwise the identifier. */
export function eventNoun(e: EventRef): Rich {
  switch (e.k) {
    case 'var': return [code(e.var)];
    case 'obligation': return R('obligation ', norm(e.norm), ' being ', e.state.toLowerCase());
    case 'power': return R('power ', norm(e.norm), ' being ', e.state.toLowerCase());
    case 'contract': return R('the contract being ', e.state.toLowerCase());
    default: return [code(e.text || '?')];
  }
}

export function pointPhrase(p: PointRef): Rich {
  if ('k2' in p) return eventNoun(p);
  switch (p.k) {
    case 'var': return varPhrase(p);
    case 'add': {
      const n = typeof p.value === 'number' ? String(p.value) : plain(varPhrase(p.value));
      return R(`${n} ${UNIT_WORDS[p.unit] ?? p.unit} after `, pointPhrase(p.arg));
    }
    default: return [code(p.text || '?')];
  }
}

export function situationPhrase(s: SituationRef): Rich {
  const word = SITUATION_WORDS[s.state] ?? humanize(s.state);
  if (s.of === 'contract') return R('the contract is ', word);
  return R(s.of === 'power' ? 'power ' : 'obligation ', norm(s.norm ?? '?'), ' is ', word);
}

export function intervalPhrase(iv: IntervalRef): Rich {
  switch (iv.k) {
    case 'interval': return R('between ', pointPhrase(iv.from), ' and ', pointPhrase(iv.to));
    case 'situation': return R('while ', situationPhrase(iv));
    default: return [code(iv.text || '?')];
  }
}

// ------------------------------------------------------------------ variables & expressions

/** Exact reference as written in the specification: `invoiced.date`. */
export function varPhrase(v: VarRef): Rich {
  return [code(v.ref || v.var)];
}

const NEGATED: Record<string, string> = { '==': '!=', '!=': '==', '>=': '<', '<=': '>', '>': '<=', '<': '>=' };
const CMP_WORDS: Record<string, string> = {
  '==': 'equals', '!=': 'differs from', '>=': 'is at least', '<=': 'is at most', '>': 'is more than', '<': 'is less than',
};
const ARITH_WORDS: Record<string, string> = { '+': ' + ', '-': ' − ', '*': ' × ', '/': ' ÷ ', '%': ' mod ' };

export function exprPhrase(e: Expr | Prop): Rich {
  switch (e.t) {
    case 'var': return varPhrase(e);
    case 'lit':
      if (e.kind === 'string') return [`"${String(e.value)}"`];
      if (e.kind === 'bool') return [e.value ? 'true' : 'false'];
      return [String(e.value)];
    case 'enum': return [`${e.item}`];
    case 'arith': return R(exprPhrase(e.left as Expr), ARITH_WORDS[e.op] ?? ` ${e.op} `, exprPhrase(e.right as Expr));
    case 'cmp': return cmpPhrase(e as { op: string; left: Prop; right: Prop });
    case 'not': return R('not (', exprPhrase(e.p as Expr), ')');
    case 'and': return joinList((e.items as Expr[]).map(exprPhrase), 'and');
    case 'or': return joinList((e.items as Expr[]).map(exprPhrase), 'or');
    case 'fn': {
      const args = Array.isArray(e.args) ? (e.args as (Expr | string)[]) : [];
      if (e.name === 'Date.add' && args.length >= 2 && 'unit' in e) {
        return R(exprPhrase(args[1] as Expr), ` ${e.unit} after `, exprPhrase(args[0] as Expr));
      }
      const named = args.map((a) => (typeof a === 'string' ? code(a) : code(plain(exprPhrase(a)))));
      if (e.name === 'IsEqual' && named.length === 2) return R(named[0], ' and ', named[1], ' are the same');
      if (e.name === 'IsOwner' && named.length === 2) return R(named[0], ' owns ', named[1]);
      if (e.name === 'CannotBeAssigned' && named.length === 1) return R(named[0], ' cannot be assigned');
      return R(`${e.name}(`, joinList(args.map((a) => (typeof a === 'string' ? [code(a)] : exprPhrase(a))), 'and'), ')');
    }
    default: return [code((e as { text?: string }).text ?? '?')];
  }
}

function cmpPhrase(c: { op: string; left: Prop; right: Prop }): Rich {
  const l = c.left, r = c.right;
  // x == true / x == false  ->  "x holds" / "x does not hold"
  if (r.t === 'lit' && r.kind === 'bool' && c.op === '==') {
    return R(exprPhrase(l), r.value ? ' holds' : ' does not hold');
  }
  if (r.t === 'lit' && r.kind === 'bool' && c.op === '!=') {
    return R(exprPhrase(l), r.value ? ' does not hold' : ' holds');
  }
  return R(exprPhrase(l), ` ${CMP_WORDS[c.op] ?? c.op} `, exprPhrase(r));
}

export function assignmentPhrase(a: Assignment): Rich {
  const tgt = varPhrase(a.target);
  const e = a.expr;
  // x := x - y  ->  "x is reduced by y";  x := x + y  ->  "x is increased by y"
  if (e.t === 'arith' && e.left.t === 'var' && e.left.ref === a.target.ref && (e.op === '-' || e.op === '+')) {
    return R(tgt, e.op === '-' ? ' is reduced by ' : ' is increased by ', exprPhrase(e.right));
  }
  return R(tgt, ' is set to ', exprPhrase(e));
}

// ------------------------------------------------------------------ propositions

/**
 * A proposition as one declarative clause. Conjunctions become "…, … and …";
 * for bullet lists use clauses() instead, which also applies the idioms.
 */
export function propPhrase(p: Prop): Rich {
  switch (p.t) {
    case 'and': return joinList(clauses(p), 'and');
    case 'or': {
      const alt = sameVerbAlternatives(p.items) ?? sameEventBefore(p.items);
      return alt ?? R('either ', joinList(p.items.map(propPhrase), 'or'));
    }
    case 'not':
      if (p.p.t === 'happens') return R(eventNoun(p.p.event), ' does not occur');
      if (p.p.t === 'fn' && p.p.name === 'IsEqual' && p.p.args.length === 2) return R(code(p.p.args[0]), ' and ', code(p.p.args[1]), ' are different');
      if (p.p.t === 'fn' && p.p.name === 'IsOwner' && p.p.args.length === 2) return R(code(p.p.args[0]), ' does not own ', code(p.p.args[1]));
      if (p.p.t === 'cmp') return cmpPhrase({ ...p.p, op: NEGATED[p.p.op] ?? p.p.op });
      return R('it is not the case that ', propPhrase(p.p));
    case 'happens': return eventPhrase(p.event);
    case 'before':
      return R(eventPhrase(p.event), p.strict ? ' strictly before ' : ' on or before ', pointPhrase(p.point));
    case 'beforeEvent':
      return R(eventPhrase(p.event), p.strict ? ' strictly before ' : ' on or before ', eventNoun(p.event2));
    case 'after': return R(eventPhrase(p.event), ' after ', pointPhrase(p.point));
    case 'within': return R(eventPhrase(p.event), ' ', intervalPhrase(p.interval));
    case 'occurs': return R(situationPhrase(p.situation), ' ', intervalPhrase(p.interval));
    case 'happensAssign':
      return R('when ', eventPhrase(p.event), ', ', joinList(p.assignments.map(assignmentPhrase), 'and'));
    case 'assign': return joinList(p.assignments.map(assignmentPhrase), 'and');
    case 'lit':
      if (p.kind === 'bool') return [p.value ? 'always' : 'never'];
      return exprPhrase(p);
    case 'cmp': return cmpPhrase(p);
    default: return exprPhrase(p);
  }
}

/**
 * Idiom for "Happens(a) or Happens(b) or Happens(c)" where all events share a
 * verb: "either the Government (lawStopWork) or the Regulator (adminStopWork,
 * regulationStopWork or judicialStopWork) issues a stop-work order".
 */
function sameVerbAlternatives(items: Prop[]): Rich | null {
  if (items.length < 2) return null;
  const evs: { var: string; performer?: VarRef; verb: string }[] = [];
  for (const it of items) {
    if (it.t !== 'happens' || it.event.k !== 'var' || !it.event.type) return null;
    const verb = EVENT_VERBS[it.event.type];
    if (!verb) return null;
    evs.push({ var: it.event.var, performer: it.event.performer, verb });
  }
  if (new Set(evs.map((e) => e.verb)).size !== 1) return null;
  const groups = new Map<string, { performer?: VarRef; vars: string[] }>();
  for (const e of evs) {
    const key = e.performer?.var ?? '';
    const g = groups.get(key) ?? { performer: e.performer, vars: [] };
    g.vars.push(e.var);
    groups.set(key, g);
  }
  const parts = [...groups.values()].map((g) =>
    R(g.performer ? partyPhrase(g.performer) : 'someone', ' (', joinList(g.vars.map((v) => [code(v)]), 'or'), ')'));
  return R('either ', joinList(parts, 'or'), ` ${evs[0].verb}`);
}

/**
 * Idiom for "Before(e, p1) or Before(e, p2)": "<e> strictly before p1 or p2".
 */
function sameEventBefore(items: Prop[]): Rich | null {
  if (items.length < 2) return null;
  const first = items[0];
  if (first.t !== 'before') return null;
  const key = JSON.stringify(first.event);
  for (const it of items) {
    if (it.t !== 'before' || it.strict !== first.strict || JSON.stringify(it.event) !== key) return null;
  }
  const points = items.map((it) => pointPhrase((it as { point: PointRef }).point));
  return R(eventPhrase(first.event), first.strict ? ' strictly before ' : ' on or before ', joinList(points, 'or'));
}

/** True for the literal `true` antecedent / trigger. */
export const isTrue = (p: Prop | null | undefined): boolean => !!p && p.t === 'lit' && p.kind === 'bool' && p.value === true;

/**
 * Break a proposition into bullet-sized clauses. Top-level conjunctions are
 * split; then three idioms merge related items:
 *  1. correlation:  a.id == b.id, c.id == b.id  ->  "a, c and b all refer to the same id"
 *  2. absence:      not Happens(e) or e.id != f.id  ->  "no e occurs for this id" (grouped)
 *  3. range:        x >= lo and x <= hi            ->  "x is between lo and hi"
 */
export function clauses(p: Prop): Rich[] {
  const items: Prop[] = p.t === 'and' ? p.items : [p];
  const out: Rich[] = [];
  const used = new Set<number>();

  // --- idiom 1: correlation groups keyed by attribute name
  const corr = new Map<string, { idx: number[]; vars: string[] }>();
  items.forEach((it, i) => {
    if (it.t === 'cmp' && it.op === '==' && it.left.t === 'var' && it.right.t === 'var'
        && it.left.attrs.length === 1 && it.right.attrs.length === 1
        && it.left.attrs[0] === it.right.attrs[0] && it.left.var !== it.right.var) {
      const g = corr.get(it.left.attrs[0]) ?? { idx: [], vars: [] };
      g.idx.push(i);
      for (const v of [it.left.var, it.right.var]) if (!g.vars.includes(v)) g.vars.push(v);
      corr.set(it.left.attrs[0], g);
    }
  });

  // --- idiom 2: absence groups keyed by (attribute, anchor var)
  const absence = new Map<string, { idx: number[]; events: EventRef[]; anchor: string; attr: string }>();
  items.forEach((it, i) => {
    if (it.t !== 'or' || it.items.length !== 2) return;
    const [a, b] = it.items;
    const neg = a.t === 'not' && a.p.t === 'happens' ? a.p : (b.t === 'not' && b.p.t === 'happens' ? b.p : null);
    const cmp = a.t === 'cmp' ? a : (b.t === 'cmp' ? b : null);
    if (!neg || !cmp || cmp.op !== '!=' || cmp.left.t !== 'var' || cmp.right.t !== 'var') return;
    if (neg.event.k !== 'var') return;
    const ev = neg.event.var;
    const [self, other] = cmp.left.var === ev ? [cmp.left, cmp.right] : (cmp.right.var === ev ? [cmp.right, cmp.left] : [null, null]);
    if (!self || !other || self.attrs.length !== 1 || other.attrs.length !== 1 || self.attrs[0] !== other.attrs[0]) return;
    const key = `${self.attrs[0]}|${other.var}`;
    const g = absence.get(key) ?? { idx: [], events: [], anchor: other.var, attr: self.attrs[0] };
    g.idx.push(i); g.events.push(neg.event);
    absence.set(key, g);
  });

  // --- idiom 3: ranges keyed by the compared reference
  const lo = new Map<string, number>(), hi = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.t !== 'cmp' || it.left.t !== 'var') return;
    if (it.op === '>=' || it.op === '>') lo.set(it.left.ref, i);
    if (it.op === '<=' || it.op === '<') hi.set(it.left.ref, i);
  });

  // Emit in source order; a group is emitted at the position of its first member.
  items.forEach((it, i) => {
    if (used.has(i)) return;
    for (const [attr, g] of corr) {
      if (g.idx[0] === i && g.idx.length >= 1) {
        g.idx.forEach((k) => used.add(k));
        if (g.idx.length === 1) {
          out.push(R(code(g.vars[0]), ' and ', code(g.vars[1]), ' refer to the same ', code(attr)));
        } else {
          out.push(R(joinList(g.vars.map((v) => [code(v)]), 'and'), ' all refer to the same ', code(attr)));
        }
        return;
      }
    }
    for (const [, g] of absence) {
      if (g.idx[0] === i) {
        g.idx.forEach((k) => used.add(k));
        const kinds = new Set(g.events.map((e) => (e.k === 'var' ? e.category : '')));
        const noun = kinds.size === 1 && kinds.has('DataTransfer') ? ' alert' : ' event';
        out.push(R('no ', joinList(g.events.map((e) => [code(e.k === 'var' ? e.var : '?')]), 'or'),
          noun, ' occurs for the same ', code(g.attr), ' as ', code(g.anchor)));
        return;
      }
    }
    if (it.t === 'cmp' && it.left.t === 'var') {
      const ref = it.left.ref;
      const li = lo.get(ref), hj = hi.get(ref);
      if (li !== undefined && hj !== undefined && (i === li || i === hj) && !used.has(li) && !used.has(hj)) {
        used.add(li); used.add(hj);
        const L = items[li] as { op: string; right: Prop }, H = items[hj] as { op: string; right: Prop };
        out.push(R(varPhrase(it.left), ' is between ', exprPhrase(L.right), L.op === '>' ? ' (exclusive)' : '',
          ' and ', exprPhrase(H.right), H.op === '<' ? ' (exclusive)' : ''));
        return;
      }
    }
    used.add(i);
    out.push(propPhrase(it));
  });
  return out;
}

// ------------------------------------------------------------------ deadlines

/** Deadlines stated in a consequent: every "before"/"within" predicate. */
export function deadlines(p: Prop | Effect): Rich[] {
  const out: Rich[] = [];
  const walk = (q: Prop | Effect) => {
    if (!q || typeof q !== 'object' || !('t' in q)) return;
    switch (q.t) {
      case 'and': case 'or': (q.items as Prop[]).forEach(walk); break;
      case 'not': walk(q.p as Prop); break;
      case 'before':
        // Only time points are deadlines; "before another event" is an ordering constraint.
        if (q.point.k === 'add' || (q.point.k === 'var' && !('k2' in q.point) && q.point.attrType === 'Date')) {
          out.push(R(eventNoun(q.event), q.strict ? ' strictly before ' : ' on or before ', pointPhrase(q.point)));
        }
        break;
      case 'within':
        if (q.interval.k === 'interval') out.push(R(eventNoun(q.event), ' ', intervalPhrase(q.interval)));
        break;
      default: break;
    }
  };
  walk(p);
  return out;
}

// ------------------------------------------------------------------ powers

export function effectPhrase(e: Prop | Effect): Rich {
  if (e.t !== 'effect') return propPhrase(e as Prop);
  const act = e.action;
  if (e.target === 'contract') {
    const w: Record<string, string> = { Terminated: 'the contract is terminated', Suspended: 'the contract is suspended', Resumed: 'the contract is resumed' };
    return [w[act] ?? `the contract is ${humanize(act)}`];
  }
  const w: Record<string, string> = {
    Suspended: 'is suspended', Resumed: 'is resumed', Discharged: 'is discharged',
    Terminated: 'is terminated', Triggered: 'is triggered',
  };
  return R(e.target === 'power' ? 'power ' : 'obligation ', norm(e.norm), ' ', w[act] ?? `is ${humanize(act)}`);
}

// ------------------------------------------------------------------ access rules

/** "Rule1: `pfizer` grants `mcdc` read access to `vaccineDose`". */
export function rulePhrase(r: RuleModel): Rich {
  const verb = r.action === 'Grant' ? 'grants' : 'revokes';
  const perm = r.permission === 'all' ? 'full' : r.permission;
  return R(code(r.name), ': ', code(r.controller), ` ${verb} `, code(r.role), ` ${perm} access `,
    r.action === 'Grant' ? 'to ' : 'on ', code(r.resource));
}

// ------------------------------------------------------------------ norm slots

export type NormSlots = {
  kind: ExplainNorm['kind'];
  name: string;
  isPower: boolean;
  survives: boolean;
  debtor: Rich; creditor: Rich;  // for powers: holder / counterparty
  debtorLong: Rich; creditorLong: Rich;  // same, with the declared type
  debtorThird: boolean; creditorThird: boolean;
  created: Rich | null;          // trigger clause, null when none (exists from contract start)
  binding: Rich[] | null;        // antecedent clauses, null when literally true
  must: Rich[];                  // consequent clauses (or the power's effect, one item)
  deadlines: Rich[];
  controller: Rich | null;
  dependsOn: string[]; feeds: string[]; acRules: RuleModel[];
  authorNote: string | null;
  line: number; col: number;
};

const looksLikeCode = (s: string) => /Happens\(|->\s*\(?(O|P|Obligation|Power)\(|:=|==/.test(s);

export function slots(n: ExplainNorm, rules: RuleModel[]): NormSlots {
  const isPower = n.kind === 'power';
  const ruleByName = new Map(rules.map((r) => [r.name, r]));
  return {
    kind: n.kind,
    name: n.name,
    isPower,
    survives: n.kind === 'survivingObligation',
    // For powers the first party is the holder (the creditor of the power).
    debtor: partyPhrase(isPower ? n.creditor : n.debtor),
    creditor: partyPhrase(isPower ? n.debtor : n.creditor),
    debtorLong: partyLong(isPower ? n.creditor : n.debtor),
    creditorLong: partyLong(isPower ? n.debtor : n.creditor),
    debtorThird: !!(isPower ? n.creditor : n.debtor).thirdParty,
    creditorThird: !!(isPower ? n.debtor : n.creditor).thirdParty,
    created: n.trigger && !isTrue(n.trigger) ? propPhrase(n.trigger) : null,
    binding: isTrue(n.antecedent) ? null : clauses(n.antecedent),
    must: isPower ? [effectPhrase(n.consequent)] : clauses(n.consequent as Prop),
    deadlines: isPower ? [] : deadlines(n.consequent),
    controller: n.controller ? partyPhrase(n.controller) : null,
    dependsOn: n.dependsOn,
    feeds: n.feeds,
    acRules: n.acRules.map((r) => ruleByName.get(r)).filter((r): r is RuleModel => !!r),
    authorNote: n.authorNote && !looksLikeCode(n.authorNote) ? n.authorNote : null,
    line: n.line,
    col: n.col,
  };
}

// ------------------------------------------------------------------ lifecycle

/** Identifiers of the variable events a proposition mentions (in order, unique). */
function eventVars(p: Prop | Effect | null | undefined): string[] {
  const out: string[] = [];
  const add = (v: string) => { if (!out.includes(v)) out.push(v); };
  const walk = (q: unknown) => {
    if (!q || typeof q !== 'object') return;
    const o = q as Record<string, unknown>;
    if (o['t'] === 'not') return; // events that must NOT occur are not steps of the normal course
    if (o['k'] === 'var' && typeof o['var'] === 'string' && 'ref' in o && !('t' in o)) add(o['var'] as string);
    for (const key of ['items', 'p', 'left', 'right', 'event', 'event2', 'point', 'interval', 'from', 'to', 'arg', 'assignments'] as const) {
      const v = o[key];
      if (Array.isArray(v)) v.forEach(walk); else if (v) walk(v);
    }
  };
  walk(p);
  return out;
}

/** Norm names a proposition mentions through obligation/power events or situations. */
function normRefs(p: Prop | Effect | null | undefined): string[] {
  const out: string[] = [];
  const walk = (q: unknown) => {
    if (!q || typeof q !== 'object') return;
    const o = q as Record<string, unknown>;
    if ((o['k'] === 'obligation' || o['k'] === 'power' || o['of'] === 'obligation' || o['of'] === 'power') && typeof o['norm'] === 'string' && !out.includes(o['norm'] as string)) out.push(o['norm'] as string);
    for (const v of Object.values(o)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
  };
  walk(p);
  return out;
}

/**
 * Normal course of the contract: the obligations in dependency order (a norm
 * that refers to another comes after it), ties broken by source order; then the
 * obligations that survive termination. Each step names the events that create
 * the obligation, make it binding, and fulfil it.
 */
export function lifecycle(norms: ExplainNorm[]): Rich[] {
  const obls = norms.filter((n) => n.kind !== 'power');
  const names = new Set(obls.map((n) => n.name));
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const n of obls) {
    indeg.set(n.name, 0);
  }
  for (const n of obls) {
    for (const d of n.dependsOn) {
      if (!names.has(d) || d === n.name) continue;
      indeg.set(n.name, (indeg.get(n.name) ?? 0) + 1);
      succ.set(d, [...(succ.get(d) ?? []), n.name]);
    }
  }
  const order: ExplainNorm[] = [];
  const remaining = [...obls];
  while (remaining.length) {
    let i = remaining.findIndex((n) => (indeg.get(n.name) ?? 0) === 0);
    if (i < 0) i = 0; // cycle: fall back to source order
    const [n] = remaining.splice(i, 1);
    order.push(n);
    for (const m of succ.get(n.name) ?? []) indeg.set(m, (indeg.get(m) ?? 1) - 1);
  }
  // Alternatives ("or" at the top of the proposition) are joined with "or".
  const conj = (p: Prop | Effect | null | undefined) => (p && p.t === 'or' ? 'or' : 'and');
  const codes = (vs: string[], c = 'and') => joinList(vs.map((v) => [code(v)]), c);
  const steps: Rich[] = [];
  for (const n of order) {
    const trig = eventVars(n.trigger);
    const ante = eventVars(n.antecedent), anteNorms = normRefs(n.antecedent);
    const cons = eventVars(n.consequent), consNorms = normRefs(n.consequent);
    const conds: Rich[] = [];
    if (ante.length) conds.push(codes(ante, conj(n.antecedent)));
    if (anteNorms.length) conds.push(R(joinList(anteNorms.map((x) => [norm(x)]), 'and'), anteNorms.length === 1 ? ' is fulfilled' : ' are fulfilled'));
    const brings: Rich[] = [];
    if (cons.length) brings.push(codes(cons, conj(n.consequent)));
    if (consNorms.length) brings.push(R(joinList(consNorms.map((x) => [norm(x)]), 'and'), consNorms.length === 1 ? ' is fulfilled' : ' are fulfilled'));
    steps.push(R(
      norm(n.name), n.kind === 'survivingObligation' ? ' (survives termination)' : '', ': ',
      partyPhrase(n.debtor), ' owes ', partyPhrase(n.creditor),
      trig.length ? R('; created by ', codes(trig, conj(n.trigger))) : (n.trigger ? '; created when its trigger holds' : '; exists from the start'),
      conds.length ? R('; binding once ', joinList(conds, 'and')) : (isTrue(n.antecedent) ? '; binding immediately' : ''),
      brings.length ? R('; requires ', joinList(brings, 'and')) : null,
      '.',
    ));
  }
  return steps;
}

// ------------------------------------------------------------------ contract overview

export type OverviewSlots = {
  summary: Rich;
  fixed: Rich[];
  preconditions: Rich[];
  postconditions: Rich[];
  constraints: Rich[];
  timeUnit: string | null;
  counts: { obligations: number; surviving: number; powers: number; rules: number };
  ends: Rich[];
  survives: Rich[];
  access: Rich | null;
  sensors: Rich[];
  observations: Rich[];
  lifecycle: Rich[];
};

export function overview(c: ExplainContract, norms: ExplainNorm[], rules: RuleModel[]): OverviewSlots {
  const signatories = c.parties.filter((p) => !p.thirdParty);
  const thirds = c.parties.filter((p) => p.thirdParty);
  const partyItem = (p: { var: string; type: string }): Rich => R(code(p.var), ` (${p.type})`);

  const summary = R(code(c.name), ' is an agreement between ',
    signatories.length ? joinList(signatories.map(partyItem), 'and') : 'its parties', '.',
    thirds.length ? R(' ', joinList(thirds.map(partyItem), 'and'),
      thirds.length === 1 ? ' takes part as a third party without being bound by it.' : ' take part as third parties without being bound by it.') : null);

  const fixed = c.parameters
    .filter((p) => p.category !== 'Role')
    .map((p) => R(code(p.name), ` (${p.type})`));

  const powers = norms.filter((n) => n.kind === 'power');
  const ends = powers
    .filter((n) => n.consequent.t === 'effect' && n.consequent.target === 'contract' && n.consequent.action === 'Terminated')
    .map((n) => R(partyPhrase(n.creditor), ' may terminate the contract',
      n.trigger && !isTrue(n.trigger) ? R(' once ', propPhrase(n.trigger)) : ' at any time', ' (', norm(n.name), ')'));

  const survives = norms.filter((n) => n.kind === 'survivingObligation')
    .map((n) => R(norm(n.name), ' (', partyPhrase(n.debtor), ' owes ', partyPhrase(n.creditor), ')'));

  const grants = rules.filter((r) => r.action === 'Grant').length;
  const revokes = rules.length - grants;
  const access = rules.length === 0 && c.acControllers.length === 0 ? null
    : R(c.acControllers.length ? R(joinList(c.acControllers.map((x) => [code(x)]), 'and'),
      c.acControllers.length === 1 ? ' administers' : ' administer', ' the access-control policy. ') : null,
      rules.length ? `${rules.length} rule${rules.length === 1 ? '' : 's'}: ${grants} grant${grants === 1 ? '' : 's'}, ${revokes} revocation${revokes === 1 ? '' : 's'}.` : 'No rules.');

  const sensors = c.sensors.map((s) => {
    const parts: Rich[] = [];
    const cond = s.init['condition'], win = s.init['window'], cnt = s.init['count'];
    if (cond && cond.t === 'lit' && String(cond.value)) parts.push([`condition ${String(cond.value)}`]);
    if (cnt && cnt.t === 'lit' && String(cnt.value)) parts.push([`${String(cnt.value)} readings`]);
    if (win && win.t === 'lit' && String(win.value)) parts.push([`within ${String(win.value)}`]);
    const perf = s.init['performer'], ctl = s.init['controller'];
    return R(code(s.var), ` (${s.type})`,
      parts.length ? R(': ', joinList(parts, 'and')) : null,
      perf && perf.t === 'var' ? R('; raised by ', code(perf.var)) : null,
      ctl && ctl.t === 'var' ? R(', controlled by ', code(ctl.var)) : null);
  });

  // Observations: derived facts a reader would want flagged (not errors).
  const observations: Rich[] = [];
  const controllers = new Set<string>();
  norms.forEach((n) => { if (n.controller) controllers.add(n.controller.var); });
  c.acControllers.forEach((x) => controllers.add(x));
  const ruleActors = new Set<string>();
  rules.forEach((r) => { ruleActors.add(r.role); ruleActors.add(r.controller); });
  const idle = c.parties.filter((p) => !p.partyToNorm && !controllers.has(p.var) && !ruleActors.has(p.var));
  if (idle.length) observations.push(R(joinList(idle.map((p) => [code(p.var)]), 'and'),
    idle.length === 1 ? ' is declared but is party to no obligation or power and appears in no access rule.'
      : ' are declared but are party to no obligation or power and appear in no access rule.'));
  const unused = [...c.events, ...c.assets, ...c.sensors, ...c.others].filter((v) => !v.referenced);
  if (unused.length) observations.push(R(joinList(unused.map((v) => [code(v.var)]), 'and'),
    unused.length === 1 ? ' is declared but never used.' : ' are declared but never used.'));
  if (c.postconditions.length === 0) observations.push(['No postconditions are specified.']);
  if (c.constraints.length === 0) observations.push(['No constraints are specified.']);

  return {
    summary,
    fixed,
    preconditions: c.preconditions.flatMap(clauses),
    postconditions: c.postconditions.flatMap(clauses),
    constraints: c.constraints.flatMap(clauses),
    timeUnit: c.timeUnit,
    counts: {
      obligations: norms.filter((n) => n.kind === 'obligation').length,
      surviving: norms.filter((n) => n.kind === 'survivingObligation').length,
      powers: powers.length,
      rules: rules.length,
    },
    ends,
    survives,
    access,
    sensors,
    observations,
    lifecycle: lifecycle(norms),
  };
}

// ------------------------------------------------------------------ glossary

/** Lay definitions of the formal notions behind the slot labels (shown as tooltips). */
export const GLOSSARY: Record<string, string> = {
  obligation: 'A duty one party (the debtor) owes to another (the creditor). It is violated if what it requires does not come about.',
  survivingObligation: 'An obligation that remains enforceable after the contract itself has ended.',
  power: 'A right held by one party to change the contract or another norm (terminate, suspend, resume, ...) by its own act.',
  trigger: 'The event or condition that brings the norm into existence. Without a trigger, the norm exists from the start of the contract.',
  antecedent: 'The condition under which the obligation becomes binding (or the power becomes exercisable). "true" means immediately.',
  consequent: 'What the debtor must bring about once the obligation is binding; for a power, the effect of exercising it.',
  violation: 'An obligation is violated when it is binding and its consequent does not come about (or a deadline passes).',
  controller: 'The party that administers access to this norm under the access-control policy.',
  deadline: 'A time point stated in the consequent before which an event must happen.',
  acRules: 'Access-control rules (Grant / Revoke) on the resources this norm reads or writes.',
  dependsOn: 'Other obligations or powers this norm refers to (for example through Fulfilled(...) or Violated(...)).',
  feeds: 'Other obligations or powers that refer to this norm.',
};
