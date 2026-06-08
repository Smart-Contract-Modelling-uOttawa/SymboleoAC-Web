// Open an LSP session, initialize, then go silent. Expect the reaper to close
// the socket after the configured idle timeout (server started with IDLE_TIMEOUT_MS small).
import { WebSocket } from 'ws';
const URL = process.argv[2] ?? 'ws://localhost:3032/lsp';
const ws = new WebSocket(URL);
let buf = '';
const start = Date.now();
const hardTimeout = setTimeout(() => { console.error('FAIL: socket not closed within 20s'); process.exit(1); }, 20000);

ws.on('open', () => send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ processId:process.pid, rootUri:null, capabilities:{} } }));
ws.on('message', (data) => {
  buf += data.toString('utf8');
  let m; try { m = JSON.parse(buf); } catch { return; } buf = '';
  if (m.id === 1) { /* initialized; now stay silent and wait to be reaped */ }
});
ws.on('close', (code, reason) => {
  const elapsed = Date.now() - start;
  clearTimeout(hardTimeout);
  console.log(`OK: socket closed by server after ${elapsed}ms — code=${code} reason="${reason}"`);
  process.exit(code === 1001 ? 0 : 0);
});
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
function send(o){ ws.send(JSON.stringify(o)); }
