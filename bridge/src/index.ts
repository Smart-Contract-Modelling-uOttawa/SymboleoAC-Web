/**
 * SymboleoAC bridge:
 *   GET /healthz       liveness
 *   POST /generate     {source} → {files,issues,summary}  (shells out to codegen-cli jar)
 *   WS  /lsp           pipes a per-session java LSP child over WebSocket
 *
 * Env:
 *   LS_JAR        path to symboleoac-language-server fat jar       (required)
 *   CODEGEN_JAR   path to symboleoac-codegen-cli fat jar             (required)
 *   PORT          listen port                                        (default 3000)
 *   MAX_SESSIONS  concurrent LSP sessions                            (default 8)
 *   JVM_XMX       per-LSP-session heap                               (default 512m)
 *   ALLOW_ORIGIN  CORS allow-origin for /generate                    (default *)
 *   GEN_TIMEOUT_MS codegen subprocess wall-clock cap                 (default 30000)
 */
import express from 'express';
import { createServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath, join as joinPath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';
import {
  createConnection,
  createServerProcess,
  forward,
} from 'vscode-ws-jsonrpc/server';
import { Message } from 'vscode-jsonrpc';

const isRequest = (m: Message): m is Message & { method: string; params?: any } =>
  typeof (m as any).method === 'string';

const env = (k: string, fallback?: string): string => {
  const v = process.env[k];
  if (v === undefined || v === '') {
    if (fallback === undefined) {
      console.error(`fatal: required env var ${k} is not set`);
      process.exit(2);
    }
    return fallback;
  }
  return v;
};

const LS_JAR = resolvePath(env('LS_JAR'));
const CODEGEN_JAR = resolvePath(env('CODEGEN_JAR'));
const PORT = Number(env('PORT', '3000'));
const MAX_SESSIONS = Number(env('MAX_SESSIONS', '8'));
const JVM_XMX = env('JVM_XMX', '512m');
const ALLOW_ORIGIN = env('ALLOW_ORIGIN', '*');
const GEN_TIMEOUT_MS = Number(env('GEN_TIMEOUT_MS', '30000'));
// M7 hardening knobs:
const IDLE_TIMEOUT_MS = Number(env('IDLE_TIMEOUT_MS', '600000')); // kill an LSP session idle this long (10 min)
const RATE_WINDOW_MS = Number(env('RATE_WINDOW_MS', '60000'));   // /generate per-IP fixed window
const RATE_MAX = Number(env('RATE_MAX', '20'));                  // …max requests per window
const MAX_CONCURRENT_GEN = Number(env('MAX_CONCURRENT_GEN', '4')); // cap simultaneous codegen JVMs

for (const [name, path] of [['LS_JAR', LS_JAR], ['CODEGEN_JAR', CODEGEN_JAR]] as const) {
  if (!existsSync(path)) {
    console.error(`fatal: ${name} does not exist on disk: ${path}`);
    process.exit(2);
  }
}

let activeSessions = 0;
let activeGenerations = 0;

// --- per-IP fixed-window rate limiter for /generate -------------------------
type Bucket = { count: number; windowStart: number };
const rateBuckets = new Map<string, Bucket>();
const clientIp = (req: express.Request): string => {
  // Caddy sets X-Forwarded-For; fall back to the socket address.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
};
const rateLimit: express.RequestHandler = (req, res, next) => {
  const now = Date.now();
  const ip = clientIp(req);
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    b = { count: 0, windowStart: now };
    rateBuckets.set(ip, b);
  }
  b.count++;
  if (b.count > RATE_MAX) {
    const retryAfter = Math.ceil((b.windowStart + RATE_WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
    res.status(429).json({ error: 'rate limit exceeded', retryAfterSeconds: retryAfter });
    return;
  }
  next();
};
// Periodically drop stale buckets so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now - b.windowStart >= RATE_WINDOW_MS) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

const app = express();
app.use(express.json({ limit: env('BODY_LIMIT', '2mb') }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, activeSessions, maxSessions: MAX_SESSIONS, activeGenerations });
});

app.post('/generate', rateLimit, (req, res) => {
  const source = typeof req.body?.source === 'string' ? req.body.source : '';
  if (!source) {
    res.status(400).json({ error: 'missing "source" string in JSON body' });
    return;
  }
  if (activeGenerations >= MAX_CONCURRENT_GEN) {
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: 'server busy: too many concurrent generations' });
    return;
  }
  activeGenerations++;
  const proc = spawn('java', ['-jar', CODEGEN_JAR], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (status: number, body: object) => {
    if (settled) return;
    settled = true;
    activeGenerations = Math.max(0, activeGenerations - 1);
    clearTimeout(timer);
    res.status(status).json(body);
  };
  const timer = setTimeout(() => {
    proc.kill('SIGKILL');
    finish(504, { error: 'codegen timed out', timeoutMs: GEN_TIMEOUT_MS });
  }, GEN_TIMEOUT_MS);

  proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
  proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
  proc.on('error', (err) => finish(500, { error: 'failed to spawn codegen', detail: String(err) }));
  proc.on('close', (code) => {
    // Exit 0 → JS generated; 1 → validation errors (still valid JSON with issues, no files).
    if (code === 0 || code === 1) {
      try {
        const payload = JSON.parse(stdout);
        finish(code === 0 ? 200 : 422, payload);
      } catch (e) {
        finish(500, {
          error: 'codegen returned non-JSON output',
          stdout: stdout.slice(0, 4000),
          stderr: stderr.slice(0, 4000),
        });
      }
      return;
    }
    finish(500, {
      error: 'codegen exited with code ' + code,
      stderr: stderr.slice(0, 4000),
    });
  });

  proc.stdin.write(source);
  proc.stdin.end();
});

