import { useCallback, useRef, useState } from 'react';
import { EditorPane } from './editor/EditorPane.js';
import { generate, type GenerateResult } from './codegen/api.js';
import { GeneratedFilesView } from './codegen/GeneratedFilesView.js';
import { DiagnosticsView } from './codegen/DiagnosticsView.js';
import { DEFAULT_SAMPLE, DEFAULT_SAMPLE_NAME } from './sample.js';

type Tab = 'generated' | 'diagnostics';
type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

export function App() {
  const sourceRef = useRef(DEFAULT_SAMPLE);
  const [tab, setTab] = useState<Tab>('generated');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const handleTextChanged = useCallback((txt: string) => {
    sourceRef.current = txt;
  }, []);

  const handleGenerate = useCallback(async () => {
    setStatus({ kind: 'running' });
    const r = await generate(sourceRef.current);
    if (r.ok) {
      setResult(r.data);
      setTab('generated');
      setStatus({ kind: 'ok', message: `${r.data.summary.generatedFiles} files generated` });
    } else {
      if (r.data) setResult(r.data as GenerateResult);
      setTab('diagnostics');
      setStatus({ kind: 'error', message: r.error });
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: '#2d2d30',
        borderBottom: '1px solid #333',
      }}>
        <strong style={{ fontSize: 14 }}>SymboleoAC Web IDE</strong>
        <span style={{ color: '#9cdcfe', fontSize: 12 }}>{DEFAULT_SAMPLE_NAME}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={status.kind === 'running'}
          style={{
            padding: '4px 14px',
            background: status.kind === 'running' ? '#555' : '#0e639c',
            color: 'white',
            border: 'none',
            borderRadius: 2,
            cursor: status.kind === 'running' ? 'wait' : 'pointer',
          }}
        >
          {status.kind === 'running' ? 'Generating…' : 'Generate JS'}
        </button>
        <span style={{
          fontSize: 12,
          color: status.kind === 'error' ? '#f48771' : status.kind === 'ok' ? '#a6e22e' : '#9cdcfe',
          minWidth: 200,
        }}>
          {status.kind === 'idle' ? 'Edit the contract on the left, then click Generate.' :
           status.kind === 'running' ? '…' :
           status.message}
        </span>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditorPane
            initialCode={DEFAULT_SAMPLE}
            initialName={DEFAULT_SAMPLE_NAME}
            onTextChanged={handleTextChanged}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
          <nav style={{ display: 'flex', background: '#2d2d30', borderBottom: '1px solid #333' }}>
            {(['generated', 'diagnostics'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 14px',
                  background: tab === t ? '#1e1e1e' : 'transparent',
                  color: tab === t ? '#fff' : '#9cdcfe',
                  border: 'none',
                  borderRight: '1px solid #333',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                }}
              >
                {t === 'generated' ? `Generated files (${result?.summary.generatedFiles ?? 0})` : `Diagnostics (${result?.issues?.length ?? 0})`}
              </button>
            ))}
          </nav>
          <div style={{ flex: 1, minHeight: 0 }}>
            {tab === 'generated' && (
              result
                ? <GeneratedFilesView result={result} />
                : <div style={{ padding: 12, color: '#9cdcfe' }}>No code generated yet. Click <em>Generate JS</em>.</div>
            )}
            {tab === 'diagnostics' && (
              result
                ? <DiagnosticsView issues={result.issues} />
                : <div style={{ padding: 12, color: '#9cdcfe' }}>Live diagnostics (squiggles) appear in the editor on the left as you type. The list here shows diagnostics returned by the most recent <em>Generate</em>.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
