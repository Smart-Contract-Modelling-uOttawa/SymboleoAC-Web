// Smoke-test: send LSP initialize over stdio, read back the response.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rootDir = mkdtempSync(join(tmpdir(), 'symboleo-lsp-test-'));
const rootUri = pathToFileURL(rootDir).href;

const JAR = process.argv[2] ?? 'target/symboleoac-language-server-1.0.0-all.jar';
const proc = spawn('java', ['-jar', JAR], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = Buffer.alloc(0);
let initializeSeen = false;
let stderr = '';

proc.stderr.on('data', d => { stderr += d.toString(); });

proc.stdout.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buf.slice(0, headerEnd).toString('ascii');
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) { console.error('bad header:', header); process.exit(2); }
    const len = parseInt(m[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) break;
    const body = buf.slice(bodyStart, bodyStart + len).toString('utf8');
    buf = buf.slice(bodyStart + len);
    const msg = JSON.parse(body);
    if (msg.id === 1 && msg.result) {
      console.log('OK: server responded to initialize');
      console.log('capabilities keys:', Object.keys(msg.result.capabilities ?? {}).join(', '));
      initializeSeen = true;
      proc.kill();
      setTimeout(() => process.exit(0), 200);
      return;
    }
  }
});

proc.on('exit', code => {
  if (!initializeSeen) {
    console.error('server exited (code=' + code + ') before initialize response');
    console.error('--- stderr ---');
    console.error(stderr);
    process.exit(1);
  }
});

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  proc.stdin.write(body);
}

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    processId: process.pid,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: 'root' }],
  },
});

setTimeout(() => {
  console.error('timeout waiting for initialize response');
  console.error('--- stderr ---');
  console.error(stderr);
  proc.kill();
  process.exit(1);
}, 15000);
