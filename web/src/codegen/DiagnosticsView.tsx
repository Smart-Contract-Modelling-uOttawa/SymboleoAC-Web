import type { Issue } from './api.js';

const colorFor = (sev: string): string => {
  switch (sev) {
    case 'ERROR': return '#f48771';
    case 'WARNING': return '#cca700';
    case 'INFO': return '#75beff';
    default: return '#d4d4d4';
  }
};

export function DiagnosticsView({ issues }: { issues: Issue[] }) {
  if (!issues.length) {
    return <div style={{ padding: 12, color: '#9cdcfe' }}>No issues reported by the most recent /generate call.</div>;
  }
  return (
    <div style={{ overflowY: 'auto', height: '100%', padding: 8, font: '12px monospace' }}>
      {issues.map((issue, i) => (
        <div key={i} style={{ padding: '2px 4px' }}>
          <span style={{ color: colorFor(issue.severity), marginRight: 8 }}>{issue.severity}</span>
          <span style={{ color: '#9cdcfe' }}>
            [{issue.line ?? '?'}:{issue.column ?? '?'}]
          </span>{' '}
          <span>{issue.message}</span>
          {issue.code && <span style={{ color: '#808080' }}> ({issue.code})</span>}
        </div>
      ))}
    </div>
  );
}
