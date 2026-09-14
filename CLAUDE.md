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
# CLI (validator) fat jar  → upstream/SymboleoAC-IDE/cli/target/symboleo-cli-1.1.0-all.jar
$env:MAVEN_OPTS = "-Djavax.net.ssl.trustStoreType=Windows-ROOT"
cd upstream\SymboleoAC-IDE\cli ; mvn -B clean package

# LSP server fat jar  → language-server/target/symboleoac-language-server-1.1.0-all.jar
cd language-server ; mvn -B clean package

# Smoke-test LSP handshake over stdio
cd language-server ; node test-handshake.mjs target/symboleoac-language-server-1.1.0-all.jar
```

## Deploy

See `DEPLOY.md` for the full M5 (VPS/Caddy) + M6 (GitHub Pages) runbook.
- **Redeploy rule** (DEPLOY.md §6): a push to `main` touching `web/**` is deployed by the
  `deploy-web` workflow automatically (Pages). A commit touching `language-server/**`,
  `codegen-cli/**`, `bridge/src/**`, `bridge/Dockerfile`, `bridge/package*.json`, `infra/**`
  or `upstream/**` needs a VPS redeploy: `ssh root@<VPS>`, `git pull`, then
  `docker compose -f infra/docker-compose.yml up -d --build` (APP_DOMAIN / ALLOW_ORIGIN as
  in DEPLOY.md). Test scripts and Markdown need no deployment. After a VPS redeploy, run
  the bridge probes against `wss://<APP_DOMAIN>/lsp` and `https://<APP_DOMAIN>`.
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

## Explain tab (plain-language explanations)

- Plan and design rationale: `EXPLAIN-PLAN.md`; style prototype: `docs/explain-styles.html`.
- `codegen-cli/.../ExplainJson.java` adds an `explain` block (structured, resolved model of
  every norm + contract-level facts) and a `diagnostics` block to `--model` output. Wording
  lives ONLY in `web/src/explain/verbalize.ts`; keep Java free of English sentences.
- The tab shows explanations only when `diagnostics.errors == 0` (warnings tolerated).
- Identifiers are shown exactly as written (never humanized/split); the declared type may
  follow in parentheses. Event verbs come from the `EVENT_VERBS` lexicon in `verbalize.ts`.
- Markdown export (`markdown.ts`) shares the slot logic with the view; keep them in sync.
- `gherkin.ts` renders the explanation model as Gherkin (Feature/Background/Rule/Scenario/
  Scenario Outline, Given/When/Then, quoted identifiers); it is style C in the tab, the
  `.feature` export, and is checked against `@cucumber/gherkin` (bridge devDependency) by
  `tools/explain-corpus`. Keep it to Gherkin keywords only.
- `document.ts` builds the integrated documentation (one HTML file, no network); it reuses
  `buildClassDiagramDef`, `buildRulesDiagramDef` and `matrixTableHtml` from `web/src/model`,
  so changes to those views flow into the export automatically.
- Specifier comments directly above a norm become "Specifier's note"; generated text never
  mixes with them. Comments that look like commented-out code are dropped.
- Verify with `node bridge/test-explain.mjs http://localhost:3030` against a running bridge.

## Compare (baseline vs. current, issue #15)

- `web/src/explain/diff.ts`: `compareModels(baseModel, curModel, name)` aligns declarations,
  parameters, domain types, access rules and norms by name, then detects renames on the
  normalized model (identical signature after blanking the item's own name) and applies
  declaration/rule renames before comparing norms. Norm changes are expressed as fact-sheet
  slot changes (lists: added/removed items keyed on their plain text; scalars: before/after),
  so the diff wording is the verbalizer's. `lineDiff` (LCS) feeds the editor gutter.
- `App.tsx` owns the baseline `{name, source}`, fetches its `/model` once, computes the diff
  with `useMemo`, and passes it to `ExplainView` (Changes block, badges, inline marks) and
  `Outline` (A/M/R marks, removed entries). The diff is `null` while either side has errors.
- `editor/DiffPane.tsx` is a Monaco diff editor whose *modified* side is the main editor's
  model (shared, so the language client keeps working); the main `EditorPane` stays mounted
  (display: none) while the diff shows. No `theme` option, as for every other editor.
- `editor/gutter.ts` decorates the main editor with `linesDecorationsClassName` bars.
- `model/changes.tsx` + optional `changes` argument of `buildClassDiagramDef` / `buildRulesDiagramDef`
  and the `Matrix` view: behind a per-view "Changes" toggle (localStorage), unchanged elements are
  dimmed (grey classDef/style, never opacity: text must dim too), added ones get a white 3px
  stroke, removed ones come from the baseline model as dashed ghosts, labels carry +/~/−/old → new
  badges. Do not add hues: category, Grant/Revoke and solid/dotted are already taken. Mermaid
  class labels use `class Id["label"]` with members on `Id : member` lines (a label and a body
  cannot share one statement). The documentation export calls the builders without `changes`.
- Gherkin diff: `gherkin.ts` `gherkinNormDiff(oldNorm, oldSlots, n, s, renames)` line-diffs the two
  renderings (keys: kind|keyword|text) and reports changed/added/removed scenarios; `NormChange`
  carries `oldNorm` and `old` (renamed slots) for it. `document.ts` takes `opts.diff` and emits a
  "Changes" section (`changesHtml`), norm badges and marked Gherkin lines; `ExplainView` passes `diff`.
- Dev-only hook for browser checks: `window.__symboleoac.setSource(text)` / `getSource()`
  (guarded by `import.meta.env.DEV`; the Monaco textarea is not reachable by synthetic paste).

## Language-client lifecycle (keep-alive + reconnection)

- `web/src/editor/lspLifecycle.ts` (attached in `EditorPane` via `onLanguageClientsStartDone`):
  watches the client's state; on `Stopped` it calls `wrapper.restart()` with backoff while
  the tab is visible, and on `visibilitychange` for hidden tabs. Every 4 min a visible tab
  sends the `symboleoac/keepAlive` notification, which the bridge counts as activity and
  drops (never forwarded to the JVM). Do not rely on `restartOptions`: monaco-languageclient
  10.7's `initRestartConfiguration` registers `() => restartLC` (a no-op).
- `App.tsx` shows the state as a dot + text in the header (`onConnectionState`).
- Dev-only inspection: `window.__symboleoacLsp.{state,started,attempts,reconnect,request,markers}`.
- Themes: `editor/theme.ts` defines several themes (`THEMES`); `currentThemeId()` is persisted
  in localStorage, `selectTheme(id)` applies it globally, and `EditorPane`'s `editorOptions.theme`
  uses `currentThemeId()` at boot. `document.ts` builds its stylesheet with `cssFor(currentTheme())`,
  so the exported specification block follows the selected theme (base, syntax and semantic colours).

## Go to Definition / References / Hover / Rename (language server)

- The upstream grammar refers to variables, norms and rules by plain `ID` (e.g.
  `VariableRef: variable=ID`), not Xtext cross-references, so the stock Xtext services
  find nothing at such references. `language-server/.../lsp/` adds name-based fallbacks,
  all bound in `SymboleoLspSetup` and sharing `SymboleoNames` (identifier under cursor,
  declarations by name, occurrences, kind descriptions):
  - `SymboleoSymbolService` (DocumentSymbolService): definition + references.
  - `SymboleoHoverService` (HoverService/IHoverService): kind, line, declaration excerpt,
    and the specifier's comment above a norm.
  - `SymboleoRenameService` (IRenameService2): prepareRename + rename of all identifier
    tokens with that name (comments and attribute names after "." untouched); refuses
    invalid identifiers, keywords and already-declared names.
  - `SymboleoHighlightingCalculator` (ISemanticHighlightingCalculator, consumed by Xtext's
    `SemanticTokensService`): LSP semantic tokens — class/enum/enumMember for types,
    property for attributes, parameter, variable (roles, assets, data transfers), event
    (event instances), function (obligations, powers), macro (rules); `declaration`
    modifier at declaration sites. The web editor enables
    `editor.semanticHighlighting.enabled` in `EditorPane.tsx`'s `vscodeApiConfig`.
    Colours come from `web/src/editor/theme.ts` (`symboleoac-dark` and variants, matched by
    semantic token TYPE NAME, not TextMate scope). Monaco's theme is global and the React
    wrapper re-applies `editorOptions` on every config pass, so `editorOptions.theme` must be
    the selected SymboleoAC theme (all defined in `onVscodeApiInitDone`) and no other
    `monaco.editor.create(...)` may pass a `theme` option.
  Attribute names after "." and `obligations.X` are real cross-references and stay with
  Xtext (definition, hover description and rename all work for them too).
- Verify against a running bridge: `node bridge/test-definition.mjs`,
  `node bridge/test-rename-hover.mjs`, `node bridge/test-semantic-tokens.mjs`,
  `node bridge/test-lsp-nav.mjs`. Rebuilding the LS
  jar requires killing running LSP JVMs (and the old bridge `node` process) first — Windows
  locks the jar and `TaskStop` on `npx tsx` leaves the child `node` alive on :3030.

## Ground rules (carry-over from BUILD-PLAN)

1. Pin every version in `VERSIONS.md`.
2. Verify each milestone with a running system, not by reasoning.
3. `wss://` only in production (browser blocks `ws://` from an HTTPS origin).
4. Keep the LSP spec versions aligned between the lsp4j inside the server
   and the `vscode-languageclient` inside the browser. Currently lsp4j 0.23.1
   (LSP 3.17). The Monaco client's `vscode-languageclient` must also target 3.17.
