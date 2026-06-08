# Pinned versions

Updated as milestones land. Never use `latest` anywhere.

## JVM / build

| Component | Version | Source |
|---|---|---|
| JDK | 21 (Temurin) | local dev; Docker uses `default-jre-headless` (Debian bookworm, JRE 17) |
| Maven | 3.9.16 | local dev |

## Xtext / LSP server

| Component | Version | Notes |
|---|---|---|
| Xtext | 2.36.0 | matches upstream `cli/pom.xml` |
| Xtend | 2.36.0 | matches upstream |
| MWE2 | 2.22.0 | bootstrap-only; not run by our build |
| `org.eclipse.lsp4j` | 0.23.1 | transitive dep of `org.eclipse.xtext.ide:2.36.0`. **LSP spec ≈ 3.17** |
| `org.eclipse.lsp4j.jsonrpc` | 0.23.1 | same |
| Guice | 5.0.1 | matches upstream |
| log4j (1.2 shim) | 2.17.2 | matches upstream |

LSP server uber-jar Main-Class: `org.eclipse.xtext.ide.server.ServerLauncher`.
Language registered via `META-INF/services/org.eclipse.xtext.ISetup` →
`ca.uottawa.csmlab.symboleo.lsp.SymboleoLspSetup`.

## Bridge (M2)

| Component | Version | Notes |
|---|---|---|
| Node | 22.14 local dev; 20-bookworm-slim in Docker | |
| `express` | 4.21.2 | |
| `ws` | 8.18.0 | |
| `vscode-jsonrpc` | 8.2.1 | pulled in by vscode-ws-jsonrpc |
| `vscode-languageserver-protocol` | 3.17.5 | **LSP spec 3.17 — must match lsp4j 0.23.1 on the server** |
| `vscode-ws-jsonrpc` | 3.4.0 | `createServerProcess` / `forward` API |
| `typescript` | 5.7.2 | |
| `tsx` | 4.19.2 | dev only |
| `@types/express` | 4.17.21 | |
| `@types/node` | 20.14.10 | |
| `@types/ws` | 8.5.12 | |

## Web (M3)

| Component | Version | Notes |
|---|---|---|
| `monaco-languageclient` | 10.7.0 | v10 stack (no monaco-editor-wrapper — that one is deprecated as of 2025-12) |
| `@typefox/monaco-editor-react` | 7.7.0 | direct dep on monaco-languageclient v10 subpath exports |
| `monaco-editor` | 0.52.2 | |
| `vscode-languageclient` | 9.0.1 | LSP spec 3.17 — matches lsp4j 0.23.1 on server |
| `vscode-languageserver-protocol` | 3.17.5 | |
| `vscode-ws-jsonrpc` | 3.4.0 | |
| `vscode-jsonrpc` | 8.2.1 | |
| `jszip` | 3.10.1 | for codegen download |
| `react` / `react-dom` | 18.3.1 | |
| `vite` | 5.4.10 | |
| `@vitejs/plugin-react` | 4.3.4 | |
| `typescript` | 5.7.2 | |
| `@codingame/monaco-vscode-*` | 25.1.2 | 15 service-override packages, pulled transitively |
