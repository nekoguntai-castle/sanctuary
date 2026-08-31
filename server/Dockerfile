# =============================================
# Sanctuary Backend - Multi-stage Dockerfile
# Phase G: workspace-aware build (@sanctuary/shared via npm workspaces)
# =============================================

# Shared Node/npm toolchain. npm 11.16+ is required by the root package policy.
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS node-toolchain
ARG NPM_VERSION=11.19.0
RUN npm install --global --audit=false --fund=false "npm@$NPM_VERSION"

# Stage 1: Dependencies — install at the workspace root
FROM node-toolchain AS deps
WORKDIR /repo

RUN apk add --no-cache openssl

# Copy root + workspace member package files first for layer caching.
COPY package*.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY gateway/package.json ./gateway/
COPY server/prisma ./server/prisma/
COPY server/prisma.config.ts ./server/

# Workspace-aware install. --include-workspace-root pulls in root devDeps
# (typescript, vitest, etc.) so the builder stage can compile.
RUN npm ci --strict-allow-scripts --include-workspace-root --ignore-scripts

# Generate Prisma client.
WORKDIR /repo/server
RUN npx prisma generate

# Stage 2: Builder
FROM node-toolchain AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/package*.json ./
COPY --from=deps /repo/server ./server
COPY --from=deps /repo/gateway/package.json ./gateway/

# Copy shared source (deps stage only has package.json).
COPY shared ./shared

# Build shared first (server imports from @sanctuary/shared/dist).
RUN npm --workspace shared run build

# Build server.
COPY server/tsconfig.json ./server/
COPY server/scripts ./server/scripts
COPY server/src ./server/src
# jadePinRelay imports this exact reviewed boundary manifest at compile time;
# TypeScript emits it under dist/config for the runtime-relative require.
COPY config/jade-protocol-harness.json ./config/

WORKDIR /repo/server
RUN npm run build

# Compile seed script separately (matches pre-Phase-G behavior).
COPY server/prisma/seed.ts ./prisma/
RUN npx tsc prisma/seed.ts --outDir dist/prisma --esModuleInterop --skipLibCheck --resolveJsonModule --ignoreConfig --types node --module commonjs

# Prune dev dependencies for production. Workspace symlinks survive prune.
WORKDIR /repo
RUN npm prune --omit=dev --include-workspace-root --ignore-scripts --audit=false --fund=false

# Stage 3: Production
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runner
ARG SANCTUARY_SOURCE_COMMIT
ARG SANCTUARY_IMAGE_LOCK_SHA256
ARG SANCTUARY_BUILD_VERSION
ARG SANCTUARY_BUILD_ID
RUN test -n "$SANCTUARY_SOURCE_COMMIT" \
    && test "$SANCTUARY_SOURCE_COMMIT" != unknown \
    && test -n "$SANCTUARY_IMAGE_LOCK_SHA256" \
    && test "$SANCTUARY_IMAGE_LOCK_SHA256" != unknown \
    && test -n "$SANCTUARY_BUILD_VERSION" \
    && test "$SANCTUARY_BUILD_VERSION" != unknown \
    && test -n "$SANCTUARY_BUILD_ID" \
    && test "$SANCTUARY_BUILD_ID" != unknown
LABEL org.opencontainers.image.source="https://github.com/nekoguntai-castle/sanctuary" \
      org.opencontainers.image.version="$SANCTUARY_BUILD_VERSION" \
      org.opencontainers.image.revision="$SANCTUARY_SOURCE_COMMIT" \
      io.sanctuary.build-id="$SANCTUARY_BUILD_ID" \
      dev.sanctuary.image-lock-sha256="$SANCTUARY_IMAGE_LOCK_SHA256"
WORKDIR /app

RUN apk add --no-cache dumb-init openssl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 sanctuary

ENV NODE_ENV=production
ENV PORT=3001

# Copy server runtime artifacts.
COPY --chown=sanctuary:nodejs --from=builder /repo/server/dist ./dist
COPY --chown=sanctuary:nodejs --from=builder /repo/server/package.json ./
COPY --chown=sanctuary:nodejs --from=builder /repo/server/prisma ./prisma
COPY --chown=sanctuary:nodejs --from=builder /repo/server/prisma.config.ts ./
COPY --chown=sanctuary:nodejs --from=builder /repo/server/scripts ./scripts

# Strategy (c) per v3.1 plan: materialize the workspace symlink as a real
# directory containing only what shared exports (package.json + dist/).
# Layout matches what shared's `exports` field references:
#   /app/node_modules/@sanctuary/shared/package.json
#   /app/node_modules/@sanctuary/shared/dist/utils/errors.js
COPY --chown=sanctuary:nodejs --from=builder /repo/node_modules ./node_modules
# Some server dependencies are workspace-local when the root app needs an
# incompatible version. Overlay them so runtime resolution matches the server
# workspace instead of falling back to the root package set.
COPY --chown=sanctuary:nodejs --from=builder /repo/server/node_modules /tmp/server-node_modules
RUN if [ -d /tmp/server-node_modules ]; then \
      for package in /tmp/server-node_modules/*; do \
        [ -e "$package" ] || continue; \
        name="$(basename "$package")"; \
        if [ "${name#@}" != "$name" ]; then \
          install -d -o sanctuary -g nodejs "/app/node_modules/$name"; \
          for scoped_package in "$package"/*; do \
            [ -e "$scoped_package" ] || continue; \
            scoped_name="$(basename "$scoped_package")"; \
            rm -rf "/app/node_modules/$name/$scoped_name"; \
          done; \
        else \
          rm -rf "/app/node_modules/$name"; \
        fi; \
      done; \
      cp -a /tmp/server-node_modules/. /app/node_modules/; \
      rm -rf /tmp/server-node_modules; \
    fi
RUN rm -rf /app/node_modules/@sanctuary/shared && \
    install -d -o sanctuary -g nodejs /app/node_modules/@sanctuary/shared
COPY --chown=sanctuary:nodejs --from=builder /repo/shared/package.json /app/node_modules/@sanctuary/shared/package.json
COPY --chown=sanctuary:nodejs --from=builder /repo/shared/dist /app/node_modules/@sanctuary/shared/dist

RUN install -d -m 0700 -o sanctuary -g nodejs /run/sanctuary-support-capture

USER sanctuary
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

# Server tsconfig keeps rootDir at ".." so the emit shape is dist/server/src/...
CMD ["node", "dist/server/src/index.js"]
