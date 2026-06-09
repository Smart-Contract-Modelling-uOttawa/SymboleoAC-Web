import { useCallback, useEffect, useRef, useState } from 'react';
import type * as monaco from '@codingame/monaco-vscode-editor-api';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { EditorPane } from './editor/EditorPane.js';
import { generate, type GenerateResult } from './codegen/api.js';
import { GeneratedFilesView } from './codegen/GeneratedFilesView.js';
import { DiagnosticsView } from './codegen/DiagnosticsView.js';
import { SAMPLES, DEFAULT_SAMPLE, DEFAULT_SAMPLE_NAME } from './sample.js';
import { openFile, saveFile, saveFileAs } from './fileio.js';
import { Outline } from './outline/Outline.js';
import { buildShareUrl, readSharedFromHash, clearShareHash } from './share.js';
import { getModel, type ContractModel } from './model/api.js';
import { Diagram } from './model/Diagram.js';
import { Matrix } from './model/Matrix.js';
import { ClassDiagram } from './model/ClassDiagram.js';

type Tab = 'generated' | 'diagnostics' | 'diagram' | 'matrix' | 'domain';
type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

const btn: React.CSSProperties = {
  padding: '4px 12px', background: '#3a3d41', color: '#fff', border: 'none',
  borderRadius: 2, cursor: 'pointer', fontSize: 12,
};

