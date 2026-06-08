# SymboleoAC bridge

Node service that fronts the JVM language tooling for the browser IDE:

- `WS /lsp` — upgrades to a WebSocket, spawns one `java -jar <LS_JAR>` per
  session, and pipes LSP JSON-RPC both ways (`vscode-ws-jsonrpc`). It rewrites
  the `initialize` message's `rootUri`/`workspaceFolders` to a per-session
  temp dir so Xtext's workspace scanner has a real path (see CLAUDE.md).
- `POST /generate` — body `{ "source": "<.symboleo text>" }`. Shells out to
  `java -jar <CODEGEN_JAR>` (stdin → stdout JSON) and returns
  `{ files: { "<Contract>/<path>": "<js>" }, issues: [...], summary: {...} }`.
  - `200` generated OK · `422` validation errors (no files, issues populated)
  - `400` missing source · `429` rate-limited · `503` too many concurrent
    generations · `504` codegen timeout.
- `GET /healthz` — `{ ok, activeSessions, maxSessions, activeGenerations }`.

## Codegen invocation (the CLI the bridge calls)

```
java -jar codegen-cli/target/symboleoac-codegen-cli-1.0.0-all.jar [--in <file>] [--name <virtual>]
```

Source from `--in` or stdin; emits the JSON shape above. It invokes
`Symboleo2SC.generateHFSource` directly (JS codegen) — NOT the umbrella
`SymboleoGenerator`, which also runs the legacy nuXmv path. Strips a leading
UTF-8 BOM (the upstream samples ship one) before parsing.

## Run locally (without Docker)

```powershell
$env:LS_JAR      = (Resolve-Path ../language-server/target/symboleoac-language-server-1.0.0-all.jar).Path
$env:CODEGEN_JAR = (Resolve-Path ../codegen-cli/target/symboleoac-codegen-cli-1.0.0-all.jar).Path
npm run build ; node build/index.js     # listens on :3000 (override with PORT)
```

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `LS_JAR` | — (required) | path to the language-server fat jar |
| `CODEGEN_JAR` | — (required) | path to the codegen fat jar |
| `PORT` | `3000` | listen port |
| `MAX_SESSIONS` | `8` | concurrent LSP sessions (1013 when full) |
| `JVM_XMX` | `512m` | per-LSP-session heap |
| `ALLOW_ORIGIN` | `*` | CORS allow-origin for `/generate` (lock to Pages origin in prod) |
| `BODY_LIMIT` | `2mb` | max `/generate` body |
| `GEN_TIMEOUT_MS` | `30000` | codegen subprocess wall-clock cap |
| `IDLE_TIMEOUT_MS` | `600000` | reap LSP sessions idle this long |
| `RATE_WINDOW_MS` | `60000` | `/generate` per-IP window |
| `RATE_MAX` | `20` | max `/generate` requests per window per IP |
| `MAX_CONCURRENT_GEN` | `4` | cap simultaneous codegen JVMs |

## Verify scripts

```powershell
node test-ws.mjs           ws://localhost:3000/lsp   # initialize handshake
node test-diagnostics.mjs  ws://localhost:3000/lsp   # publishDiagnostics round-trip
node test-completion.mjs   ws://localhost:3000/lsp   # completion items (0 until .ide bootstrap)
node test-generate.mjs                               # POST /generate sample
node test-ratelimit.mjs    http://localhost:3000 25  # 429 after RATE_MAX
node test-idle.mjs         ws://localhost:3000/lsp   # reaper closes idle socket
```
