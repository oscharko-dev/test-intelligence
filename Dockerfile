# syntax=docker/dockerfile:1
#
# Standalone Test Intelligence container image (Issue #30).
#
# Multi-stage build:
#   - `deps`     installs pinned dev+prod pnpm dependencies for the build.
#   - `build`    compiles `dist/` via `pnpm run build`.
#   - `runtime`  copies only `dist/`, `node_modules` (pruned to prod),
#                `package.json`, and a minimal set of governance docs into
#                the runtime layer. Runs as a non-root system user.
#
# Base image is pinned by digest (manifest list — resolves per host arch).
# Re-pin on every base-image rotation.

FROM node:22-bookworm-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS deps
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/app/.pnpm-store

# hadolint ignore=DL3008
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
COPY packages packages
COPY apps apps

RUN pnpm install --frozen-lockfile --ignore-scripts --store-dir /app/.pnpm-store


FROM deps AS build
WORKDIR /app

# CI=true suppresses the pnpm interactive confirmation prompt that
# `pnpm prune` emits in workspace mode when no TTY is available
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). Required since the
# repository became a pnpm workspace (#76).
ENV CI=true

COPY . .

RUN pnpm run build \
    && pnpm prune --prod --ignore-scripts


FROM node:22-bookworm-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS runtime

ENV NODE_ENV=production \
    TEST_INTELLIGENCE_HOST=0.0.0.0 \
    TEST_INTELLIGENCE_PORT=1983 \
    TEST_INTELLIGENCE_LOG_FORMAT=json \
    HOME=/workspace

# Apply the latest Debian security updates and remove the base image's
# bundled npm CLI. The base `node:22-bookworm-slim` tag lags Debian
# security releases by a few days; without this upgrade Trivy flags
# fixed CRITICAL/HIGH CVEs in libgnutls30 and libgcrypt20. The npm CLI
# is shipped under /usr/local by the node base image (not via apt) and
# transitively ships picomatch / brace-expansion / ip-address — three
# additional Trivy hits — but the production runtime invokes
# `node dist/server-entrypoint.js`, never `npm`. Strip it.
#
# hadolint ignore=DL3008,DL3009
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
              /usr/local/lib/node_modules/npm \
              /usr/local/bin/npm \
              /usr/local/bin/npx \
              /opt/yarn-v* \
              /usr/local/bin/yarn \
              /usr/local/bin/yarnpkg

# Create the non-root system user the runtime will execute as.
# UID/GID 65532 mirrors the distroless `nonroot` convention so volume
# mounts work consistently when operators migrate to a distroless base.
RUN groupadd --system --gid 65532 test-intelligence \
    && useradd --system --uid 65532 --gid 65532 --home-dir /workspace --create-home test-intelligence \
    && mkdir -p /opt/test-intelligence /workspace/.test-intelligence \
    && chown -R 65532:65532 /opt/test-intelligence /workspace

WORKDIR /opt/test-intelligence

# Only the artefacts the runtime needs: built dist/, pruned node_modules,
# package.json (used by getPackageIdentity), and the governance docs the
# operator may want to read inside the container.
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/package.json ./package.json
COPY --from=build --chown=65532:65532 /app/README.md /app/LICENSE /app/NOTICE ./

USER 65532:65532
WORKDIR /workspace

EXPOSE 1983
VOLUME ["/workspace/.test-intelligence"]

# The healthcheck runs as the same non-root user. Node 22 ships `fetch`
# globally; no curl is required (which keeps the runtime layer minimal).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:1983/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/opt/test-intelligence/dist/server-entrypoint.js"]
