import { useEffect, useRef } from 'react';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import { SYMBOLEOAC_LANGUAGE_ID } from './symboleoac.monarch.js';

type Props = {
  /** Baseline text (left side, read-only). */
  original: string;
  originalName: string;
  /** The main editor's model (right side). Sharing it keeps the language client,
   *  diagnostics and the Outline in sync while the user edits in the diff view. */
  modified: monaco.editor.ITextModel | null;
  currentName: string;
};

/**
 * Side-by-side comparison of the baseline and the current contract, using
 * Monaco's diff editor. No `theme` option here: the SymboleoAC theme is global
 * (see editor/theme.ts) and any other value would replace it.
 */
export function DiffPane({ original, originalName, modified, currentName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);

  useEffect(() => {
    if (!containerRef.current || diffRef.current) return;
    diffRef.current = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      renderSideBySide: true,
      originalEditable: false,
      readOnly: false,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      diffWordWrap: 'off',
    });
    return () => {
      diffRef.current?.dispose();
      diffRef.current = null;
      originalModelRef.current?.dispose();
      originalModelRef.current = null;
    };
  }, []);

  // (Re)build the baseline model when the baseline text changes; reuse the main model on the right.
  useEffect(() => {
    const diff = diffRef.current;
    if (!diff || !modified) return;
    if (!originalModelRef.current) {
      originalModelRef.current = monaco.editor.createModel(original, SYMBOLEOAC_LANGUAGE_ID,
        monaco.Uri.parse(`inmemory://baseline/${encodeURIComponent(originalName)}.symboleo`));
    } else if (originalModelRef.current.getValue() !== original) {
      originalModelRef.current.setValue(original);
    }
    diff.setModel({ original: originalModelRef.current, modified });
  }, [original, originalName, modified]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', font: '12px ui-monospace, monospace', background: '#2d2d30', borderBottom: '1px solid #333', color: '#9cdcfe' }}>
        <span style={{ flex: 1, padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={originalName}>
          Baseline: {originalName} <span style={{ color: '#808080' }}>(read-only)</span>
        </span>
        <span style={{ flex: 1, padding: '4px 8px', borderLeft: '1px solid #333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={currentName}>
          Current: {currentName} <span style={{ color: '#808080' }}>(editable)</span>
        </span>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
