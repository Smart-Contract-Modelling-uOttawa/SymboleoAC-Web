import { useCallback, useMemo } from 'react';
import type { ContractModel } from './api.js';
import { MermaidView } from './MermaidView.js';

const sanitize = (s: string) => (s || 'x').replace(/[^A-Za-z0-9_]/g, '_');
const esc = (s: string) => s.replace(/"/g, "'");

type Built = { def: string; ruleTips: { nodeId: string; tip: string }[] };

function buildDefinition(model: ContractModel): Built {
  const lines: string[] = ['graph LR'];
  const styleLines: string[] = [];
  const parties = new Map<string, string>();
  const ruleNodeIds: string[] = [];
  const ruleTips: { nodeId: string; tip: string }[] = [];
  let linkIndex = 0;

  const party = (name: string): string | null => {
    if (!name) return null;
    if (!parties.has(name)) {
      const id = 'p_' + sanitize(name);
      parties.set(name, id);
      lines.push(`  ${id}["${esc(name)}"]`);
    }
    return parties.get(name)!;
  };
  const edge = (from: string, to: string, label: string, kind: 'obl' | 'power' | 'grant' | 'revoke') => {
    const arrow = kind === 'power' ? '-.->' : '-->';
    const lbl = label ? `|"${esc(label)}"|` : '';
    lines.push(`  ${from} ${arrow}${lbl} ${to}`);
    const idx = linkIndex++;
    if (kind === 'grant') styleLines.push(`linkStyle ${idx} stroke:#3fb950,stroke-width:2px;`);
    else if (kind === 'revoke') styleLines.push(`linkStyle ${idx} stroke:#f85149,stroke-width:2px;`);
  };

  for (const o of model.obligations) { const a = party(o.debtor ?? ''); const b = party(o.creditor ?? ''); if (a && b) edge(a, b, o.name, 'obl'); }
  for (const o of model.survivingObligations) { const a = party(o.debtor ?? ''); const b = party(o.creditor ?? ''); if (a && b) edge(a, b, o.name, 'obl'); }
  for (const p of model.powers) { const a = party(p.creditor ?? ''); const b = party(p.debtor ?? ''); if (a && b) edge(a, b, p.name, 'power'); }

  for (const r of model.rules) {
    const role = party(r.role ?? '');
    if (!role) continue;
    const rid = 'r_' + sanitize(r.name || ('rule' + ruleNodeIds.length));
    lines.push(`  ${rid}(("${esc(r.name || 'rule')}"))`);
    ruleNodeIds.push(rid);
    ruleTips.push({ nodeId: rid, tip: `On ${r.resource || '?'} · by ${r.controller || '?'}` });
    edge(rid, role, r.permission || '', r.action === 'Revoke' ? 'revoke' : 'grant');
  }

  lines.push('  classDef party fill:#0e639c,stroke:#9cdcfe,color:#fff;');
  lines.push('  classDef rule fill:#caa700,stroke:#ffd33d,color:#000;');
  if (parties.size > 0) lines.push(`  class ${[...parties.values()].join(',')} party;`);
  if (ruleNodeIds.length > 0) lines.push(`  class ${ruleNodeIds.join(',')} rule;`);
  lines.push(...styleLines);
  return { def: lines.join('\n'), ruleTips };
}

export function Diagram({ model }: { model: ContractModel | null }) {
  const hasContent = !!model
    && (model.obligations.length + model.survivingObligations.length + model.powers.length + model.rules.length) > 0;
  const built = useMemo(() => (model && hasContent ? buildDefinition(model) : null), [model, hasContent]);

  const onRendered = useCallback((el: HTMLElement) => {
    if (!built) return;
    for (const { nodeId, tip } of built.ruleTips) {
      const g = el.querySelector(`g[id^="flowchart-${nodeId}-"]`) ?? el.querySelector(`#${nodeId}`);
      if (g && !g.querySelector('title')) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = tip;
        g.appendChild(t);
      }
    }
  }, [built]);

  if (!model) return <Msg>Diagram appears after the model loads.</Msg>;
  if (!hasContent) return <Msg>No obligations, powers, or rules to diagram yet.</Msg>;

  const legend = (
    <div style={{ color: '#9cdcfe', fontSize: 11, padding: '8px 10px 2px', lineHeight: 1.5 }}>
      Parties (blue) with obligations (solid) / powers (dashed), debtor → creditor.
      Rules (yellow) point to their <i>To</i> role — <span style={{ color: '#3fb950' }}>green = Grant</span>,
      <span style={{ color: '#f85149' }}> red = Revoke</span>, labelled with the permission; hover a rule for the <i>On</i>/<i>by</i> details.
    </div>
  );

  return <MermaidView def={built?.def ?? null} onRendered={onRendered} legend={legend} />;
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 12, color: '#9cdcfe' }}>{children}</div>;
}
