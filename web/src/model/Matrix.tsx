import type { ContractModel, RuleModel } from './api.js';
import { saveBlobAs } from '../fileio.js';
import type { ContractDiff } from '../explain/diff.js';
import { ChangesToggle, changeKind, mapName, oldNameOf, useChangesToggle, type ViewChanges } from './changes.js';

// nowrap keeps each cell on one line so the table takes its natural width and
// the container's overflow:auto provides a horizontal scrollbar (instead of the
// text wrapping and squeezing the table to fit).
const cell: React.CSSProperties = { border: '1px solid #3a3d41', padding: '4px 8px', fontSize: 12, verticalAlign: 'top', whiteSpace: 'nowrap' };
const head: React.CSSProperties = { ...cell, background: '#2d2d30', color: '#9cdcfe', position: 'sticky', top: 0 };
const saveBtn: React.CSSProperties = {
  padding: '2px 10px', background: '#3a3d41', color: '#fff', border: '1px solid #555',
  borderRadius: 3, cursor: 'pointer', font: '12px ui-monospace, monospace',
};

// HTML-escape a value for safe inclusion in the exported document.
const esc = (s: string) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Roles (rows) x resources (columns) of the access-control policy. */
export function matrixData(model: ContractModel) {
  const rules = model.rules ?? [];
  const roles = [...new Set(rules.map((r) => r.role).filter(Boolean))];
  const resources = [...new Set(rules.map((r) => r.resource).filter(Boolean))];
  const at = (role: string, resource: string) => rules.filter((r) => r.role === role && r.resource === resource);
  return { rules, roles, resources, at };
}

/** The matrix as an HTML <table> (light-theme classes: .grant/.revoke/.role/.corner), for exports. */
export function matrixTableHtml(model: ContractModel): string {
  const { roles, resources, at } = matrixData(model);
  const headCells = resources.map((res) => `<th>${esc(res)}</th>`).join('');
  const bodyRows = roles.map((role) => {
    const cells = resources.map((res) => {
      const items = at(role, res).map((r) => {
        const grant = r.action === 'Grant';
        return `<div class="${grant ? 'grant' : 'revoke'}" title="rule ${esc(r.name)}, by ${esc(r.controller)}">`
          + `${grant ? '✓' : '✗'} ${esc(r.permission)}</div>`;
      }).join('');
      return `<td>${items}</td>`;
    }).join('');
    return `<tr><th class="role">${esc(role)}</th>${cells}</tr>`;
  }).join('\n');
  return `<table>\n<thead><tr><th class="corner">role \\ resource</th>${headCells}</tr></thead>\n<tbody>\n${bodyRows}\n</tbody>\n</table>`;
}

