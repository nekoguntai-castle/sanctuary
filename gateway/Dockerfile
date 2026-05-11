# Gateway Dockerfile
# Phase G: workspace-aware build (@sanctuary/shared via npm workspaces)
# Multi-stage build for minimal production image

# Stage 1: Dependencies — install at the workspace root
FROM node:24-alpine AS deps
WORKDIR /repo

# Copy root + workspace member package files first for layer caching.
COPY package*.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY gateway/package.json ./gateway/

# Workspace-aware install. --include-workspace-root pulls root devDeps
# (typescript, vitest, etc.) so the builder stage can compile.
RUN npm ci --include-workspace-root --ignore-scripts

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/package*.json ./
COPY --from=deps /repo/server/package.json ./server/
COPY --from=deps /repo/gateway ./gateway

# Copy shared source (deps stage only has package.json).
COPY shared ./shared

# Build shared first (gateway imports from @sanctuary/shared/dist).
RUN npm --workspace shared run build

# Build gateway.
COPY gateway/tsconfig.json ./gateway/
COPY gateway/src ./gateway/src
COPY global.d.ts ./

WORKDIR /repo/gateway
RUN npm run build

# Prune dev + optional dependencies. firebase-admin optional packages
# (firestore/storage chain) are not used by gateway push flows.
WORKDIR /repo
RUN npm prune --production --omit=optional --include-workspace-root --ignore-scripts

# Stage 3: Production
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 gateway

# Copy gateway runtime artifacts.
COPY --from=builder /repo/gateway/dist ./dist
COPY --from=builder /repo/gateway/package.json ./

# Strategy (c) per v3.1 plan: materialize the workspace symlink as a real
# directory containing only what shared exports (package.json + dist/).
COPY --from=builder /repo/node_modules ./node_modules
RUN rm -rf /app/node_modules/@sanctuary/shared && \
    mkdir -p /app/node_modules/@sanctuary/shared
COPY --from=builder /repo/shared/package.json /app/node_modules/@sanctuary/shared/package.json
COPY --from=builder /repo/shared/dist /app/node_modules/@sanctuary/shared/dist

RUN chown -R gateway:nodejs /app

USER gateway
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

# Gateway tsconfig keeps rootDir at ".." so the emit shape is dist/gateway/src/...
CMD ["node", "dist/gateway/src/index.js"]
