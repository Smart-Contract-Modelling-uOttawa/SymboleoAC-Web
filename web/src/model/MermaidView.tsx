import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { saveBlobAs } from '../fileio.js';

let seq = 0;

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const btn: React.CSSProperties = {
  width: 26, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0,
  background: '#3a3d41', color: '#fff', border: '1px solid #555', borderRadius: 3,
  cursor: 'pointer', font: '13px ui-monospace, monospace',
};

/**
 * Renders a Mermaid definition with manual zoom controls (−/+/Fit/1:1) and a
 * scrollable viewport (horizontal + vertical bars when the diagram overflows).
 * The SVG is sized in real pixels (viewBox width × zoom) so zooming scrolls
 * rather than the layout being squeezed. `onRendered` runs after each render
 * (e.g. to inject hover tooltips).
 */
export function MermaidView({ def, onRendered, legend, saveName }: {
  def: string | null;
  onRendered?: (el: HTMLElement) => void;
  legend?: React.ReactNode;
  saveName?: string; // base filename (no extension) for the Save button
}) {
  const hostRef = useRef<HTMLDivElement>(null);   // scroll viewport
  const holderRef = useRef<HTMLDivElement>(null); // holds the <svg>
  const cbRef = useRef(onRendered);
  cbRef.current = onRendered;
  const [natW, setNatW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fitWidth = () => {
    const cw = hostRef.current?.clientWidth ?? 0;
    return natW > 0 && cw > 0 ? cw / natW : 1;
  };

  // Render on definition change.
  useEffect(() => {
    if (!def || !holderRef.current) return;
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false, theme: 'dark', securityLevel: 'loose',
      flowchart: { useMaxWidth: false, curve: 'basis' },
      class: { useMaxWidth: false, hideEmptyMembersBox: true },
    });
    mermaid.render(`m-${seq++}`, def).then(({ svg }) => {
      if (cancelled || !holderRef.current) return;
      holderRef.current.innerHTML = svg;
      const s = holderRef.current.querySelector('svg');
      let w = 0;
      if (s) {
        w = s.viewBox?.baseVal?.width || s.getBoundingClientRect().width || 0;
        s.removeAttribute('width');
        s.removeAttribute('height');
        s.style.display = 'block';
        s.style.height = 'auto';
      }
      setNatW(w);
      // Measure after layout settles so the fit width is correct (clientWidth
      // read synchronously here can be 0 / stale).
      setTimeout(() => {
        const cw = hostRef.current?.clientWidth ?? 0;
        setZoom(w > 0 && cw > 50 ? Math.min(1, cw / w) : 1); // default: fit width, no upscale
      }, 120);
      cbRef.current?.(holderRef.current);
      setError(null);
    }).catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [def]);

  // Apply zoom to the rendered SVG (real pixel width → scrollbars on overflow).
  useEffect(() => {
    const s = holderRef.current?.querySelector('svg');
    if (s && natW > 0) s.style.width = `${Math.round(natW * zoom)}px`;
  }, [zoom, natW]);

  const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  // Export the rendered diagram as a standalone SVG at its natural size.
  const saveSvg = () => {
    const live = holderRef.current?.querySelector('svg');
    if (!live) return;
    const s = live.cloneNode(true) as SVGSVGElement;
    if (natW > 0) { s.setAttribute('width', String(Math.round(natW))); s.style.removeProperty('width'); }
    s.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    s.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const xml = new XMLSerializer().serializeToString(s);
    const doc = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    const blob = new Blob([doc], { type: 'image/svg+xml;charset=utf-8' });
    void saveBlobAs(`${saveName || 'diagram'}.svg`, blob, { 'image/svg+xml': ['.svg'] });
  };

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      {legend}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px 4px' }}>
        <button type="button" style={btn} title="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.25))}>−</button>
        <button type="button" style={btn} title="Zoom in" onClick={() => setZoom((z) => clamp(z * 1.25))}>+</button>
        <button type="button" style={{ ...btn, width: 'auto', padding: '0 6px' }} title="Fit width" onClick={() => setZoom(clamp(fitWidth()))}>Fit</button>
        <button type="button" style={{ ...btn, width: 'auto', padding: '0 6px' }} title="Actual size" onClick={() => setZoom(1)}>1:1</button>
        <span style={{ color: '#9cdcfe', fontSize: 11, marginLeft: 4 }}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={{ ...btn, width: 'auto', padding: '0 8px', marginLeft: 'auto' }} title="Save diagram as SVG" onClick={saveSvg}>Save</button>
      </div>
      {error && <div style={{ color: '#f48771', fontSize: 12, padding: '0 8px' }}>diagram error: {error}</div>}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', overflow: 'auto', padding: 10 }}>
        <div ref={holderRef} style={{ width: 'fit-content' }} />
      </div>
    </div>
  );
}
