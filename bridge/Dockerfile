# Turnkey image: builds the JVM jars AND the bridge from source, so a VPS only
# needs Docker (no JDK/Maven/Node on the host). Build context is the repo root
# (see infra/docker-compose.yml `context: ..`).
#
#   docker compose -f infra/docker-compose.yml up -d --build
#
# ── Stage 1: build the LSP server + codegen fat jars with Maven ──────────────
FROM maven:3.9-eclipse-temurin-17 AS jars
WORKDIR /build
# The poms compile against the vendored upstream sources (runtime + .ide/src-gen)
# via the relative path ../upstream/SymboleoAC-IDE, so the layout must match.
COPY upstream/ ./upstream/
COPY language-server/ ./language-server/
COPY codegen-cli/ ./codegen-cli/
RUN mvn -B -q -f language-server/pom.xml clean package \
 && mvn -B -q -f codegen-cli/pom.xml clean package

# ── Stage 2: compile the bridge TypeScript ──────────────────────────────────
FROM node:20-bookworm-slim AS bridge-build
WORKDIR /app
COPY bridge/package.json bridge/package-lock.json* ./
RUN npm ci --no-fund --no-audit
COPY bridge/tsconfig.json ./
COPY bridge/src ./src
RUN npm run build

# ── Stage 3: runtime — Node (bridge) + JRE (spawns the jars) ─────────────────
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends default-jre-headless \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=bridge-build /app/node_modules ./node_modules
COPY --from=bridge-build /app/build ./build
COPY --from=bridge-build /app/package.json ./package.json
COPY --from=jars /build/language-server/target/symboleoac-language-server-1.0.0-all.jar /app/jars/symboleoac-language-server.jar
COPY --from=jars /build/codegen-cli/target/symboleoac-codegen-cli-1.0.0-all.jar          /app/jars/symboleoac-codegen.jar
ENV LS_JAR=/app/jars/symboleoac-language-server.jar
ENV CODEGEN_JAR=/app/jars/symboleoac-codegen.jar
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build/index.js"]
