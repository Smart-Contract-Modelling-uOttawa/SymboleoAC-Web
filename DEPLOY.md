# Deploying SymboleoAC-Web

Two pieces deploy independently:

- **Frontend** → GitHub Pages (free, static). Milestone **M6**.
- **Backend** → a single small VPS running Docker (bridge + Caddy). Milestone **M5**.

They meet over `wss://` / `https://`. The frontend is *baked* at build time with
the backend's URL, so **set the backend domain first**, then build Pages.

---

## Prerequisites (one-time)

- A **domain you control** for the backend, e.g. `symboleoac.example.org`.
  GitHub Pages' `*.github.io` cannot host the backend — Caddy must prove
  ownership of a real name to get a Let's Encrypt cert. A subdomain of any
  domain the lab already owns is fine.
- A VPS (target: Hetzner CX22, 2 vCPU / 4 GB ≈ €4/mo) with a public IP.

---

## M6 — Frontend on GitHub Pages

### 1. Create the repo and push

On GitHub, create an **empty** repo `SymboleoAC-Web` under
`Smart-Contract-Modelling-uOttawa` (no README/license, so the first push is clean).
Then from this working copy:

```powershell
git remote add origin https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Web.git
git push -u origin main
```

### 2. Enable Pages

Repo **Settings → Pages → Build and deployment → Source = GitHub Actions**.

### 3. Set repository variables

Repo **Settings → Secrets and variables → Actions → Variables → New variable**:

| Variable | Value | Why |
|---|---|---|
| `APP_DOMAIN` | `symboleoac.example.org` | backend host; baked into `VITE_LSP_URL=wss://…/lsp` and `VITE_API_URL=https://…` |
| `PAGES_BASE` | `/SymboleoAC-Web/` | **required** — this is a *project* page served under a subpath, so Vite's `base` must match or all assets 404 |

> Set these **before** the build. If you push first, re-run the workflow
> (Actions → deploy-web → Run workflow) after adding them.

### 4. Deploy

The `.github/workflows/deploy-web.yml` workflow runs automatically on pushes that
touch `web/**`, or manually via **Actions → deploy-web → Run workflow**.

**Result:** `https://smart-contract-modelling-uottawa.github.io/SymboleoAC-Web/`

Until the backend (M5) is live, the site loads with **client-side syntax
highlighting** but diagnostics/completion/generate won't work (no backend yet).
That's expected — bring up M5 next.

---

## M5 — Backend on a VPS (Docker + Caddy TLS)

### 1. Provision + install Docker

Create the VPS (Ubuntu 24.04). Then:

```bash
curl -fsSL https://get.docker.com | sh        # Docker Engine + compose plugin
sudo usermod -aG docker $USER                  # log out/in so `docker` needs no sudo
```

### 2. DNS

Point the backend subdomain at the VPS IP:

```
A     symboleoac.example.org   ->  <VPS_IPv4>
AAAA  symboleoac.example.org   ->  <VPS_IPv6>   (if available)
```

Open ports **80** and **443** (Caddy needs both for the ACME challenge + serving).

### 3. Clone and bring it up

The image builds everything from source (jars via Maven, bridge via Node) — the
VPS needs **only Docker**:

```bash
git clone https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Web.git
cd SymboleoAC-Web
APP_DOMAIN=symboleoac.example.org \
ALLOW_ORIGIN=https://smart-contract-modelling-uottawa.github.io \
  docker compose -f infra/docker-compose.yml up -d --build
```

- `APP_DOMAIN` (a real FQDN) makes Caddy auto-provision a Let's Encrypt cert and
  serve `https://` + `wss://`.
- `ALLOW_ORIGIN` locks the `/generate` CORS header to your Pages origin. Note the
  origin is `https://<owner>.github.io` (scheme + host only — **no** `/SymboleoAC-Web`
  path).

The first `--build` takes a few minutes (Maven pulls the Xtext deps once).

### 4. Verify

```bash
curl https://symboleoac.example.org/healthz      # {"ok":true,...} with a valid cert
```

From the deployed Pages site, the editor should now show live diagnostics +
completion, and **Generate JS** should return files — all over `wss`/`https`,
no mixed-content errors in the browser console.

### 5. Operate

```bash
docker compose -f infra/docker-compose.yml logs -f          # tail logs
docker compose -f infra/docker-compose.yml restart          # M7 recovery: comes back clean
docker compose -f infra/docker-compose.yml pull && \
  docker compose -f infra/docker-compose.yml up -d --build   # redeploy after a git pull
```

Only stateful thing is Caddy's cert volume (`caddy_data`); everything else is
rebuildable from the repo. Both services are `restart: unless-stopped`.

---

## If the backend domain changes

The frontend bakes the URL at build time, so update the `APP_DOMAIN` repo
variable and re-run the **deploy-web** workflow, and restart the VPS stack with
the new `APP_DOMAIN`.

## Hardening knobs (M7)

Tune via env on the `bridge` service in `infra/docker-compose.yml`:
`MAX_SESSIONS`, `JVM_XMX`, `IDLE_TIMEOUT_MS`, `RATE_MAX`, `RATE_WINDOW_MS`,
`MAX_CONCURRENT_GEN`, `GEN_TIMEOUT_MS`, `BODY_LIMIT`, `ALLOW_ORIGIN`.
Defaults fit a 4 GB box (~6–8 concurrent LSP sessions at `-Xmx512m`).
