# syntax=docker/dockerfile:1
#
# OpenQuota web server: reuses the OpenQuota provider logic (Rust) and serves
# the Svelte dashboard over HTTP. No desktop/X11/WebKit required.

# --- Frontend build --------------------------------------------------------
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY index.html vite.config.ts svelte.config.js \
     tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src ./src
RUN pnpm build

# --- Backend build ---------------------------------------------------------
FROM rust:1-bookworm AS backend
WORKDIR /app
COPY src-tauri ./src-tauri
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/src-tauri/target \
    cargo build --release --manifest-path src-tauri/Cargo.toml \
      --no-default-features --features web --bin openquota-server \
    && cp src-tauri/target/release/openquota-server /openquota-server

# --- Runtime ---------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend /openquota-server /usr/local/bin/openquota-server
COPY --from=frontend /app/dist /app/dist

ENV HOME=/data/home \
    XDG_DATA_HOME=/data/xdg-data \
    XDG_CONFIG_HOME=/config \
    XDG_STATE_HOME=/data/xdg-state \
    XDG_CACHE_HOME=/data/xdg-cache \
    CODEX_HOME=/data/home/.codex \
    CLAUDE_CONFIG_DIR=/data/home/.claude \
    OPENCODE_DATA_DIR=/data/xdg-data/opencode \
    OPENQUOTA_HOST=0.0.0.0 \
    OPENQUOTA_PORT=8080 \
    OPENQUOTA_STATIC_DIR=/app/dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/health >/dev/null || exit 1

CMD ["openquota-server"]
