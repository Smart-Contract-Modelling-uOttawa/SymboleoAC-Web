/**
 * Shape of the `explain` block emitted by the codegen CLI's `--model` mode
 * (codegen-cli/.../ExplainJson.java). Wording is produced in the browser from
 * this structure; nothing here is text meant for display except `authorNote`
 * (the specifier's own comment) and identifiers.
 */

export type NormKind = 'obligation' | 'survivingObligation' | 'power';

/** A resolved variable reference such as `delivered.reqID`. */
export type VarRef = {
  t: 'var';
  ref: string;          // source text, e.g. "delivered.reqID"
  var: string;          // root variable, e.g. "delivered"
  attrs: string[];      // attribute chain, e.g. ["reqID"]
  type?: string;        // declared type of the root variable
  category?: string;    // Role | Event | Asset | DataTransfer | Parameter | ...
  attrType?: string;    // base/domain type of the last attribute
  env?: boolean;        // last attribute is an Env attribute
  unresolved?: boolean;
  k?: string;           // when used as a Point: "var"
};

export type Lit = { t: 'lit'; kind: 'bool' | 'number' | 'string' | 'date'; value: unknown };
export type EnumLit = { t: 'enum'; enum: string; item: string };
export type Unresolved = { t: 'unresolved'; text: string };

export type Expr =
  | VarRef | Lit | EnumLit | Unresolved
  | { t: 'and' | 'or'; items: Expr[] }
  | { t: 'not'; p: Expr }
  | { t: 'cmp'; op: string; left: Expr; right: Expr }
  | { t: 'arith'; op: string; left: Expr; right: Expr }
  | { t: 'fn'; name: string; args: Expr[]; unit?: string };

export type Party = {
  ref: string; var: string; type?: string; category?: string;
  thirdParty?: boolean; fromParam?: string | null; unresolved?: boolean;
};

export type EventRef =
  | { k: 'var'; ref: string; var: string; type?: string; category?: string;
      performer?: VarRef; controller?: VarRef; unresolved?: boolean; dataTransferName?: string }
  | { k: 'obligation'; state: string; norm: string; normKind: NormKind }
  | { k: 'power'; state: string; norm: string; normKind: NormKind }
  | { k: 'contract'; state: string }
  | { k: 'unresolved'; text: string };

export type PointRef =
  | (VarRef & { k: 'var' })
  | { k: 'add'; arg: PointRef; value: number | VarRef; unit: string }
  | (EventRef & { k2: 'event' })
  | { k: 'unresolved'; text: string };

export type SituationRef = {
  state: string;
  of: 'obligation' | 'power' | 'contract';
  norm?: string; normKind?: NormKind; k?: string;
};

export type IntervalRef =
  | { k: 'interval'; from: PointRef; to: PointRef }
  | (SituationRef & { k: 'situation' })
  | { k: 'unresolved'; text: string };

export type Assignment = { target: VarRef; expr: Expr };

export type Prop =
  | VarRef | Lit | EnumLit | Unresolved
  | { t: 'and' | 'or'; items: Prop[] }
  | { t: 'not'; p: Prop }
  | { t: 'cmp'; op: string; left: Prop; right: Prop }
  | { t: 'arith'; op: string; left: Prop; right: Prop }
  | { t: 'fn'; name: string; args: string[] }
  | { t: 'happens'; event: EventRef }
  | { t: 'before'; strict: boolean; event: EventRef; point: PointRef }
  | { t: 'beforeEvent'; strict: boolean; event: EventRef; event2: EventRef }
  | { t: 'after'; event: EventRef; point: PointRef }
  | { t: 'within'; event: EventRef; interval: IntervalRef }
  | { t: 'occurs'; situation: SituationRef; interval: IntervalRef }
  | { t: 'happensAssign'; event: EventRef; assignments: Assignment[] }
  | { t: 'assign'; assignments: Assignment[] };

/** Consequent of a power. */
export type Effect =
  | { t: 'effect'; action: string; target: 'contract' }
  | { t: 'effect'; action: string; target: 'obligation' | 'power'; norm: string }
  | Unresolved;

export type ExplainNorm = {
  kind: NormKind;
  name: string;
  line: number;
  col: number;
  authorNote: string | null;
  debtor: Party;
  creditor: Party;
  controller: Party | null;
  trigger: Prop | null;
  antecedent: Prop;
  consequent: Prop | Effect;
  dependsOn: string[];
  feeds: string[];
  touches: string[];
  acRules: string[];
};

export type DeclaredVar = {
  var: string; line: number; col: number; type: string; category: string;
  init: Record<string, Expr>;
  referenced: boolean;
  // roles only
  thirdParty?: boolean; fromParam?: string | null; partyToNorm?: boolean;
};

export type ExplainContract = {
  name: string;
  domainName: string;
  timeUnit: string | null;
  parameters: { name: string; type: string; category: string }[];
  parties: DeclaredVar[];
  events: DeclaredVar[];
  assets: DeclaredVar[];
  sensors: DeclaredVar[];
  others: DeclaredVar[];
  preconditions: Prop[];
  postconditions: Prop[];
  constraints: Prop[];
  acControllers: string[];
};

export type ExplainModel = {
  norms: ExplainNorm[];
  contract: ExplainContract;
  error?: string;
};
