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
RUN groupadd -r app -g 1000 && useradd -r -u 1000 -g app app
WORKDIR /app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('net').createConnection(3001,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "dist/server.js"]
