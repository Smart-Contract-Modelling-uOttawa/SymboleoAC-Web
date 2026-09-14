# Releasing SymboleoAC-Web

One version number covers the whole deliverable: the front end (`web/`), the
bridge (`bridge/`), the language-server jar and the codegen jar. A release is a
git tag `vX.Y.Z` on `main`, a GitHub Release with notes and assets, and the two
deployments (Pages, VPS) at that commit.

Semantic Versioning, applied to what users see:

| Bump | When |
|---|---|
| **major** | the `.symboleo` language accepted changes incompatibly (new upstream grammar), or the bridge API (`/lsp`, `/generate`, `/model`) changes shape |
| **minor** | a new feature (view, explanation style, export, editor service, sample) |
| **patch** | fixes, wording, colours, documentation, dependency bumps |

## Checklist

### 1. Prepare `main`

- [ ] Working tree clean, `main` up to date, Pages workflow green for the last push.
- [ ] `CHANGELOG.md`: move the *Unreleased* items into a new `## [X.Y.Z] — YYYY-MM-DD` section, grouped as in earlier releases; add the compare links at the bottom.
- [ ] Bump the version in the four places that carry it and keep them equal:
  `web/package.json` (+ `package-lock.json`), `bridge/package.json` (+ lock),
  `language-server/pom.xml`, `codegen-cli/pom.xml`. The jar names follow the pom
  version (`symboleoac-*-X.Y.Z-all.jar`); `bridge/Dockerfile` and `DEPLOY.md`
  reference them, so grep for the old version string:
  ```bash
  git grep -n "1\.0\.0" -- ':!CHANGELOG.md' ':!upstream' ':!**/package-lock.json'
  ```
- [ ] `VERSIONS.md` reflects any dependency change made since the last release.
- [ ] `upstream/UPSTREAM_PROVENANCE.md` names the vendored SymboleoAC-IDE commit actually in the tree.
- [ ] Commit: `Release vX.Y.Z`.

### 2. Build and verify from the release commit

```powershell
# Jars (kill any running LSP JVM first: Windows locks the jar)
$env:MAVEN_OPTS = "-Djavax.net.ssl.trustStoreType=Windows-ROOT"
cd language-server ; mvn -B clean package ; cd ..
cd codegen-cli     ; mvn -B clean package ; cd ..

# Bridge + probes against a local bridge on :3030 (see README "Verifying the backend")
cd bridge ; npm ci ; npm run build ; cd ..
node bridge/test-ws.mjs ws://localhost:3030/lsp
node bridge/test-diagnostics.mjs ws://localhost:3030/lsp
node bridge/test-completion.mjs ws://localhost:3030/lsp
node bridge/test-explain.mjs http://localhost:3030
node bridge/test-definition.mjs ws://localhost:3030/lsp
node bridge/test-rename-hover.mjs ws://localhost:3030/lsp
node bridge/test-semantic-tokens.mjs ws://localhost:3030/lsp

# Front end
cd web ; npm ci ; npm run build ; cd ..

# Verbalizer coverage (optional; regenerates tools/explain-corpus/out)
bash tools/explain-corpus/build-corpus.sh
```

### 3. Tag and publish

```bash
git tag -a vX.Y.Z -m "SymboleoAC-Web vX.Y.Z"
git push origin main vX.Y.Z
gh release create vX.Y.Z \
  --title "SymboleoAC-Web vX.Y.Z" \
  --notes-file <release-notes.md> \
  language-server/target/symboleoac-language-server-X.Y.Z-all.jar \
  codegen-cli/target/symboleoac-codegen-cli-X.Y.Z-all.jar \
  web/public/docs/VaccineProcurementC-documentation.html
```

Release notes = the CHANGELOG section for the version, preceded by the live URL
and followed by a short "Assets" paragraph (what the jars are, JDK 17+ needed,
how to run them: `java -jar …language-server…-all.jar` speaks LSP on stdio;
`java -jar …codegen-cli…-all.jar --in spec.symboleo` (add `--model` for the structured model)). Mark pre-releases with `--prerelease`.

### 4. Deploy

- **Pages** deploys itself on the push to `main` (only if `web/**` changed; otherwise trigger the `deploy-web` workflow by hand so the footer/version shown matches).
- **VPS**: `ssh root@<VPS>`, `git fetch --tags && git checkout vX.Y.Z` (or `git pull` if the box tracks `main`), then
  `APP_DOMAIN=… ALLOW_ORIGIN=… docker compose -f infra/docker-compose.yml up -d --build`.
  Run the probes from DEPLOY.md §6 against `wss://<APP_DOMAIN>/lsp` and `https://<APP_DOMAIN>`.

### 5. After the release

- [ ] Start a new *Unreleased* section in `CHANGELOG.md`.
- [ ] Close the milestone / issues shipped, referencing the release.

## Hotfixes

Branch from the tag (`git checkout -b hotfix/X.Y.Z+1 vX.Y.Z`), fix, bump the
patch version, merge to `main`, and release as above. The VPS and Pages must
end up at the same commit.
