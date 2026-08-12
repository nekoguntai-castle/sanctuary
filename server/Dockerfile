# =============================================
# Sanctuary Backend - Multi-stage Dockerfile
# Phase G: workspace-aware build (@sanctuary/shared via npm workspaces)
# =============================================

# Shared Node/npm toolchain. npm 11.16+ is required by the root package policy.
FROM node:24-alpine AS node-toolchain
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
RUN npm prune --production --include-workspace-root --ignore-scripts

# Stage 3: Production
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init openssl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 sanctuary

ENV NODE_ENV=production
ENV PORT=3001

# Copy server runtime artifacts.
COPY --from=builder /repo/server/dist ./dist
COPY --from=builder /repo/server/package.json ./
COPY --from=builder /repo/server/prisma ./prisma
COPY --from=builder /repo/server/prisma.config.ts ./
COPY --from=builder /repo/server/scripts ./scripts

# Strategy (c) per v3.1 plan: materialize the workspace symlink as a real
# directory containing only what shared exports (package.json + dist/).
# Layout matches what shared's `exports` field references:
#   /app/node_modules/@sanctuary/shared/package.json
#   /app/node_modules/@sanctuary/shared/dist/utils/errors.js
COPY --from=builder /repo/node_modules ./node_modules
# Some server dependencies are workspace-local when the root app needs an
# incompatible version. Overlay them so runtime resolution matches the server
# workspace instead of falling back to the root package set.
COPY --from=builder /repo/server/node_modules /tmp/server-node_modules
RUN if [ -d /tmp/server-node_modules ]; then \
      for package in /tmp/server-node_modules/*; do \
        [ -e "$package" ] || continue; \
        name="$(basename "$package")"; \
        if [ "${name#@}" != "$name" ]; then \
          mkdir -p "/app/node_modules/$name"; \
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
    mkdir -p /app/node_modules/@sanctuary/shared
COPY --from=builder /repo/shared/package.json /app/node_modules/@sanctuary/shared/package.json
COPY --from=builder /repo/shared/dist /app/node_modules/@sanctuary/shared/dist

RUN mkdir -p /run/sanctuary-support-capture && \
    chown sanctuary:nodejs /run/sanctuary-support-capture && \
    chmod 0700 /run/sanctuary-support-capture && \
    chown -R sanctuary:nodejs /app

USER sanctuary
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

# Server tsconfig keeps rootDir at ".." so the emit shape is dist/server/src/...
CMD ["node", "dist/server/src/index.js"]
