import { useMemo } from 'react';
import type { ContractModel } from './api.js';
import { MermaidView } from './MermaidView.js';

// Class names are SymboleoAC identifiers; keep them safe for mermaid just in case.
const cn = (s: string) => (s || 'X').replace(/[^A-Za-z0-9_]/g, '_');
// Member/label tokens must stay on one line and avoid mermaid's structural chars.
const tok = (s: string) => (s || '').replace(/[^A-Za-z0-9_ ]/g, '').trim() || '_';

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
const styleLine = (id: string, cat: string) => {
  const p = PALETTE[cat];
  return p ? `style ${id} fill:${p.fill},stroke:${p.stroke},color:#1e1e1e` : null;
};

function buildDefinition(model: ContractModel): string {
  const dm = model.domainModel;
  const lines: string[] = ['classDiagram', 'direction LR'];
  const styles: string[] = [];
  const declaredBase = new Set<string>();

  // Base ontology classes actually used as parents (coloured by category).
  for (const t of dm.types) {
    if (t.parentIsBase && t.parent && !declaredBase.has(t.parent)) {
      declaredBase.add(t.parent);
      lines.push(`class ${cn(t.parent)}`);
      const s = BASE_CAT[t.parent] ? styleLine(cn(t.parent), BASE_CAT[t.parent]) : null;
      if (s) styles.push(s);
    }
  }

  // Regular types: class (with base-typed attributes as members), stereotype,
  // associations for domain-typed attributes, and the inheritance edge.
  for (const t of dm.types) {
    const id = cn(t.name);
    const fields = t.attributes.filter((a) => !a.ref && a.name);
    if (fields.length > 0) {
      lines.push(`class ${id} {`);
      for (const a of fields) {
        const mod = a.modifier ? `${tok(a.modifier)} ` : '';
        lines.push(`  +${tok(a.type) || '_'} ${mod}${tok(a.name)}`);
      }
      lines.push('}');
    } else {
      lines.push(`class ${id}`);
    }
    if (t.thirdParty) lines.push(`<<thirdParty>> ${id}`);
    const s = styleLine(id, t.category);
    if (s) styles.push(s);
    for (const a of t.attributes) {
      if (a.ref && a.type && a.name) lines.push(`${id} --> ${cn(a.type)} : ${tok(a.name)}`);
    }
    if (t.parent) lines.push(`${cn(t.parent)} <|-- ${id}`);
  }

  // Enumerations: «Enumeration» classes with their items as members (purple).
  for (const e of dm.enums) {
    const id = cn(e.name);
    if (e.items.length > 0) {
      lines.push(`class ${id} {`);
      for (const it of e.items) lines.push(`  ${tok(it)}`);
      lines.push('}');
    } else {
      lines.push(`class ${id}`);
    }
    lines.push(`<<Enumeration>> ${id}`);
    const s = styleLine(id, 'Enumerations');
    if (s) styles.push(s);
  }

  return [...lines, ...styles].join('\n');
}

export function ClassDiagram({ model }: { model: ContractModel | null }) {
  const hasTypes = !!model && (model.domainModel.types.length + model.domainModel.enums.length) > 0;
  const def = useMemo(() => (model && hasTypes ? buildDefinition(model) : null), [model, hasTypes]);

  if (!model) return <Msg>The domain class diagram appears after the model loads.</Msg>;
  if (!hasTypes) return <Msg>No domain types to diagram yet.</Msg>;

  const legend = (
    <div style={{ color: '#9cdcfe', fontSize: 11, padding: '8px 10px 2px', lineHeight: 1.5 }}>
      Domain model as a UML class diagram — base types (Role/Asset/Event/DataTransfer), inheritance
      (<code>isA</code>/<code>isAn</code>), «Enumeration» and «thirdParty» stereotypes, and named
      associations for domain-typed attributes.
    </div>
  );

  return <MermaidView def={def} legend={legend} saveName={`${model.contractName || 'contract'}-domain`} />;
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 12, color: '#9cdcfe' }}>{children}</div>;
}
