# SPDX-License-Identifier: AGPL-3.0-or-later
# © 2026 Harald Weiss
#
# Multi-stage build for the Claude Usage Tracker backend.
# Stage 1 compiles TypeScript and prunes dev-deps; stage 2 is the runtime.
# Using Debian Bookworm (glibc 2.36) instead of Alpine to avoid musl issues
# with sqlite3 native bindings and to keep glibc current enough for
# unpinned sqlite3 releases.

# ─── Stage 1: build ───
FROM docker.io/library/node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --production

# ─── Stage 2: runtime ───
FROM docker.io/library/node:22-bookworm-slim
# The base image already ships a non-root `node` user at UID/GID 1000.
# Reuse it instead of creating a duplicate (groupadd would fail on GID conflict).
WORKDIR /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/server.js"]
