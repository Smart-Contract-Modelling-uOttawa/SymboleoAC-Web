// Runtime config: where the bridge lives. Override in production via Vite env.
// In dev: defaults point at the local bridge from M2 (port 3030).
const fallbackHost = 'localhost:3030';

export const LSP_URL: string =
  import.meta.env.VITE_LSP_URL ?? `ws://${fallbackHost}/lsp`;

export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? `http://${fallbackHost}`;

// Sanity-check protocol pairing: HTTPS pages must use wss://, never ws://.
if (typeof window !== 'undefined' && window.location.protocol === 'https:' && LSP_URL.startsWith('ws://')) {
  console.error(
    `[config] insecure WebSocket URL "${LSP_URL}" loaded from an HTTPS page — ` +
    'the browser will block this. Set VITE_LSP_URL to a wss:// URL at build time.'
  );
}
