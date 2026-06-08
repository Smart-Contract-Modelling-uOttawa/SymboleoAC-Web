# SymboleoAC Web IDE — Build Plan for Claude Code

This file is the brief for an agentic build. Work through the milestones **in order**.
Each milestone has an explicit **Done when** check — do not advance until it passes.
You may split this file into `CLAUDE.md` (ground rules + architecture) plus per-milestone
task notes if that helps you, but keep the version pins and ground rules intact.

---

## 0. Goal

Build a web-based development environment for the **SymboleoAC** DSL with live editing
features comparable to its Eclipse IDE: syntax highlighting, on-the-fly validation,
code completion, and code generation. It must be deployable on cheap public hosting and
must not be fragile.

**Decision already made (do not re-litigate):**

- **Reuse the existing Xtext language**, do not rewrite it. SymboleoAC is defined in
  Eclipse Xtext (grammar) + Xtend (validation, code generation). We expose it over the
  **Language Server Protocol (LSP)**.
- **Front end is static** (deployed to GitHub Pages, free) using **Monaco** via
  **`monaco-languageclient` v10**.
- **Back end is a JVM language server** wrapped by a small **Node WebSocket↔LSP bridge**,
  running in **Docker** on a **single cheap VPS** (target: Hetzner CX22, ~4 GB RAM, ~6 CAD/mo),
  fronted by **Caddy** for automatic TLS.
- Live completion requires a real LSP; that is why we run a backend rather than going
  serverless.

Upstream repos (read them; do not assume their internals):

- SymboleoAC IDE (Xtext/Xtend, Eclipse): `https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-IDE`
- Prior web attempt (reference only, do not copy its fragile parts): `https://github.com/Smart-Contract-Modelling-uOttawa/Symboleo-web`

---

## 1. Ground rules for the agent (read before coding)

1. **Discover, don't assume, the existing project names.** The Xtext projects use specific
   Java package and project names (e.g. something like `…symboleoac`, `…symboleoac.ide`,
   `…symboleoac.web`). Clone the SymboleoAC-IDE repo and find the real names before writing
   build files. The language-server entry point lives in the **`*.ide`** project.

2. **Do not fabricate the `monaco-languageclient` v10 API.** v10 (released ~2025) reorganised
   its API substantially from v8/v9. For the client, **follow the official examples and docs
   and pin exact versions**:
   - Docs: `https://github.com/TypeFox/monaco-languageclient/blob/main/docs/index.md`
   - Repo + examples (`json-client`, `json-server`): `https://github.com/TypeFox/monaco-languageclient`
   - React wrapper: `@typefox/monaco-editor-react`
   When example code and this plan disagree on import paths or option names, **the installed
   package version wins** — read its `package.json` exports and TypeScript types.

3. **Pin versions** in a `VERSIONS.md` at repo root as you go, and never use `latest`.

4. **Verify at every milestone with a running system**, not by reasoning. Each milestone
   below ends with a concrete check you must actually execute.

5. **The LSP version must match between server and client.** Xtext bundles a specific `lsp4j`
   (LSP spec version); the client's `vscode-languageclient` implements a spec version too.
   Mismatches silently break completion/diagnostics. If a feature is missing, suspect this
   first. Record both versions in `VERSIONS.md`.

6. **Network rule:** the static front end is served over HTTPS, so the editor **must** talk to
   the backend over **`wss://`** (secure WebSocket). Plain `ws://` will be blocked as mixed
   content. This is non-negotiable and is the single most common cause of "it works locally,
   breaks in prod."

---

## 2. Target architecture

```
 Browser (static, GitHub Pages, HTTPS)
   └─ Monaco editor
        ├─ Monarch grammar  ........... instant client-side syntax highlighting
        └─ monaco-languageclient v10 ── wss ──┐
                                              │
 VPS (Hetzner CX22, Docker)                   │
   ┌──────────────────────────────────────────────────────────┐
   │ Caddy (TLS termination, reverse proxy, auto Let's Encrypt) │
   └───────────────┬──────────────────────────────────────────┘
                   │ ws (localhost)
   ┌───────────────▼──────────────────────────────────────────┐
   │ Node bridge (Express + ws + vscode-ws-jsonrpc)             │
   │  • /lsp   WebSocket → spawns `java -jar <lang-server>.jar` │
   │           (stdio LSP) per session, pipes both ways         │
   │  • /generate  POST source → runs existing SymboleoAC CLI   │
   │               jar, returns generated JS                    │
   └───────────────┬──────────────────────────────────────────┘
                   │ child process, stdio
   ┌───────────────▼──────────────────────────────────────────┐
   │ Xtext language server (uber-jar)                           │
   │  Main-Class: org.eclipse.xtext.ide.server.ServerLauncher   │
   └────────────────────────────────────────────────────────────┘
```

