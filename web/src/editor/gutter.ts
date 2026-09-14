import type * as monaco from '@codingame/monaco-vscode-editor-api';
import { lineDiff } from '../explain/diff.js';

/**
 * Change markers in the editor gutter while a baseline is set, in the manner
 * of VS Code's source-control decorations: green for added lines, blue for
 * modified lines, a red mark where lines were deleted.
 */
const STYLE_ID = 'symboleoac-change-gutter';
const CSS = `
.sac-gutter-added, .sac-gutter-modified, .sac-gutter-deleted { width: 3px !important; margin-left: 4px; }
.sac-gutter-added { background: #587c0c; }
.sac-gutter-modified { background: #1b81a8; }
.sac-gutter-deleted { background: #94151b; height: 40% !important; }
`;

function ensureCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

const collections = new WeakMap<monaco.editor.IStandaloneCodeEditor, monaco.editor.IEditorDecorationsCollection>();

/** Decorate `editor` with the differences between `baseline` and its current text; `null` clears them. */
export function applyChangeGutter(editor: monaco.editor.IStandaloneCodeEditor, baseline: string | null): void {
  let coll = collections.get(editor);
  if (!coll) { coll = editor.createDecorationsCollection(); collections.set(editor, coll); }
  const model = editor.getModel();
  if (!model || baseline === null) { coll.clear(); return; }
  ensureCss();
  const current = model.getValue();
  const hunks = lineDiff(baseline.split(/\r?\n/), current.split(/\r?\n/));
  const lineCount = model.getLineCount();
  const decos: monaco.editor.IModelDeltaDecoration[] = [];
  for (const h of hunks) {
    if (h.bLen > 0) {
      decos.push({
        range: { startLineNumber: h.bStart + 1, startColumn: 1, endLineNumber: Math.min(lineCount, h.bStart + h.bLen), endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: h.aLen > 0 ? 'sac-gutter-modified' : 'sac-gutter-added' },
      });
    } else {
      const ln = Math.min(lineCount, Math.max(1, h.bStart + 1));
      decos.push({
        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: 'sac-gutter-deleted' },
      });
    }
  }
  coll.set(decos);
}
