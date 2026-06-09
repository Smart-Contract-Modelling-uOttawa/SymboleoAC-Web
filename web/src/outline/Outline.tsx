import { useState } from 'react';
import type * as monaco from '@codingame/monaco-vscode-editor-api';
import type { ContractModel, Named } from '../model/api.js';

type Props = {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  model: ContractModel | null;
};

type SectionKind = 'categories' | 'list' | 'link';
type Section = {
  key: string;
  label: string;
  kind: SectionKind;
  get?: (m: ContractModel) => Named[];
  cats?: (m: ContractModel) => Record<string, Named[]>;
};

// Top-level order is fixed (mirrors the DSL structure), NOT alphabetical.
const SECTIONS: Section[] = [
  { key: 'Domain', label: 'Domain', kind: 'categories', cats: (m) => m.domainCategories },
  { key: 'Contract', label: 'Contract', kind: 'link' },
  { key: 'Declarations', label: 'Declarations', kind: 'categories', cats: (m) => m.variableCategories },
  { key: 'Preconditions', label: 'Preconditions', kind: 'link' },
  { key: 'Postconditions', label: 'Postconditions', kind: 'link' },
  { key: 'Obligations', label: 'Obligations', kind: 'list', get: (m) => m.obligations },
  { key: 'Surviving', label: 'Surviving Obligations', kind: 'list', get: (m) => m.survivingObligations },
  { key: 'Powers', label: 'Powers', kind: 'list', get: (m) => m.powers },
  { key: 'ACPolicy', label: 'ACPolicy', kind: 'list', get: (m) => m.rules },
  { key: 'Constraints', label: 'Constraints', kind: 'link' },
];

const DEFAULT_EXPANDED = new Set(['Obligations', 'Surviving', 'Powers', 'ACPolicy']);
const COLLAPSIBLE = ['Domain', 'Declarations', 'Obligations', 'Surviving', 'Powers', 'ACPolicy'];
const CAT_ORDER = ['Roles', 'Assets', 'Enumerations', 'Events', 'Data Transfers', 'Resources', 'Contracts', 'Aliases', 'Other'];

const byName = (items: Named[]) => items.slice().sort((a, b) => a.name.localeCompare(b.name));

const rowBtn: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none',
  background: 'transparent', cursor: 'pointer', font: '12px/1.7 ui-monospace, monospace',
  padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

export function Outline({ editor, model }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(COLLAPSIBLE.filter((k) => !DEFAULT_EXPANDED.has(k))),
  );
  const [catCollapsed, setCatCollapsed] = useState<Set<string>>(new Set());

  const nav = (line?: number, col?: number) => {
    if (!editor || !line) return;
    const ln = line, cn = col ?? 1;
    editor.revealRangeInCenterIfOutsideViewport({ startLineNumber: ln, startColumn: cn, endLineNumber: ln, endColumn: cn });
    editor.setPosition({ lineNumber: ln, column: cn });
    editor.focus();
  };
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setter(n);
  };

  if (!model) {
    return <Shell><div style={{ padding: 8, color: '#808080', fontSize: 12 }}>Outline will appear here.</div></Shell>;
  }

  const present = SECTIONS.filter((s) => model.keywords[s.key]);

  return (
    <Shell>
      {present.length === 0 && <div style={{ padding: 8, color: '#808080', fontSize: 12 }}>No sections yet.</div>}
      {present.map((s) => {
        const kw = model.keywords[s.key];
        const isCollapsed = collapsed.has(s.key);
        const caret = s.kind === 'link' ? '' : (isCollapsed ? '▸ ' : '▾ ');
        return (
          <div key={s.key}>
            <button
              type="button"
              style={{ ...rowBtn, color: '#9cdcfe', fontWeight: 600 }}
              onClick={() => (s.kind === 'link' ? nav(kw.line, kw.col) : toggle(collapsed, setCollapsed, s.key))}
              title={s.kind === 'link' ? 'Go to section' : 'Expand / collapse'}
            >
              {caret}{s.label}
            </button>

            {s.kind === 'categories' && !isCollapsed && s.cats && (
              <CategoryBody cats={s.cats(model)} keyPrefix={s.key} nav={nav}
                catCollapsed={catCollapsed} onToggleCat={(c) => toggle(catCollapsed, setCatCollapsed, c)} />
            )}
            {s.kind === 'list' && !isCollapsed && s.get && (
              <NameList items={byName(s.get(model))} nav={nav} />
            )}
          </div>
        );
      })}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#252526', padding: '6px 2px' }}>
      <div style={{ padding: '2px 8px 6px', color: '#9cdcfe', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Outline
      </div>
      {children}
    </div>
  );
}

function CategoryBody({ cats, keyPrefix, nav, catCollapsed, onToggleCat }: {
  cats: Record<string, Named[]>;
  keyPrefix: string;
  nav: (l?: number, c?: number) => void;
  catCollapsed: Set<string>;
  onToggleCat: (c: string) => void;
}) {
  const present = Object.entries(cats).filter(([, items]) => items.length > 0);
  const ordered = present.sort(([a], [b]) => {
    const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  if (ordered.length === 0) return null;
  return (
    <div style={{ paddingLeft: 12 }}>
      {ordered.map(([cat, items]) => {
        const ckey = `${keyPrefix}:${cat}`;
        const isCollapsed = catCollapsed.has(ckey);
        return (
          <div key={cat}>
            <button type="button" onClick={() => onToggleCat(ckey)}
              style={{ ...rowBtn, color: '#c586c0', fontSize: 11 }} title="Expand / collapse">
              {isCollapsed ? '▸ ' : '▾ '}{cat}
            </button>
            {!isCollapsed && <NameList items={byName(items)} nav={nav} indent={12} />}
          </div>
        );
      })}
    </div>
  );
}

function NameList({ items, nav, indent = 0 }: { items: Named[]; nav: (l?: number, c?: number) => void; indent?: number }) {
  return (
    <div style={{ paddingLeft: 12 + indent }}>
      {items.map((it, i) => (
        <button key={`${it.name}-${i}`} type="button" style={{ ...rowBtn, color: '#d4d4d4' }}
                onClick={() => nav(it.line, it.col)} title={it.name}>
          {it.name || '(unnamed)'}
        </button>
      ))}
    </div>
  );
}