export function Matrix({ model, diff = null, baseline = null }: { model: ContractModel | null; diff?: ContractDiff | null; baseline?: ContractModel | null }) {
  const [showChanges, setShowChanges] = useChangesToggle('policy');
  const changes: ViewChanges | null = showChanges && diff && baseline ? { diff, baseline } : null;
  if (!model) return <Msg>Matrix appears after the model loads.</Msg>;
  const rules = model.rules ?? [];
  // Baseline rules with renamed identifiers mapped to their current names, so
  // that a renamed role or resource lands in the same row/column.
  const baseRules: RuleModel[] = changes
    ? changes.baseline.rules.map((r) => ({ ...r, name: mapName(changes, r.name), role: mapName(changes, r.role), resource: mapName(changes, r.resource), controller: mapName(changes, r.controller) }))
    : [];
  if (rules.length === 0 && baseRules.length === 0) return <Msg>No <code>ACPolicy</code> rules in this contract.</Msg>;

  // Rows = accessed roles, columns = accessed resources; in a comparison, the
  // baseline's roles and resources come after the current ones.
  const curRoles = [...new Set(rules.map((r) => r.role).filter(Boolean))];
  const curResources = [...new Set(rules.map((r) => r.resource).filter(Boolean))];
  const roles = [...curRoles, ...baseRules.map((r) => r.role).filter((x) => x && !curRoles.includes(x)).filter((x, i, a) => a.indexOf(x) === i)];
  const resources = [...curResources, ...baseRules.map((r) => r.resource).filter((x) => x && !curResources.includes(x)).filter((x, i, a) => a.indexOf(x) === i)];

  const at = (role: string, resource: string) =>
    rules.filter((r) => r.role === role && r.resource === resource);
  const baseAt = (role: string, resource: string) =>
    baseRules.filter((r) => r.role === role && r.resource === resource);
  const curNames = new Set(rules.map((r) => r.name));
  const kindOf = (name: string) => (changes ? (changeKind(changes, name) ?? 'unchanged') : undefined);
  const headKind = (name: string, cur: string[]): 'added' | 'removed' | undefined => {
    if (!changes) return undefined;
    if (!cur.includes(name)) return 'removed';
    return changeKind(changes, name) === 'added' ? 'added' : undefined;
  };
  const dimStyle: React.CSSProperties = { color: '#8a8a8a' };
  const goneStyle: React.CSSProperties = { color: '#9a9a9a', textDecoration: 'line-through' };
  const permText = (r: RuleModel) => `${r.action === 'Grant' ? '✓' : '✗'} ${r.permission}`;
  const permColor = (r: RuleModel) => (r.action === 'Grant' ? '#a6e22e' : '#f48771');
  const tag = (t: string, color: string) => (
    <span style={{ display: 'inline-block', fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', padding: '0 4px', marginRight: 5, borderRadius: 3, color, background: '#2a2a2a', verticalAlign: 'middle' }}>{t}</span>
  );
  const countChanges = diff ? diff.items.filter((it) => it.group === 'Access rules').length : 0;

  // Export the matrix as a single self-contained, styled HTML document.
  const saveHtml = () => {
    const title = `${model.contractName || 'Contract'} — Access-Control Policy`;
    const table = matrixTableHtml(model);
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1e1e1e; margin: 2rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  .meta { color: #555; margin: 0 0 1rem; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #c8c8c8; padding: 6px 10px; vertical-align: top; text-align: left; }
  thead th { background: #f0f3f7; }
  th.corner { background: #e8ecf1; }
  th.role { background: #f7f9fb; font-weight: 600; white-space: nowrap; }
  td div { white-space: nowrap; }
  .grant { color: #1a7f37; }
  .revoke { color: #b42318; }
  footer { color: #888; font-size: 12px; margin-top: 1.25rem; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="meta">Access-control matrix — roles (rows) × resources (columns).${
      model.acControllers.length > 0 ? ` Policy controller: <b>${esc(model.acControllers.join(', '))}</b>.` : ''
    }</p>
${table}
<footer>Generated by the SymboleoAC Web IDE.</footer>
</body>
</html>
`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    void saveBlobAs(`${model.contractName || 'contract'}-policy.html`, blob, { 'text/html': ['.html'] });
  };

  // Same structure as the diagram views (MermaidView): a flex-column root with a
  // fixed header and a dedicated flex:1 scroller. The scroller — not a plain
  // height:100% block — is what reliably gives the wide table a horizontal
  // scrollbar inside the resizable panel.
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 6px' }}>
        <div style={{ color: '#9cdcfe', fontSize: 11 }}>
          Access-control matrix — roles (rows) × resources (columns).
          {model.acControllers.length > 0 && <> Policy controller: <b>{model.acControllers.join(', ')}</b>.</>}
          {diff && baseline && (
            <div style={{ marginTop: 4 }}>
              <ChangesToggle on={showChanges} setOn={setShowChanges} count={countChanges} baselineName={diff.baselineName} note="a changed cell reads old → new" />
            </div>
          )}
        </div>
        <button type="button" style={{ ...saveBtn, marginLeft: 'auto' }} title="Save matrix as a formatted HTML file" onClick={saveHtml}>Save</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, width: '100%', boxSizing: 'border-box', overflow: 'auto', padding: '0 10px 10px' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={head}>role \ resource</th>
              {resources.map((res) => {
                const hk = headKind(res, curResources);
                return (
                  <th key={res} style={{ ...head, ...(hk === 'removed' ? goneStyle : {}), ...(hk === 'added' ? { color: '#fff' } : {}) }}>
                    {hk === 'added' && tag('A', '#89d185')}{hk === 'removed' && tag('D', '#f48771')}{res}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => {
              const rk = headKind(role, curRoles);
              return (
                <tr key={role}>
                  <td style={{ ...cell, color: '#d4d4d4', fontWeight: 600, ...(rk === 'removed' ? goneStyle : {}), ...(rk === 'added' ? { color: '#fff' } : {}) }}>
                    {rk === 'added' && tag('A', '#89d185')}{rk === 'removed' && tag('D', '#f48771')}{role}
                  </td>
                  {resources.map((res) => {
                    const cur = at(role, res);
                    const old = changes ? baseAt(role, res) : [];
                    const oldByName = new Map(old.map((r) => [r.name, r]));
                    const removed = old.filter((r) => !curNames.has(r.name));
                    const anyChange = cur.some((r) => kindOf(r.name) !== 'unchanged') || removed.length > 0;
                    return (
                      <td key={res} style={{ ...cell, ...(changes && anyChange ? { outline: '1px solid #d4d4d4', outlineOffset: -2 } : {}) }}>
                        {cur.map((r, i) => {
                          const k = kindOf(r.name);
                          const o = oldByName.get(r.name);
                          const title = `rule ${r.name}, by ${r.controller}${k === 'renamed' && changes ? ` (was ${oldNameOf(changes, r.name)})` : ''}`;
                          if (!changes || k === undefined) return <div key={i} title={title}><span style={{ color: permColor(r) }}>{permText(r)}</span></div>;
                          if (k === 'unchanged') return <div key={i} title={title} style={dimStyle}>{permText(r)}</div>;
                          if (k === 'added') return <div key={i} title={title}>{tag('A', '#89d185')}<span style={{ color: permColor(r), fontWeight: 600 }}>{permText(r)}</span></div>;
                          const same = o && o.action === r.action && o.permission === r.permission;
                          return (
                            <div key={i} title={title}>
                              {tag(k === 'renamed' ? 'R' : 'M', k === 'renamed' ? '#c586c0' : '#75beff')}
                              {o && !same && <><span style={goneStyle}>{permText(o)}</span><span style={{ color: '#8a8a8a' }}> → </span></>}
                              <span style={{ color: permColor(r), fontWeight: 600 }}>{permText(r)}</span>
                            </div>
                          );
                        })}
                        {removed.map((r, i) => (
                          <div key={`gone-${i}`} title={`rule ${r.name} (removed since ${changes!.diff.baselineName}), by ${r.controller}`}>
                            {tag('D', '#f48771')}<span style={goneStyle}>{permText(r)}</span>
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 12, color: '#9cdcfe' }}>{children}</div>;
}
