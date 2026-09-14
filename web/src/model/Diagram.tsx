import { useCallback, useMemo } from 'react';
import type { ContractModel, Norm, RuleModel } from './api.js';
import { MermaidView } from './MermaidView.js';
import type { ContractDiff } from '../explain/diff.js';
import { ADDED_STROKE, ChangesToggle, DIM, GHOST, badge, changeKind, mapName, oldNameOf, removedIn, useChangesToggle, type ViewChanges } from './changes.js';

const sanitize = (s: string) => (s || 'x').replace(/[^A-Za-z0-9_]/g, '_');
const esc = (s: string) => s.replace(/"/g, "'");

export type Built = { def: string; ruleTips: { nodeId: string; tip: string }[] };

type EdgeKind = 'obl' | 'power' | 'grant' | 'revoke';
type EdgeChange = 'added' | 'changed' | 'renamed' | 'removed' | 'unchanged' | undefined;

/** Mermaid flowchart of parties, norms and rules (shared with the documentation export). */
export function buildRulesDiagramDef(model: ContractModel, direction: 'LR' | 'TB' = 'LR', changes?: ViewChanges | null): Built {
  const lines: string[] = [`graph ${direction}`];
  const styleLines: string[] = [];
  const parties = new Map<string, string>();
  const livePartyIds = new Set<string>();      // parties touched by a non-unchanged edge (kept bright)
  const ruleNodeIds: string[] = [];
  const dimRuleIds: string[] = [];
  const ghostIds: string[] = [];
  const ruleTips: { nodeId: string; tip: string }[] = [];
  let linkIndex = 0;

  const party = (name: string): string | null => {
    if (!name) return null;
    if (!parties.has(name)) {
      const id = 'p_' + sanitize(name);
      parties.set(name, id);
      const k = changes ? changeKind(changes, name) : undefined;
      const label = k && k !== 'unchanged' ? badge(k, name, changes ? oldNameOf(changes, name) : undefined) : name;
      lines.push(`  ${id}["${esc(label)}"]`);
      if (k && k !== 'unchanged') livePartyIds.add(id);
    }
    return parties.get(name)!;
  };
  const edge = (from: string, to: string, label: string, kind: EdgeKind, change: EdgeChange) => {
    const arrow = kind === 'power' ? '-.->' : '-->';
    const lbl = label ? `|"${esc(label)}"|` : '';
    lines.push(`  ${from} ${arrow}${lbl} ${to}`);
    const idx = linkIndex++;
    const base = kind === 'grant' ? 'stroke:#3fb950' : kind === 'revoke' ? 'stroke:#f85149' : null;
    if (!changes) {
      if (base) styleLines.push(`linkStyle ${idx} ${base},stroke-width:2px;`);
      return;
    }
    if (change === 'removed') styleLines.push(`linkStyle ${idx} stroke:${GHOST.stroke},stroke-width:2px,stroke-dasharray:${GHOST.dash},opacity:0.85;`);
    else if (change === 'added') styleLines.push(`linkStyle ${idx} ${base ?? 'stroke:' + ADDED_STROKE},stroke-width:4px;`);
    else if (change === 'changed' || change === 'renamed') styleLines.push(`linkStyle ${idx} ${base ?? 'stroke:#d4d4d4'},stroke-width:3px;`);
    else styleLines.push(`linkStyle ${idx} stroke:${DIM.stroke},stroke-width:1.5px,opacity:0.6;`);
    if (change && change !== 'unchanged') { livePartyIds.add(from); livePartyIds.add(to); }
  };
  const normChange = (name: string): EdgeChange => (changes ? (changeKind(changes, name) ?? 'unchanged') : undefined);
  const normLabel = (name: string, c: EdgeChange) => (c && c !== 'unchanged' ? badge(c, name, changes ? oldNameOf(changes, name) : undefined) : name);

  for (const o of model.obligations) { const a = party(o.debtor ?? ''); const b = party(o.creditor ?? ''); const c = normChange(o.name); if (a && b) edge(a, b, normLabel(o.name, c), 'obl', c); }
  for (const o of model.survivingObligations) { const a = party(o.debtor ?? ''); const b = party(o.creditor ?? ''); const c = normChange(o.name); if (a && b) edge(a, b, normLabel(o.name, c), 'obl', c); }
  for (const p of model.powers) { const a = party(p.creditor ?? ''); const b = party(p.debtor ?? ''); const c = normChange(p.name); if (a && b) edge(a, b, normLabel(p.name, c), 'power', c); }

  const baseRules = changes ? new Map(changes.baseline.rules.map((r) => [mapName(changes, r.name), r])) : null;
  for (const r of model.rules) {
    const role = party(r.role ?? '');
    if (!role) continue;
    const rid = 'r_' + sanitize(r.name || ('rule' + ruleNodeIds.length));
    const c = changes ? (changeKind(changes, r.name) ?? 'unchanged') : undefined;
    lines.push(`  ${rid}(("${esc(c && c !== 'unchanged' ? badge(c, r.name || 'rule', oldNameOf(changes!, r.name)) : (r.name || 'rule'))}"))`);
    (changes && c === 'unchanged' ? dimRuleIds : ruleNodeIds).push(rid);
    ruleTips.push({ nodeId: rid, tip: `On ${r.resource || '?'} · by ${r.controller || '?'}` });
    // A changed permission reads "read → write" on the edge.
    const old = baseRules?.get(r.name);
    const permLabel = old && c === 'changed' && old.permission !== r.permission ? `${old.permission} → ${r.permission}` : (r.permission || '');
    edge(rid, role, permLabel, r.action === 'Revoke' ? 'revoke' : 'grant', c);
  }

  // Ghosts of what the baseline had and the current text no longer has: norms as
  // dashed grey edges, rules as dashed grey nodes (parties resolved through renames).
  if (changes) {
    const b = changes.baseline;
    const gone = new Set(removedIn(changes, 'Obligations', 'Surviving', 'Powers'));
    const ghostNorm = (n: Norm, kind: 'obl' | 'power') => {
      if (!gone.has(n.name)) return;
      const from = party(mapName(changes, (kind === 'power' ? n.creditor : n.debtor) ?? ''));
      const to = party(mapName(changes, (kind === 'power' ? n.debtor : n.creditor) ?? ''));
      if (from && to) edge(from, to, badge('removed', n.name), kind, 'removed');
    };
    b.obligations.forEach((n) => ghostNorm(n, 'obl'));
    b.survivingObligations.forEach((n) => ghostNorm(n, 'obl'));
    b.powers.forEach((n) => ghostNorm(n, 'power'));
    const goneRules = new Set(removedIn(changes, 'ACPolicy'));
    for (const r of b.rules as RuleModel[]) {
      if (!goneRules.has(r.name)) continue;
      const role = party(mapName(changes, r.role ?? ''));
      if (!role) continue;
      const rid = 'g_' + sanitize(r.name);
      lines.push(`  ${rid}(("${esc(badge('removed', r.name))}"))`);
      ghostIds.push(rid);
      ruleTips.push({ nodeId: rid, tip: `Removed since ${changes.diff.baselineName}: ${r.action} ${r.permission} on ${r.resource || '?'} by ${r.controller || '?'}` });
      edge(rid, role, r.permission || '', r.action === 'Revoke' ? 'revoke' : 'grant', 'removed');
    }
  }

  lines.push('  classDef party fill:#0e639c,stroke:#9cdcfe,color:#fff;');
  lines.push('  classDef rule fill:#caa700,stroke:#ffd33d,color:#000;');
  if (changes) {
    lines.push(`  classDef dimParty fill:${DIM.fill},stroke:${DIM.stroke},color:${DIM.text};`);
    lines.push(`  classDef dimRule fill:${DIM.fill},stroke:${DIM.stroke},color:${DIM.text};`);
    lines.push(`  classDef ghost fill:${GHOST.fill},stroke:${GHOST.stroke},stroke-dasharray:${GHOST.dash},color:${GHOST.text};`);
    lines.push(`  classDef addedParty fill:#0e639c,stroke:${ADDED_STROKE},stroke-width:3px,color:#fff;`);
    lines.push(`  classDef addedRule fill:#caa700,stroke:${ADDED_STROKE},stroke-width:3px,color:#000;`);
    const live = [...parties.entries()].filter(([, id]) => livePartyIds.has(id));
    const dim = [...parties.values()].filter((id) => !livePartyIds.has(id));
    const addedParties = live.filter(([name]) => changeKind(changes, name) === 'added').map(([, id]) => id);
    const plainParties = live.filter(([name]) => changeKind(changes, name) !== 'added').map(([, id]) => id);
    if (plainParties.length) lines.push(`  class ${plainParties.join(',')} party;`);
    if (addedParties.length) lines.push(`  class ${addedParties.join(',')} addedParty;`);
    if (dim.length) lines.push(`  class ${dim.join(',')} dimParty;`);
    const addedRules = model.rules.filter((r) => changeKind(changes, r.name) === 'added').map((r) => 'r_' + sanitize(r.name));
    const plainRules = ruleNodeIds.filter((id) => !addedRules.includes(id));
    if (plainRules.length) lines.push(`  class ${plainRules.join(',')} rule;`);
    if (addedRules.length) lines.push(`  class ${addedRules.join(',')} addedRule;`);
    if (dimRuleIds.length) lines.push(`  class ${dimRuleIds.join(',')} dimRule;`);
    if (ghostIds.length) lines.push(`  class ${ghostIds.join(',')} ghost;`);
  } else {
    if (parties.size > 0) lines.push(`  class ${[...parties.values()].join(',')} party;`);
    if (ruleNodeIds.length > 0) lines.push(`  class ${ruleNodeIds.join(',')} rule;`);
  }
  lines.push(...styleLines);
  return { def: lines.join('\n'), ruleTips };
}

export function Diagram({ model, diff = null, baseline = null }: { model: ContractModel | null; diff?: ContractDiff | null; baseline?: ContractModel | null }) {
  const [showChanges, setShowChanges] = useChangesToggle('rules');
  const changes: ViewChanges | null = showChanges && diff && baseline ? { diff, baseline } : null;
  const hasContent = !!model
    && (model.obligations.length + model.survivingObligations.length + model.powers.length + model.rules.length) > 0;
  const built = useMemo(() => (model && hasContent ? buildRulesDiagramDef(model, 'LR', changes) : null), [model, hasContent, changes]);

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

  const count = diff ? diff.norms.filter((n) => n.change !== 'unchanged').length + diff.items.filter((it) => it.group === 'Access rules').length : 0;
  const legend = (
    <div style={{ color: '#9cdcfe', fontSize: 11, padding: '8px 10px 2px', lineHeight: 1.5 }}>
      Parties (blue) with obligations (solid) / powers (dashed), debtor → creditor.
      Rules (yellow) point to their <i>To</i> role — <span style={{ color: '#3fb950' }}>green = Grant</span>,
      <span style={{ color: '#f85149' }}> red = Revoke</span>, labelled with the permission; hover a rule for the <i>On</i>/<i>by</i> details.
      {diff && baseline && (
        <div style={{ marginTop: 4 }}>
          <ChangesToggle on={showChanges} setOn={setShowChanges} count={count} baselineName={diff.baselineName} note="a changed permission reads old → new on its edge" />
        </div>
      )}
    </div>
  );

  return <MermaidView def={built?.def ?? null} onRendered={onRendered} legend={legend}
    saveName={`${model.contractName || 'contract'}-rules`} />;
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 12, color: '#9cdcfe' }}>{children}</div>;
}
