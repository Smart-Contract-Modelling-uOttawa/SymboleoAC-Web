import type { ContractModel } from './api.js';
import { saveBlobAs } from '../fileio.js';

const cell: React.CSSProperties = { border: '1px solid #3a3d41', padding: '4px 8px', fontSize: 12, verticalAlign: 'top' };
const head: React.CSSProperties = { ...cell, background: '#2d2d30', color: '#9cdcfe', position: 'sticky', top: 0 };
const saveBtn: React.CSSProperties = {
  padding: '2px 10px', background: '#3a3d41', color: '#fff', border: '1px solid #555',
  borderRadius: 3, cursor: 'pointer', font: '12px ui-monospace, monospace',
};

// Quote a CSV field per RFC 4180 (wrap in quotes, double embedded quotes).
const csv = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;

export function Matrix({ model }: { model: ContractModel | null }) {
  if (!model) return <Msg>Matrix appears after the model loads.</Msg>;
  const rules = model.rules ?? [];
  if (rules.length === 0) return <Msg>No <code>ACPolicy</code> rules in this contract.</Msg>;

  // Rows = accessed roles, columns = accessed resources.
  const roles = [...new Set(rules.map((r) => r.role).filter(Boolean))];
  const resources = [...new Set(rules.map((r) => r.resource).filter(Boolean))];

  const at = (role: string, resource: string) =>
    rules.filter((r) => r.role === role && r.resource === resource);

  const saveCsv = () => {
    const cellText = (role: string, res: string) =>
      at(role, res).map((r) => `${r.action === 'Grant' ? '+' : '-'}${r.permission}`).join('; ');
    const lines = [
      ['role \\ resource', ...resources].map(csv).join(','),
      ...roles.map((role) => [role, ...resources.map((res) => cellText(role, res))].map(csv).join(',')),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    void saveBlobAs(`${model.contractName || 'contract'}-policy.csv`, blob, { 'text/csv': ['.csv'] });
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ color: '#9cdcfe', fontSize: 11 }}>
          Access-control matrix — roles (rows) × resources (columns).
          {model.acControllers.length > 0 && <> Policy controller: <b>{model.acControllers.join(', ')}</b>.</>}
        </div>
        <button type="button" style={{ ...saveBtn, marginLeft: 'auto' }} title="Save matrix as CSV" onClick={saveCsv}>Save</button>
      </div>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={head}>role \ resource</th>
            {resources.map((res) => <th key={res} style={head}>{res}</th>)}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role}>
              <td style={{ ...cell, color: '#d4d4d4', fontWeight: 600 }}>{role}</td>
              {resources.map((res) => (
                <td key={res} style={cell}>
                  {at(role, res).map((r, i) => (
                    <div key={i} title={`rule ${r.name}, by ${r.controller}`}>
                      <span style={{ color: r.action === 'Grant' ? '#a6e22e' : '#f48771' }}>
                        {r.action === 'Grant' ? '✓' : '✗'} {r.permission}
                      </span>
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 12, color: '#9cdcfe' }}>{children}</div>;
}
