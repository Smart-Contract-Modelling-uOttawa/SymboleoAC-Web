# SymboleoAC Web IDE — agent notes

Companion to `symboleoac-web-BUILD-PLAN.md`. Read the plan for the full brief;
this file captures decisions and discoveries that shape day-to-day work.

## Upstream realities (verified against the cloned repo)

- Upstream lives in `upstream/SymboleoAC-IDE/` (shallow clone of
  `Smart-Contract-Modelling-uOttawa/SymboleoAC-IDE`).
- Eclipse project names are `ca.uottawa.csmlab.symboleo{,.ide,.tests,.ui,.ui.tests}`.
- File extension is `.symboleo`.
- The **runtime project's** `src-gen/` and `xtend-gen/` ARE checked in.
- The **`.ide` project's** `src-gen/` is NOT checked in. MWE2 must be run in
  Eclipse to regenerate it (upstream `cli/README.md` documents why MWE2 cannot
  run headlessly on JDK 17+). We therefore mix `DefaultIdeModule` into the
  runtime module instead — see `language-server/src/.../SymboleoLspSetup.java`.
- **Completion: RESOLVED (was empty under DefaultIdeModule).** Grammar-driven
  content assist needs the content-assist ANTLR parser from `.ide/src-gen`,
  which upstream doesn't ship. The user ran the Eclipse MWE2 bootstrap and
  committed `ca.uottawa.csmlab.symboleo.ide/src-gen/` (history in
  `language-server/IDE-COMPLETION-BOOTSTRAP.md`). The language server now:
  - adds `.ide/src` + `.ide/src-gen` to the Maven build (`add-ide-sources`),
  - `SymboleoLspSetup` subclasses the generated `SymboleoIdeSetup` (real
    `SymboleoIdeModule`, not `DefaultIdeModule`).
  Verified end-to-end through Caddy→container: completion at doc start → `Domain`;
  in a contract body → `Declarations, Obligations, Postconditions, Preconditions`.
  IMPORTANT: only `.ide/src-gen`'s `*.tokens`/`*.g` are pulled in as resources —
  NOT its `META-INF/services/org.eclipse.xtext.ISetup`, so `SymboleoLspSetup`
  stays the single registered ISetup. The runtime MANIFEST also needed
  `org.apache.commons.logging` added to `Import-Package` for MWE2 to run.
- The existing `cli/` is a **validator only** (text/JSON diagnostics). For
  code generation we have to either extend it or add a new CLI module.
- **The JS code generator is `Symboleo2SC.xtend → generateHFSource`.** It
  imports from `"symboleoac-js-core"` and emits a multi-file Node-style JS
  package per contract: `<Contract>/index.js`, `<Contract>/package.json`,
  `<Contract>/domain/contract/<Contract>.js`, `<Contract>/domain/assets/*.js`,
  `<Contract>/domain/events/*.js`, `<Contract>/domain/roles/*.js`,
  `<Contract>/domain/types/*.js`, `<Contract>/serializer.js`,
  `<Contract>/events.js`.
- `SymboleoGenerator.doGenerate` invokes both `Symboleo2SC` (JS) AND
  `SymboleoPCGenerator` (nuXmv). **The nuXmv path is legacy from the old
  Symboleo language and is NOT supported for SymboleoAC** — skip it: invoke
  `Symboleo2SC.generateHFSource` directly, not the umbrella `SymboleoGenerator`.