export function App() {
  const sourceRef = useRef(DEFAULT_SAMPLE);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | undefined>(undefined);

  const [currentName, setCurrentName] = useState(DEFAULT_SAMPLE_NAME);
  const [tab, setTab] = useState<Tab>('generated');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [editorInst, setEditorInst] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [outlineOn, setOutlineOn] = useState(false);
  const [revision, setRevision] = useState(0); // bumped on edits → refreshes the model
  const [model, setModel] = useState<ContractModel | null>(null);
  // Initial editor content resolved BEFORE the editor mounts, so a shared link
  // isn't clobbered by the wrapper re-applying the default sample after mount.
  const [boot, setBoot] = useState<{ code: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    readSharedFromHash().then((shared) => {
      if (cancelled) return;
      if (shared) {
        clearShareHash();
        sourceRef.current = shared;
        setCurrentName('shared.symboleo');
        setBoot({ code: shared, name: 'shared.symboleo' });
        setStatus({ kind: 'ok', message: 'loaded shared contract from link' });
      } else {
        setBoot({ code: DEFAULT_SAMPLE, name: DEFAULT_SAMPLE_NAME });
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Refresh the structured model (Outline / Diagram / Matrix) only when one of
  // those views is showing, debounced — each call spawns a JVM, so we avoid
  // per-keystroke churn.
  useEffect(() => {
    const needed = outlineOn || tab === 'diagram' || tab === 'matrix' || tab === 'domain';
    if (!needed) return;
    const t = setTimeout(() => {
      getModel(sourceRef.current).then((m) => { if (m) setModel(m); });
    }, 800);
    return () => clearTimeout(t);
  }, [revision, outlineOn, tab]);

  const handleTextChanged = useCallback((txt: string) => {
    sourceRef.current = txt;
    setRevision((r) => r + 1);
  }, []);

  // Push content into the editor (sample switch / file open). Keeps the same
  // model URI so the LSP just sees an edit and re-validates.
  const setEditorContent = useCallback((text: string, name: string) => {
    sourceRef.current = text;
    setCurrentName(name);
    setRevision((r) => r + 1);
    const model = editorRef.current?.getModel();
    if (model) model.setValue(text);
  }, []);

  const handleEditorReady = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    setEditorInst(editor);
  }, []);

  const handleShare = useCallback(async () => {
    let url: string;
    try {
      url = await buildShareUrl(sourceRef.current);
    } catch (e) {
      setStatus({ kind: 'error', message: `share failed: ${(e as Error).message}` });
      return;
    }
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* fall through */ }
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    // Always reflect the link in the address bar so it can be copied manually.
    history.replaceState(null, '', url);
    setStatus({
      kind: 'ok',
      message: copied ? 'share link copied to clipboard' : 'share link is in the address bar — copy it',
    });
  }, []);

  const handleSampleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const s = SAMPLES.find((x) => x.name === e.target.value);
    if (!s) return;
    fileHandleRef.current = undefined; // it's an example now, not a disk file
    setEditorContent(s.text, s.name);
  }, [setEditorContent]);

  const handleOpen = useCallback(async () => {
    try {
      const f = await openFile();
      if (!f) return;
      fileHandleRef.current = f.handle;
      setEditorContent(f.text, f.name);
      setStatus({ kind: 'ok', message: `opened ${f.name}` });
    } catch (e) {
      setStatus({ kind: 'error', message: `open failed: ${(e as Error).message}` });
    }
  }, [setEditorContent]);

  const handleSave = useCallback(async () => {
    try {
      const res = await saveFile(currentName, sourceRef.current, fileHandleRef.current);
      if (!res) return; // cancelled
      fileHandleRef.current = res.handle ?? undefined;
      setCurrentName(res.name);
      setStatus({ kind: 'ok', message: `saved ${res.name}` });
    } catch (e) {
      setStatus({ kind: 'error', message: `save failed: ${(e as Error).message}` });
    }
  }, [currentName]);

  const handleSaveAs = useCallback(async () => {
    try {
      const res = await saveFileAs(currentName, sourceRef.current);
      if (!res) return; // cancelled
      fileHandleRef.current = res.handle ?? undefined;
      setCurrentName(res.name);
      setStatus({ kind: 'ok', message: `saved ${res.name}` });
    } catch (e) {
      setStatus({ kind: 'error', message: `save failed: ${(e as Error).message}` });
    }
  }, [currentName]);

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

  const isSample = SAMPLES.some((s) => s.name === currentName);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: '#2d2d30', borderBottom: '1px solid #333',
      }}>
        <strong style={{ fontSize: 14 }}>SymboleoAC Web IDE</strong>

        <label style={{ fontSize: 12, color: '#9cdcfe' }}>
          Example:{' '}
          <select value={isSample ? currentName : ''} onChange={handleSampleChange}
                  style={{ background: '#3a3d41', color: '#fff', border: '1px solid #555', borderRadius: 2, padding: '2px 4px', fontSize: 12 }}>
            {!isSample && <option value="">{currentName} (edited)</option>}
            {SAMPLES.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>

        <button type="button" style={btn} onClick={handleOpen}>Open…</button>
        <button type="button" style={btn} onClick={handleSave}>Save</button>
        <button type="button" style={btn} onClick={handleSaveAs}>Save As…</button>
        <button
          type="button"
          style={{ ...btn, background: outlineOn ? '#0e639c' : '#3a3d41' }}
          onClick={() => setOutlineOn((v) => !v)}
          title="Toggle the symbol outline"
        >
          Outline
        </button>
        <button type="button" style={btn} onClick={handleShare} title="Copy a shareable link to this contract">Share</button>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={handleGenerate}
          disabled={status.kind === 'running'}
          style={{ ...btn, background: status.kind === 'running' ? '#555' : '#0e639c', padding: '4px 14px' }}
        >
          {status.kind === 'running' ? 'Generating…' : 'Generate JS'}
        </button>
        <span style={{
          fontSize: 12, minWidth: 180,
          color: status.kind === 'error' ? '#f48771' : status.kind === 'ok' ? '#a6e22e' : '#9cdcfe',
        }}>
          {status.kind === 'idle' ? 'Edit on the left, then Generate.' :
           status.kind === 'running' ? '…' : status.message}
        </span>
      </header>

      <PanelGroup direction="horizontal" style={{ flex: 1, minHeight: 0 }}>
        {outlineOn && (
          <Panel id="outline" order={1} defaultSize={18} minSize={10}>
            <Outline editor={editorInst} model={model} />
          </Panel>
        )}
        {outlineOn && <PanelResizeHandle style={{ width: 4, background: '#333', cursor: 'col-resize' }} />}

        <Panel id="editor" order={2} defaultSize={outlineOn ? 42 : 50} minSize={20}>
          {boot ? (
            <EditorPane
              initialCode={boot.code}
              initialName={boot.name}
              onTextChanged={handleTextChanged}
              onEditorReady={handleEditorReady}
            />
          ) : (
            <div style={{ padding: 12, color: '#9cdcfe' }}>Loading…</div>
          )}
        </Panel>

        <PanelResizeHandle style={{ width: 4, background: '#333', cursor: 'col-resize' }} />

        <Panel id="right" order={3} defaultSize={outlineOn ? 42 : 50} minSize={20}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <nav style={{ display: 'flex', background: '#2d2d30', borderBottom: '1px solid #333' }}>
              {([
                ['generated', `Generated files (${result?.summary.generatedFiles ?? 0})`],
                ['diagnostics', `Diagnostics (${result?.issues?.length ?? 0})`],
                ['domain', 'Domain'],
                ['diagram', 'Rules'],
                ['matrix', 'Policy'],
              ] as const).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    padding: '6px 12px',
                    background: tab === t ? '#1e1e1e' : 'transparent',
                    color: tab === t ? '#fff' : '#9cdcfe',
                    border: 'none', borderRight: '1px solid #333',
                    cursor: 'pointer', font: 'inherit', fontSize: 12,
                  }}
                >
                  {label}
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
                  : <div style={{ padding: 12, color: '#9cdcfe' }}>Live diagnostics (squiggles) appear in the editor as you type. This list shows diagnostics from the most recent <em>Generate</em>.</div>
              )}
              {tab === 'domain' && <ClassDiagram model={model} />}
              {tab === 'diagram' && <Diagram model={model} />}
              {tab === 'matrix' && <Matrix model={model} />}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