// Structured contract summary for the Outline / model diagram / access-control
// matrix. Best-effort: the CLI returns a model even when the contract has
// validation errors, so the outline keeps working while editing.
app.post('/model', rateLimit, (req, res) => {
  const source = typeof req.body?.source === 'string' ? req.body.source : '';
  if (!source) {
    res.status(400).json({ error: 'missing "source" string in JSON body' });
    return;
  }
  if (activeGenerations >= MAX_CONCURRENT_GEN) {
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: 'server busy' });
    return;
  }
  activeGenerations++;
  const proc = spawn('java', ['-jar', CODEGEN_JAR, '--model'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (status: number, body: object) => {
    if (settled) return;
    settled = true;
    activeGenerations = Math.max(0, activeGenerations - 1);
    clearTimeout(timer);
    res.status(status).json(body);
  };
  const timer = setTimeout(() => {
    proc.kill('SIGKILL');
    finish(504, { error: 'model timed out', timeoutMs: GEN_TIMEOUT_MS });
  }, GEN_TIMEOUT_MS);
  proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
  proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
  proc.on('error', (err) => finish(500, { error: 'failed to spawn model extractor', detail: String(err) }));
  proc.on('close', (code) => {
    if (code === 0) {
      try { finish(200, JSON.parse(stdout)); }
      catch { finish(500, { error: 'model returned non-JSON', stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 4000) }); }
      return;
    }
    finish(500, { error: 'model extractor exited with code ' + code, stderr: stderr.slice(0, 4000) });
  });
  proc.stdin.write(source);
  proc.stdin.end();
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request: IncomingMessage, socket, head) => {
  const url = request.url ?? '';
  if (!url.startsWith('/lsp')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws: WebSocket) => {
  if (activeSessions >= MAX_SESSIONS) {
    ws.close(1013, 'server busy');
    return;
  }
  activeSessions++;
  console.log(`[lsp] session opened (${activeSessions}/${MAX_SESSIONS})`);

  // Each session gets its own empty workspace dir on the bridge filesystem.
  // We rewrite `initialize.params.{rootUri,workspaceFolders}` to point here so
  // Xtext's IFileSystemScanner has a valid directory to scan. Without this,
  // a client URI like `file:///workspace` lands on Xtext as `\\workspace` on
  // Windows (UNC path) or `/workspace` on Linux — neither exists, server NPEs.
  const sessionDir = mkdtempSync(joinPath(tmpdir(), 'symboleoac-lsp-'));
  const sessionUri = pathToFileURL(sessionDir).href;

  const socketAdapter: IWebSocket = {
    send: (content) => ws.send(content),
    onMessage: (cb) => ws.on('message', (data) => cb(data.toString('utf8'))),
    onError: (cb) => ws.on('error', (err) => cb(err)),
    onClose: (cb) => ws.on('close', (code, reason) => cb(code, reason.toString('utf8'))),
    dispose: () => ws.close(),
  };
  const reader = new WebSocketMessageReader(socketAdapter);
  const writer = new WebSocketMessageWriter(socketAdapter);
  const socketConnection = createConnection(reader, writer, () => socketAdapter.dispose());

  // Per-session language-server child process. Each browser tab is isolated.
  const serverConnection = createServerProcess('SymboleoAC', 'java', [
    `-Xmx${JVM_XMX}`,
    '-jar',
    LS_JAR,
  ]);

  if (!serverConnection) {
    console.error('[lsp] failed to spawn language server process');
    ws.close(1011, 'cannot spawn language server');
    activeSessions = Math.max(0, activeSessions - 1);
    return;
  }

  // Idle reaper: an abandoned browser tab leaves a JVM pinned. Track the last
  // client→server message and close the socket after IDLE_TIMEOUT_MS of silence.
  // ws.close() triggers forward()'s onClose cascade → serverConnection.dispose()
  // → process.kill(), so the JVM is reclaimed.
  let lastActivity = Date.now();
  const reaperInterval = Math.min(30000, Math.max(1000, Math.floor(IDLE_TIMEOUT_MS / 4)));
  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      console.log('[lsp] reaping idle session');
      try { ws.close(1001, 'idle timeout'); } catch { /* ignore */ }
    }
  }, reaperInterval);
  idleTimer.unref();

  forward(socketConnection, serverConnection, (message: Message) => {
    lastActivity = Date.now();
    if (isRequest(message) && message.method === 'initialize' && message.params) {
      const p = message.params;
      p.rootUri = sessionUri;
      p.rootPath = sessionDir;
      p.workspaceFolders = [{ uri: sessionUri, name: 'workspace' }];
    }
    return message;
  });

  ws.on('close', () => {
    activeSessions = Math.max(0, activeSessions - 1);
    clearInterval(idleTimer);
    // forward() already disposes serverConnection on socket close; call it
    // explicitly too in case the close races ahead of the reader's onClose.
    try { serverConnection.dispose(); } catch { /* already gone */ }
    try { rmSync(sessionDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    console.log(`[lsp] session closed (${activeSessions}/${MAX_SESSIONS})`);
  });
});

server.listen(PORT, () => {
  console.log(`bridge listening on :${PORT}`);
  console.log(`  LS_JAR      = ${LS_JAR}`);
  console.log(`  CODEGEN_JAR = ${CODEGEN_JAR}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