Why a Node bridge instead of having Java speak WebSocket directly: the canonical
`monaco-languageclient` server pattern spawns the LS as a child process and pipes its
**stdio** over the socket. This is the best-tested path, keeps the Java side untouched
(default `ServerLauncher` is stdio), and lets the same bridge also expose the code-generation
endpoint that reuses the existing CLI jar.

---

## 3. Repository layout (monorepo)

```
symboleoac-web/
├─ CLAUDE.md                  # ground rules + architecture (from this file)
├─ VERSIONS.md                # every pinned version, filled in as you go
├─ language-server/           # how we obtain the uber-jar (submodule or build script)
│  ├─ build-language-server.sh
│  └─ dist/                   # produced: symboleoac-language-server.jar (+ CLI jar)
├─ bridge/                    # Node WebSocket↔LSP bridge + /generate
│  ├─ src/index.ts
│  ├─ package.json
│  └─ Dockerfile
├─ web/                       # Monaco front end (static)
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ symboleoac.monarch.ts
│  │  └─ client.ts
│  ├─ package.json
│  └─ vite.config.ts
├─ infra/
│  ├─ docker-compose.yml
│  └─ Caddyfile
└─ .github/workflows/
   └─ deploy-web.yml          # build web/ and publish to GitHub Pages
```

---

## 4. Milestones

### M1 — Produce the Xtext language-server uber-jar

The SymboleoAC-IDE repo is an Eclipse/Maven-Tycho or Gradle Xtext project. Goal: a single
self-contained jar that starts an LSP server over stdio, plus the existing CLI jar for codegen.

Tasks:

1. Clone SymboleoAC-IDE. Locate the **`*.ide`** project (LSP support lives there) and the
   `*.web` project if present (ignore the old Xtext-Web HTTP servlet approach — we use LSP).
2. Confirm the LSP entry point: `org.eclipse.xtext.ide.server.ServerLauncher`. If the `*.ide`
   project is missing LSP/"generic IDE support", regenerate the Xtext project with that option,
   or add the `org.eclipse.xtext.ide` dependency and the launcher.
3. Build a fat/uber-jar:
   - **Gradle:** apply the Shadow plugin and configure the `*.ide` project's `shadowJar` task
     with manifest `Main-Class: org.eclipse.xtext.ide.server.ServerLauncher`.
   - **Maven/Tycho:** use `maven-shade-plugin` (or build a product) on the ide module with the
     same Main-Class.
4. Also obtain/build the **existing CLI jar** (grammar checker + code generator) the team
   already produces. Run it with `--help` to learn its exact invocation; record the command
   for source-in / JS-out in `bridge/README.md`. Do **not** redesign the generator.
5. Put both jars in `language-server/dist/` via `build-language-server.sh`.

**Done when:** `java -jar language-server/dist/symboleoac-language-server.jar` starts and stays
running waiting on stdin (it speaks LSP over stdio), and the CLI jar generates JS from a known
`.symboleo`/SymboleoAC sample file.

---

### M2 — Node bridge (WebSocket↔LSP) + /generate endpoint

Use TypeScript. Pin and record versions of `ws`, `vscode-ws-jsonrpc`,
`vscode-languageserver-protocol`, `express`.

