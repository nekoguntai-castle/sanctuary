# Gateway Dockerfile
# Multi-stage build for minimal production image

# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY gateway/package*.json ./

# Install dependencies
RUN npm ci

# Copy shared directory first (needed for imports)
COPY shared ../shared

# Copy source
COPY gateway/tsconfig.json ./
COPY gateway/src ./src

# Shared TypeScript files live outside /app, so their package resolution walks
# up to /node_modules during the container build.
RUN ln -s /app/node_modules /node_modules

# Build TypeScript
RUN npm run build

# Prune dev + optional dependencies.
# firebase-admin optional packages (firestore/storage chain) are not used by gateway push flows.
RUN npm prune --production --omit=optional

# Production stage
FROM node:24-alpine AS runner

WORKDIR /app

# Install dumb-init for proper signal handling and zombie reaping
RUN apk add --no-cache dumb-init

# Add non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 gateway

# Copy built files and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Set ownership
RUN chown -R gateway:nodejs /app

USER gateway

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Use dumb-init to handle signals properly and reap zombie processes
ENTRYPOINT ["dumb-init", "--"]

# Start server
CMD ["node", "dist/app/src/index.js"]
