/**
 * Shared bits for showing a comparison (issue #15) in the Domain, Rules and
 * Policy views. The views already spend colour on categories, Grant/Revoke and
 * obligation/power, so changes are shown on other channels: unchanged elements
 * are dimmed to greys, added elements get a thick white outline, removed
 * elements are drawn as dashed grey ghosts from the baseline, and every changed
 * element carries a text badge (+, ~, −, old → new) in its label. All of it is
 * behind a "Changes" toggle, off by default.
 */
import { useState } from 'react';
import type { ChangeKind, ContractDiff } from '../explain/diff.js';
import type { ContractModel } from './api.js';

export type ViewChanges = { diff: ContractDiff; baseline: ContractModel };

export const DIM = { fill: '#2a2a2a', stroke: '#555555', text: '#8a8a8a' };
export const GHOST = { fill: '#2a2a2a', stroke: '#9a9a9a', text: '#9a9a9a', dash: '6 4' };
export const ADDED_STROKE = '#ffffff';

export const changeKind = (vc: ViewChanges | null | undefined, name: string): ChangeKind | undefined => vc?.diff.marks.get(name);

/** Baseline name of a renamed element (undefined when not renamed). */
export function oldNameOf(vc: ViewChanges, name: string): string | undefined {
  for (const [o, n] of vc.diff.renames) if (n === name) return o;
  return undefined;
}

/** Current name of a baseline identifier (itself when not renamed). */
export const mapName = (vc: ViewChanges, name: string): string => {
  const [root, ...rest] = name.split('.');
  const nr = vc.diff.renames.get(root);
  return nr ? [nr, ...rest].join('.') : name;
};

/** Label with the change badge: "＋ x" added, "~ x" changed, "old → new" renamed, "− x" removed. */
export function badge(kind: ChangeKind | 'removed' | undefined, name: string, oldName?: string): string {
  switch (kind) {
    case 'added': return `＋ ${name}`;   // full-width plus: a plain "+ " would start a markdown list in mermaid labels
    case 'changed': return `~ ${name}`;
    case 'renamed': return oldName ? `${oldName} → ${name}` : `~ ${name}`;
    case 'removed': return `− ${name}`;
    default: return name;
  }
}

export const removedIn = (vc: ViewChanges, ...sections: string[]): string[] =>
  vc.diff.removed.filter((r) => sections.includes(r.section)).map((r) => r.name);

/** Persisted per-view toggle. */
export function useChangesToggle(viewKey: string): [boolean, (v: boolean) => void] {
  const key = `symboleoac.showChanges.${viewKey}`;
  const [on, setOn] = useState<boolean>(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  return [on, (v) => { setOn(v); try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ } }];
}

/** "Changes" toggle button plus, when on, the one-line legend of the change encoding. */
export function ChangesToggle({ on, setOn, count, baselineName, note }: {
  on: boolean; setOn: (v: boolean) => void; count: number; baselineName: string; note?: string;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={() => setOn(!on)}
        aria-pressed={on}
        title={`Show what changed since ${baselineName}: unchanged elements dimmed, added ones outlined in white, removed ones as dashed ghosts, badges + ~ − in labels`}
        style={{
          padding: '1px 8px', background: on ? '#0e639c' : '#3a3d41', color: '#fff', border: '1px solid #555',
          borderRadius: 3, cursor: 'pointer', font: '11px ui-monospace, monospace',
        }}
      >
        Changes{count ? ` (${count})` : ''}
      </button>
      {on && (
        <span style={{ color: '#9a9a9a', fontSize: 11 }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>{'＋'} thick white outline</span> = added ·{' '}
          <span style={{ color: '#d4d4d4' }}>~ badge</span> = changed ·{' '}
          <span style={{ textDecoration: 'line-through' }}>− dashed grey</span> = removed ·{' '}
          <span style={{ color: '#d4d4d4' }}>old → new</span> = renamed · dimmed = unchanged{note ? ` · ${note}` : ''}
        </span>
      )}
    </span>
  );
}
