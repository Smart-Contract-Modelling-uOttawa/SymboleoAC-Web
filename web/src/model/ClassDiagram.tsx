import { useMemo } from 'react';
import type { ContractModel, ClassType, EnumType } from './api.js';
import { MermaidView } from './MermaidView.js';
import type { ContractDiff } from '../explain/diff.js';
import { ADDED_STROKE, ChangesToggle, DIM, GHOST, badge, changeKind, oldNameOf, removedIn, useChangesToggle, type ViewChanges } from './changes.js';

// Class names are SymboleoAC identifiers; keep them safe for mermaid just in case.
const cn = (s: string) => (s || 'X').replace(/[^A-Za-z0-9_]/g, '_');
// Member/label tokens must stay on one line and avoid mermaid's structural chars.
const tok = (s: string) => (s || '').replace(/[^A-Za-z0-9_ ]/g, '').trim() || '_';
const lbl = (s: string) => s.replace(/["\n]/g, "'");

// Pastel fill/stroke per resolved category (applies recursively via subclass category).
const PALETTE: Record<string, { fill: string; stroke: string }> = {
  Events: { fill: '#cfe2ff', stroke: '#6ea8fe' },          // blue
  Roles: { fill: '#fff3cd', stroke: '#ffda6a' },           // yellow
  Assets: { fill: '#d1e7dd', stroke: '#75b798' },          // green
  'Data Transfers': { fill: '#f7d6e6', stroke: '#e685b5' },// pink
  Enumerations: { fill: '#e2d9f3', stroke: '#a98eda' },    // purple
};
// Base ontology class name → category.
const BASE_CAT: Record<string, string> = { Role: 'Roles', Asset: 'Assets', Event: 'Events', DataTransfer: 'Data Transfers' };

/**
 * Style of one class. Without a comparison: the category palette. With one:
 * unchanged classes are dimmed, added ones get a thick white outline, changed and
 * renamed ones a thick outline in their own colour, removed ones are dashed ghosts.
 */
function styleLine(id: string, cat: string, kind?: 'added' | 'changed' | 'renamed' | 'removed' | 'unchanged' | 'dim'): string | null {
  const p = PALETTE[cat];
  if (kind === 'removed') return `style ${id} fill:${GHOST.fill},stroke:${GHOST.stroke},stroke-dasharray:${GHOST.dash},color:${GHOST.text}`;
  if (kind === 'dim' || kind === 'unchanged') return `style ${id} fill:${DIM.fill},stroke:${DIM.stroke},color:${DIM.text}`;
  if (!p) return kind ? `style ${id} stroke:${kind === 'added' ? ADDED_STROKE : '#d4d4d4'},stroke-width:3px` : null;
  if (kind === 'added') return `style ${id} fill:${p.fill},stroke:${ADDED_STROKE},stroke-width:3px,color:#1e1e1e`;
  if (kind === 'changed' || kind === 'renamed') return `style ${id} fill:${p.fill},stroke:${p.stroke},stroke-width:3px,color:#1e1e1e`;
  return `style ${id} fill:${p.fill},stroke:${p.stroke},color:#1e1e1e`;
}

/** Mermaid classDiagram definition of the domain model (shared with the documentation export). */
export function buildClassDiagramDef(model: ContractModel, direction: 'LR' | 'TB' = 'LR', changes?: ViewChanges | null): string {
  const dm = model.domainModel;
  const lines: string[] = ['classDiagram', `direction ${direction}`];
  const styles: string[] = [];
  const declaredBase = new Set<string>();
  const kindOf = (name: string) => (changes ? (changeKind(changes, name) ?? 'unchanged') : undefined);

  // A class with an optional badge label and members. With a label, members go on
  // `Id : member` lines (mermaid does not take a label and a body in one statement).
  const emitClass = (id: string, label: string | null, members: string[]) => {
    if (label) {
      lines.push(`class ${id}["${lbl(label)}"]`);
      for (const m of members) lines.push(`${id} : ${m}`);
    } else if (members.length > 0) {
      lines.push(`class ${id} {`);
      for (const m of members) lines.push(`  ${m}`);
      lines.push('}');
    } else {
      lines.push(`class ${id}`);
    }
  };
  const typeMembers = (t: ClassType) => t.attributes.filter((a) => !a.ref && a.name)
    .map((a) => `+${tok(a.type) || '_'} ${a.modifier ? `${tok(a.modifier)} ` : ''}${tok(a.name)}`);

  // Base ontology classes actually used as parents (coloured by category; dimmed in a comparison).
  const useBase = (parent: string) => {
    if (declaredBase.has(parent)) return;
    declaredBase.add(parent);
    lines.push(`class ${cn(parent)}`);
    const s = BASE_CAT[parent] ? styleLine(cn(parent), BASE_CAT[parent], changes ? 'dim' : undefined) : null;
    if (s) styles.push(s);
  };
  for (const t of dm.types) if (t.parentIsBase && t.parent) useBase(t.parent);

  // Regular types: class (with base-typed attributes as members), stereotype,
  // associations for domain-typed attributes, and the inheritance edge.
  const present = new Set<string>([...dm.types.map((t) => t.name), ...dm.enums.map((e) => e.name), ...declaredBase]);
  for (const t of dm.types) {
    const id = cn(t.name);
    const k = kindOf(t.name);
    emitClass(id, k && k !== 'unchanged' ? badge(k, t.name, changes ? oldNameOf(changes, t.name) : undefined) : null, typeMembers(t));
    if (t.thirdParty) lines.push(`<<thirdParty>> ${id}`);
    const s = styleLine(id, t.category, k);
    if (s) styles.push(s);
    for (const a of t.attributes) {
      if (a.ref && a.type && a.name) lines.push(`${id} --> ${cn(a.type)} : ${tok(a.name)}`);
    }
    if (t.parent) lines.push(`${cn(t.parent)} <|-- ${id}`);
  }

  // Enumerations: «Enumeration» classes with their items as members (purple).
  for (const e of dm.enums) {
    const id = cn(e.name);
    const k = kindOf(e.name);
    emitClass(id, k && k !== 'unchanged' ? badge(k, e.name, changes ? oldNameOf(changes, e.name) : undefined) : null, e.items.map(tok));
    lines.push(`<<Enumeration>> ${id}`);
    const s = styleLine(id, 'Enumerations', k);
    if (s) styles.push(s);
  }

  // Ghosts of the baseline's removed types and enumerations (dashed grey), with their
  // inheritance edge when the parent is still in the diagram.
  if (changes) {
    const removed = new Set(removedIn(changes, 'Domain'));
    const bdm = changes.baseline.domainModel;
    const ghosts: (ClassType | EnumType)[] = [...bdm.types.filter((t) => removed.has(t.name)), ...bdm.enums.filter((e) => removed.has(e.name))];
    for (const g of ghosts) {
      const id = cn(g.name);
      const isEnum = 'items' in g;
      emitClass(id, badge('removed', g.name), isEnum ? g.items.map(tok) : typeMembers(g));
      if (isEnum) lines.push(`<<Enumeration>> ${id}`);
      else if (g.thirdParty) lines.push(`<<thirdParty>> ${id}`);
      styles.push(styleLine(id, isEnum ? 'Enumerations' : g.category, 'removed')!);
      if (!isEnum && g.parent) {
        if (g.parentIsBase) useBase(g.parent);
        if (present.has(g.parent) || declaredBase.has(g.parent)) lines.push(`${cn(g.parent)} <|-- ${id}`);
      }
    }
  }

  return [...lines, ...styles].join('\n');
}

export function ClassDiagram({ model, diff = null, baseline = null }: { model: ContractModel | null; diff?: ContractDiff | null; baseline?: ContractModel | null }) {
  const [showChanges, setShowChanges] = useChangesToggle('domain');
  const changes: ViewChanges | null = showChanges && diff && baseline ? { diff, baseline } : null;
  const hasTypes = !!model && (model.domainModel.types.length + model.domainModel.enums.length) > 0;
  const def = useMemo(() => (model && hasTypes ? buildClassDiagramDef(model, 'LR', changes) : null), [model, hasTypes, changes]);

  if (!model) return <Msg>The domain class diagram appears after the model loads.</Msg>;
  if (!hasTypes) return <Msg>No domain types to diagram yet.</Msg>;

  const domainChanges = diff ? diff.items.filter((it) => it.group === 'Domain').length : 0;
  const legend = (
    <div style={{ color: '#9cdcfe', fontSize: 11, padding: '8px 10px 2px', lineHeight: 1.5 }}>
      Domain model as a UML class diagram — base types (Role/Asset/Event/DataTransfer), inheritance
      (<code>isA</code>/<code>isAn</code>), «Enumeration» and «thirdParty» stereotypes, and named
      associations for domain-typed attributes.
      {diff && baseline && (
        <div style={{ marginTop: 4 }}>
          <ChangesToggle on={showChanges} setOn={setShowChanges} count={domainChanges} baselineName={diff.baselineName} />
        </div>
      )}
    </div>
  );

  return <MermaidView def={def} legend={legend} saveName={`${model.contractName || 'contract'}-domain`} />;
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 12, color: '#9cdcfe' }}>{children}</div>;
}