- LSP server NPEs if it gets a `rootUri`/`workspaceFolders` URI it can't
  map to a real filesystem path. On Windows, `file:///workspace` parses as
  the UNC `\\workspace` (invalid sharename); on Linux it's `/workspace`
  (doesn't exist). **Solution lives in the bridge**: per-session
  `mkdtempSync` + intercept the `initialize` message to substitute that
  tmp URI for both `rootUri` and `workspaceFolders[0].uri`. Don't try to
  fix it client-side — the client has no business knowing about the
  bridge host's filesystem.
- `monaco-editor-wrapper` is DEPRECATED (Dec 2025). Use
  `monaco-languageclient` v10 + `@typefox/monaco-editor-react` v7.7+
  directly. The v9 stack with the wrapper still installs but emits a
  deprecation warning.

- The earlier sibling repo `Symboleo-web` exists for the *old* Symboleo
  (it had both JS and nuXmv codegen). This project — `SymboleoAC-Web` — is
  for the *new* SymboleoAC language and is JS-only.

## Repo layout (current)

```
SymboleoAC-Web/
├─ symboleoac-web-BUILD-PLAN.md   # original brief
├─ CLAUDE.md                       # this file
├─ VERSIONS.md                     # pinned versions
├─ upstream/SymboleoAC-IDE/        # vendored upstream (shallow git clone)
├─ language-server/                # M1 — Maven module that produces the LSP uber-jar
│  ├─ pom.xml
│  ├─ src/main/java/.../SymboleoLspSetup.java
│  ├─ src/main/resources/META-INF/services/org.eclipse.xtext.ISetup
│  └─ test-handshake.mjs           # stdio LSP smoke test
├─ bridge/                         # M2 — Node WebSocket↔stdio LSP bridge
├─ web/                            # M3 — Monaco front end (Vite)
├─ infra/                          # M4–M5 — docker-compose + Caddyfile
└─ .github/workflows/              # M6 — Pages deploy
```

## Build commands

```powershell
# CLI (validator) fat jar  → upstream/SymboleoAC-IDE/cli/target/symboleo-cli-1.0.0-all.jar
$env:MAVEN_OPTS = "-Djavax.net.ssl.trustStoreType=Windows-ROOT"
cd upstream\SymboleoAC-IDE\cli ; mvn -B clean package

# LSP server fat jar  → language-server/target/symboleoac-language-server-1.0.0-all.jar
cd language-server ; mvn -B clean package

# Smoke-test LSP handshake over stdio
cd language-server ; node test-handshake.mjs target/symboleoac-language-server-1.0.0-all.jar
```

## Deploy

See `DEPLOY.md` for the full M5 (VPS/Caddy) + M6 (GitHub Pages) runbook.
- `bridge/Dockerfile` is **turnkey/self-building**: a Maven stage compiles both
  jars from the vendored upstream sources, so the VPS needs only Docker
  (`docker compose -f infra/docker-compose.yml up -d --build`). Verified that
  the in-Docker-built jar serves completion correctly.
- `upstream/` is vendored as plain files (no nested `.git`); provenance +
  local modifications recorded in `upstream/UPSTREAM_PROVENANCE.md`.
- Root `.gitignore` / `.dockerignore` exclude build outputs, node_modules, jars,
  and the generated `web/src/editor/symboleoac.monarch.ts`.

## Environment caveats (this dev machine)

- **Corporate TLS interception** breaks both npm and Maven against their
  default trust stores. Workarounds in use:
  - Maven: `$env:MAVEN_OPTS = "-Djavax.net.ssl.trustStoreType=Windows-ROOT"`
  - npm: `npm config set strict-ssl false` (set in `bridge/` and `web/`).
    The proper fix is `NODE_EXTRA_CA_CERTS=<corp-root.pem>`; strict-ssl=false
    is the expedient local choice. Do NOT carry this into CI — GitHub runners
    have a clean trust store.
- Docker Desktop (WSL2) is installed; `docker` + `docker compose` (v2) work
  from PowerShell. The bridge image builds the JRE via Debian `apt-get` with
  no TLS issue (BuildKit uses its own CA bundle).

## Bridge hardening (M7, implemented + verified)

- Per-session JVM cap: `MAX_SESSIONS` (close code 1013 when full).
- Idle reaper: closes LSP sockets idle > `IDLE_TIMEOUT_MS` (default 10 min);
  `forward()`'s onClose cascade kills the JVM child (`process.kill`).
- `/generate`: per-IP fixed-window rate limit (`RATE_MAX`/`RATE_WINDOW_MS`,
  429 + Retry-After) and a concurrency cap (`MAX_CONCURRENT_GEN`, 503 busy).
- Body cap (`BODY_LIMIT`, 2 mb) and CORS (`ALLOW_ORIGIN`, lock to the Pages
  origin in prod).
- `restart: unless-stopped` on both compose services; only stateful thing is
  Caddy's cert volume.
- Verify scripts in `bridge/`: `test-ws.mjs`, `test-diagnostics.mjs`,
  `test-completion.mjs`, `test-ratelimit.mjs`, `test-idle.mjs`,
  `test-generate.mjs`.

## Ground rules (carry-over from BUILD-PLAN)

1. Pin every version in `VERSIONS.md`.
2. Verify each milestone with a running system, not by reasoning.
3. `wss://` only in production (browser blocks `ws://` from an HTTPS origin).
4. Keep the LSP spec versions aligned between the lsp4j inside the server
   and the `vscode-languageclient` inside the browser. Currently lsp4j 0.23.1
   (LSP 3.17). The Monaco client's `vscode-languageclient` must also target 3.17.