`bridge/src/index.ts` (skeleton — verify exact `vscode-ws-jsonrpc` export paths against the
installed version's `json-server` example; the server submodule API is the moving part):

```ts
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import {
  IWebSocket,
  WebSocketMessageReader,
  WebSocketMessageWriter,
} from 'vscode-ws-jsonrpc';
import {
  createConnection,
  createServerProcess,
  forward,
} from 'vscode-ws-jsonrpc/server';
import { Message } from 'vscode-languageserver-protocol';

const LS_JAR = process.env.LS_JAR ?? '/app/dist/symboleoac-language-server.jar';
const CLI_JAR = process.env.CLI_JAR ?? '/app/dist/symboleoac-cli.jar';
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 8);
const JVM_XMX = process.env.JVM_XMX ?? '512m';

let sessions = 0;
const app = express();
app.use(express.json({ limit: '1mb' }));

// --- code generation: reuse the existing CLI jar (stateless, robust) ---
app.post('/generate', (req, res) => {
  const source: string = req.body?.source ?? '';
  // Adjust args to the real CLI interface discovered in M1.
  const proc = spawn('java', ['-jar', CLI_JAR, '--generate', '--stdin']);
  let out = '', err = '';
  proc.stdout.on('data', d => (out += d));
  proc.stderr.on('data', d => (err += d));
  proc.on('close', code =>
    code === 0 ? res.json({ output: out }) : res.status(422).json({ error: err })
  );
  proc.stdin.write(source);
  proc.stdin.end();
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/lsp')) return socket.destroy();
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});

wss.on('connection', ws => {
  if (sessions >= MAX_SESSIONS) { ws.close(1013, 'server busy'); return; }
  sessions++;

  const socket: IWebSocket = {
    send: c => ws.send(c),
    onMessage: cb => ws.on('message', cb),
    onError: cb => ws.on('error', cb),
    onClose: cb => ws.on('close', cb),
    dispose: () => ws.close(),
  };
  const reader = new WebSocketMessageReader(socket);
  const writer = new WebSocketMessageWriter(socket);
  const socketConnection = createConnection(reader, writer, () => socket.dispose());

  // Spawn one language server per session over stdio.
  const serverConnection = createServerProcess('SymboleoAC', 'java', [
    `-Xmx${JVM_XMX}`, '-jar', LS_JAR,
  ]);

  forward(socketConnection, serverConnection, (message: Message) => message);

  ws.on('close', () => { sessions = Math.max(0, sessions - 1); });
});

server.listen(3000, () => console.log('bridge on :3000  (/lsp, /generate)'));
```

`bridge/Dockerfile` — needs **both** Node and a JRE because it shells out to `java`:

```dockerfile
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends default-jre-headless \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY bridge/package*.json ./
RUN npm ci
COPY bridge/ ./
RUN npm run build
COPY language-server/dist/ ./dist/
ENV LS_JAR=/app/dist/symboleoac-language-server.jar
ENV CLI_JAR=/app/dist/symboleoac-cli.jar
EXPOSE 3000
CMD ["node", "build/index.js"]
```

**Done when:** with the container running, a manual WebSocket client connected to
`ws://localhost:3000/lsp` completes the LSP `initialize` handshake and receives a capabilities
response, and `curl -X POST localhost:3000/generate -d '{"source":"…"}' -H 'content-type:
application/json'` returns generated JS.

---

### M3 — Web front end (Monaco + monaco-languageclient v10)

Use Vite + React + TypeScript. Pin `monaco-languageclient`, `@typefox/monaco-editor-react`,
`vscode-ws-jsonrpc`, `monaco-editor` to exact versions and record them.

Three pieces:

1. **`symboleoac.monarch.ts`** — a Monarch tokenizer for instant client-side highlighting
   (independent of the server). **Extract the real keyword/operator set from the SymboleoAC
   `.xtext` grammar file** (terminals, keywords, the access-control vocabulary); do not invent
   it. Structure:

   ```ts
   export const symboleoacMonarch = {
     keywords: [/* fill from the .xtext grammar */],
     // comments, strings, numbers, identifiers, operators...
     tokenizer: { root: [/* rules */] },
   };
   ```

2. **`client.ts`** — register the `symboleoac` language + Monarch grammar with Monaco, then
   start a language client that connects to `wss://<backend-host>/lsp`. Follow the v10
   `json-client` example for the exact wiring (the API surface moved in v10; do not guess).
   The backend URL must be configurable at build time:

   ```ts
   const LSP_URL = import.meta.env.VITE_LSP_URL; // e.g. wss://symboleoac.example.org/lsp
   ```

3. **`main.tsx`** — mount `@typefox/monaco-editor-react`, plus a **"Generate" button** that
   POSTs the current editor text to `${VITE_API_URL}/generate` and shows the returned JS in a
   read-only output pane.

Associate the language with a file extension (confirm the real one, e.g. `.symboleo`) so the
server activates.

**Done when:** `npm run dev` shows the editor with syntax highlighting; typing produces live
diagnostics (squiggles) and code completion from the server; the Generate button returns JS.
Test against the M2 bridge over **`ws://localhost`** at this stage.

---

### M4 — Local end-to-end with docker-compose

`infra/docker-compose.yml` runs bridge + Caddy together so the whole stack is one command.
For local testing Caddy can serve over `http`/`ws`; production config in M5.

**Done when:** `docker compose up` brings up the stack and the web app (pointed at the local
bridge) has working highlight + validation + completion + generation, end to end.

---

### M5 — TLS via Caddy (production config)

`infra/Caddyfile`:

```
symboleoac.example.org {
    encode zstd gzip
    reverse_proxy bridge:3000
}
```

Caddy automatically provisions a Let's Encrypt certificate and transparently upgrades
WebSocket connections, so `wss://symboleoac.example.org/lsp` and
`https://symboleoac.example.org/generate` both work with no extra config. Replace the domain
with the real one. Ensure the compose file mounts a persistent volume for Caddy's cert data.

**Done when:** hitting `https://<domain>` health route works with a valid certificate and a
`wss://<domain>/lsp` connection completes the LSP handshake from a browser.

---

### M6 — Deploy

**Backend (VPS):**

1. Provision a Hetzner CX22 (or equivalent: 2 vCPU / 4 GB). Install Docker + compose plugin.
2. Point an A/AAAA DNS record at it (subdomain, e.g. `symboleoac.<yourdomain>`).
3. `docker compose up -d`. Confirm Caddy obtained a cert.

**Front end (GitHub Pages):** `.github/workflows/deploy-web.yml`:

```yaml
name: deploy-web
on:
  push: { branches: [main], paths: ['web/**', '.github/workflows/deploy-web.yml'] }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - working-directory: web
        run: npm ci && npm run build
        env:
          VITE_LSP_URL: wss://symboleoac.${{ vars.APP_DOMAIN }}/lsp
          VITE_API_URL: https://symboleoac.${{ vars.APP_DOMAIN }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: web/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps: [ { uses: actions/deploy-pages@v4 } ]
```

If GitHub Pages serves under a subpath (`/<repo>/`), set Vite `base` accordingly.

**Done when:** the public GitHub Pages URL gives a fully working IDE (highlight, validation,
completion, generation) talking to the VPS over `wss`.

---

### M7 — Hardening (required for "open to the world")

- **Per-session JVM cap:** keep `-Xmx512m` and `MAX_SESSIONS` so concurrent servers fit in
  4 GB (≈ 6–8 sessions). Return WebSocket close code 1013 when full (already in skeleton).
- **Idle timeout:** kill a language-server child process and close the socket after N minutes
  of no traffic, so abandoned tabs don't pin memory.
- **Request limits:** cap `/generate` body size (done) and add a basic rate limit
  (per-IP) in front of `/generate`.
- **CORS:** restrict `/generate` to the GitHub Pages origin.
- **No secrets in the client.** Nothing sensitive ships to the browser.
- **Restart policy:** `restart: unless-stopped` on both compose services.
- **Backups:** the only stateful thing is Caddy's cert volume; everything else is rebuildable
  from the repo.

**Done when:** the documented hardening items are in place and a soak test (several concurrent
editors + a flurry of generate calls) stays within memory and recovers cleanly after
`docker compose restart`.

---

## 5. Acceptance checklist (final)

- [ ] Public URL loads the editor with SymboleoAC syntax highlighting.
- [ ] Typing invalid SymboleoAC produces live diagnostics from the Xtext validator.
- [ ] Code completion suggestions appear (proves real LSP round-trip, not just Monarch).
- [ ] "Generate" returns JavaScript identical to what the existing CLI jar produces.
- [ ] All traffic is `https`/`wss`; no mixed-content errors in the browser console.
- [ ] `docker compose restart` restores service with no manual steps.
- [ ] `VERSIONS.md` records every pinned version, including Xtext/lsp4j and the client's LSP spec.
- [ ] Monthly cost is the VPS only (~6 CAD); front end and CI are free.

---

## 6. Known pitfalls (consult when stuck)

1. **`ws://` vs `wss://`.** Works locally, blocked in production. Always `wss` from Pages.
2. **LSP version skew.** If diagnostics/completion are silently absent, compare the Xtext
   `lsp4j` LSP version with the client's `vscode-languageclient` version.
3. **v10 API drift.** `monaco-languageclient` v10 separates `vscodeApiWrapper`, the language
   client wrapper, and the editor app, and `monaco-vscode-api` init can run only once per page
   lifecycle. Follow the installed version's example, not memory.
4. **JVM cold start.** First completion after a new session can lag while the JVM warms; this
   is expected. Do not "fix" it by adding a sleeping free-tier host — that reintroduces the
   fragility we are avoiding. Keep the always-on VPS.
5. **Don't resurrect the old Xtext-Web servlet (ace/codemirror) approach.** It is the
   deprecated path; LSP + Monaco is the supported one.

## 7. Optional enhancement (not required for first release)

Move code generation from the `/generate` REST endpoint into an in-editor LSP command using
Xtext's `IExecutableCommandService` (`workspace/executeCommand`). This puts "Generate" inside
the editor command palette instead of a side button. Only attempt after the acceptance
checklist passes; the REST endpoint is the lower-risk baseline because it reuses the existing,
tested CLI jar.
