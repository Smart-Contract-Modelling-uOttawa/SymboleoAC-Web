import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import type { GenerateResult } from './api.js';

type Props = {
  result: GenerateResult;
};

const langFor = (path: string): string => {
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  return 'plaintext';
};

const downloadZip = async (result: GenerateResult, baseName: string) => {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(result.files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Lightweight nested-folder view. Files are like "MeatSale/domain/events/Foo.js".
type TreeNode = { name: string; path?: string; children: TreeNode[] };
const buildTree = (paths: string[]): TreeNode => {
  const root: TreeNode = { name: '', children: [] };
  for (const p of paths.slice().sort()) {
    let cur = root;
    const parts = p.split('/');
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === part);
      if (!next) {
        next = { name: part, children: [] };
        if (isLeaf) next.path = p;
        cur.children.push(next);
      }
      cur = next;
    });
  }
  return root;
};

function TreeView({ node, selected, onSelect, depth = 0 }: {
  node: TreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul style={{ listStyle: 'none', paddingLeft: depth === 0 ? 0 : 14, margin: 0 }}>
      {node.children.map((child) => {
        const isFile = !!child.path;
        return (
          <li key={child.name}>
            {isFile ? (
              <button
                type="button"
                onClick={() => onSelect(child.path!)}
                style={{
                  background: selected === child.path ? '#264f78' : 'transparent',
                  color: '#d4d4d4',
                  border: 'none',
                  padding: '2px 6px',
                  font: 'inherit',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                {child.name}
              </button>
            ) : (
              <>
                <div style={{ padding: '2px 6px', color: '#9cdcfe' }}>{child.name}/</div>
                <TreeView node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function GeneratedFilesView({ result }: Props) {
  const paths = useMemo(() => Object.keys(result.files), [result.files]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const [selected, setSelected] = useState<string | null>(paths[0] ?? null);

  // Reset selection when a new generate result arrives.
  useEffect(() => {
    setSelected(paths[0] ?? null);
  }, [paths]);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!editorContainerRef.current) return;
    if (editorRef.current) return;
    editorRef.current = monaco.editor.create(editorContainerRef.current, {
      value: '',
      language: 'plaintext',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      theme: 'vs-dark',
      scrollBeyondLastLine: false,
    });
    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current || !selected) return;
    const content = result.files[selected] ?? '';
    const model = monaco.editor.createModel(content, langFor(selected));
    const prev = editorRef.current.getModel();
    editorRef.current.setModel(model);
    prev?.dispose();
  }, [selected, result.files]);

  if (paths.length === 0) {
    return (
      <div style={{ padding: 12, color: '#9cdcfe' }}>
        No files generated.
      </div>
    );
  }

  const contractName = paths[0]?.split('/')[0] ?? 'symboleoac-output';

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={{
        width: 280,
        borderRight: '1px solid #333',
        overflowY: 'auto',
        background: '#252526',
        padding: '8px 4px',
      }}>
        <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong>{paths.length} files</strong>
          <button
            type="button"
            onClick={() => downloadZip(result, contractName)}
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              cursor: 'pointer',
              background: '#0e639c',
              color: 'white',
              border: 'none',
              borderRadius: 2,
            }}
          >
            Download .zip
          </button>
        </div>
        <TreeView node={tree} selected={selected} onSelect={setSelected} />
      </aside>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          padding: '4px 8px',
          background: '#2d2d30',
          borderBottom: '1px solid #333',
          font: '12px monospace',
        }}>
          {selected ?? '(no file selected)'}
        </div>
        <div ref={editorContainerRef} style={{ width: '100%', height: 'calc(100% - 27px)' }} />
      </div>
    </div>
  );
}
