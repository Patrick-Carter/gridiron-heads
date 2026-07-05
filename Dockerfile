# syntax=docker/dockerfile:1.7
# ---------- Stage 1: install + build ----------
FROM node:22-alpine AS builder

# Native build deps for better-sqlite3 (python3 + make + g++) and
# glibc compat for the prebuilt alpine binaries it ships.
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copy workspace manifests first for layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Full install (dev deps needed for tsc + vite build).
RUN npm ci

# Copy sources and build everything in dependency order.
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

RUN npm -w @gridiron/shared run build \
 && npm -w @gridiron/server run build \
 && npm -w @gridiron/client run build

# Strip dev deps for the runtime image but keep workspace symlinks
# (npm prune --omit=dev leaves the @gridiron/* links intact).
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime

# libc6-compat for better-sqlite3 prebuilt binding, wget for healthcheck.
RUN apk add --no-cache libc6-compat wget \
 && addgroup -g 1001 gridiron \
 && adduser -u 1001 -G gridiron -D gridiron

WORKDIR /app

# Copy built app + prod node_modules + workspace symlinks.
COPY --from=builder --chown=gridiron:gridiron /app/node_modules ./node_modules
COPY --from=builder --chown=gridiron:gridiron /app/shared ./shared
COPY --from=builder --chown=gridiron:gridiron /app/server ./server
COPY --from=builder --chown=gridiron:gridiron /app/client ./client
COPY --from=builder --chown=gridiron:gridiron /app/package.json ./package.json

# Persistent SQLite directory. The deployer mounts a host path here.
RUN mkdir -p /app/data && chown -R gridiron:gridiron /app/data

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/gridiron.db

USER gridiron
EXPOSE 3000

# Unraid reads this to render the clickable WebUI icon on the Docker tab.
# [IP] and [PORT:3000] are template tokens — Unraid substitutes at render time.
LABEL net.unraid.docker.webui="http://[IP]:[PORT:3000]/" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/Patrick-Carter/gridiron-heads/main/.github/icon.png" \
      org.opencontainers.image.title="Gridiron Heads" \
      org.opencontainers.image.description="2-player head-to-head browser football. First to 3, win by 2." \
      org.opencontainers.image.source="https://github.com/Patrick-Carter/gridiron-heads" \
      org.opencontainers.image.licenses="MIT"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server/dist/index.js"]