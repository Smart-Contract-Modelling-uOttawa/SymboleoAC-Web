/**
 * Keeps the language client alive and brings it back when the connection drops.
 *
 * Why: the bridge closes an LSP session after IDLE_TIMEOUT_MS of silence (an
 * abandoned tab must not pin a JVM), and monaco-languageclient 10.7's own
 * restart hook never fires (`reader.onClose(() => restartLC)` returns the
 * function instead of calling it). Without this module, a pause longer than the
 * idle timeout, a VPS redeploy or any network hiccup silently ends diagnostics,
 * completion and semantic colouring until the page is reloaded.
 *
 * Two mechanisms:
 *  - a heartbeat notification (`symboleoac/keepAlive`) every few minutes while
 *    the tab is visible; the bridge counts it as activity and does not forward
 *    it to the JVM. Hidden tabs stop beating and are reaped as before.
 *  - a reconnection loop: when the client reaches the Stopped state, restart the
 *    wrapper (fresh WebSocket, fresh JVM session, documents re-opened by the
 *    client) with exponential backoff while the tab is visible, and as soon as a
 *    hidden tab becomes visible again.
 */
import * as monaco from '@codingame/monaco-vscode-editor-api';
import type { LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import { State } from 'vscode-languageclient/browser.js';

export type LspState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export const KEEPALIVE_METHOD = 'symboleoac/keepAlive';
const KEEPALIVE_MS = 4 * 60_000;      // below the bridge's default IDLE_TIMEOUT_MS (10 min)
const BACKOFF_BASE_MS = 1500;
const BACKOFF_MAX_MS = 60_000;

export function attachLspLifecycle(wrapper: LanguageClientWrapper, report: (s: LspState) => void): () => void {
  let disposed = false;
  let attempt = 0;
  let reconnectTimer: number | undefined;
  let keepAliveTimer: number | undefined;
  let stateSub: { dispose(): void } | undefined;

  const stopKeepAlive = () => { if (keepAliveTimer !== undefined) { window.clearInterval(keepAliveTimer); keepAliveTimer = undefined; } };
  const startKeepAlive = () => {
    stopKeepAlive();
    keepAliveTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const lc = wrapper.getLanguageClient();
      if (lc && lc.state === State.Running) void lc.sendNotification(KEEPALIVE_METHOD, {}).catch(() => { /* connection gone: the state watcher takes over */ });
    }, KEEPALIVE_MS);
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    // A hidden tab does not reconnect (that would undo the bridge's idle reaping);
    // it reconnects when it becomes visible again (see onVisibility).
    if (document.visibilityState !== 'visible') return;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 6));
    reconnectTimer = window.setTimeout(() => void reconnect(), delay);
  };

  const reconnect = async () => {
    if (disposed) return;
    reconnectTimer = undefined;
    attempt++;
    report('reconnecting');
    try {
      await wrapper.restart();   // dispose (no-op when already stopped) + start: new WebSocket and LSP session
      watch();
    } catch {
      report('disconnected');
      scheduleReconnect();
    }
  };

  // Follow the current client instance; a restart creates a new one.
  const watch = () => {
    stateSub?.dispose();
    const lc = wrapper.getLanguageClient();
    if (!lc) { report('disconnected'); scheduleReconnect(); return; }
    stateSub = lc.onDidChangeState((e) => {
      if (disposed) return;
      if (e.newState === State.Running) { attempt = 0; report('connected'); startKeepAlive(); }
      else if (e.newState === State.Stopped) { stopKeepAlive(); report('reconnecting'); scheduleReconnect(); }
      else report('connecting');
    });
    if (lc.state === State.Running) { attempt = 0; report('connected'); startKeepAlive(); }
    else if (lc.state === State.Stopped) { report('reconnecting'); scheduleReconnect(); }
    else report('connecting');
  };

  const onVisibility = () => {
    if (document.visibilityState !== 'visible' || disposed) return;
    const lc = wrapper.getLanguageClient();
    if (!lc || lc.state === State.Stopped) {
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      void reconnect();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  watch();
  if (import.meta.env.DEV) {
    // Dev-only: inspect the client from the browser console / automated checks.
    (window as unknown as { __symboleoacLsp?: unknown }).__symboleoacLsp = {
      wrapper, state: () => wrapper.getLanguageClient()?.state, started: () => wrapper.isStarted(), attempts: () => attempt, reconnect,
      request: (method: string, params: unknown) => wrapper.getLanguageClient()?.sendRequest(method, params),
      markers: () => monaco.editor.getModelMarkers({}).map((m) => ({ line: m.startLineNumber, severity: m.severity, message: m.message })),
    };
  }

  return () => {
    disposed = true;
    stopKeepAlive();
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    stateSub?.dispose();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
