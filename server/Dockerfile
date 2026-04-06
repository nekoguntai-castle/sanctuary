# =============================================
# Sanctuary Backend - Multi-stage Dockerfile
# Optimized for fast builds with bcryptjs (no native deps)
# =============================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Only openssl needed for Prisma (no python/make/g++ since bcryptjs is pure JS)
RUN apk add --no-cache openssl

# Copy package files first (better layer caching)
COPY server/package*.json ./
COPY server/prisma ./prisma/
COPY server/prisma.config.ts ./

# Install all dependencies (including dev for building)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/prisma.config.ts ./

# Copy shared directory first (needed for imports)
COPY shared ../shared

# Copy only source files needed for build (better cache invalidation)
COPY server/tsconfig.json ./
COPY server/src ./src

# Build TypeScript (main app)
RUN npm run build

# Compile seed script separately
COPY server/prisma/seed.ts ./prisma/
RUN npx tsc prisma/seed.ts --outDir dist/prisma --esModuleInterop --skipLibCheck --resolveJsonModule --ignoreConfig --types node --module commonjs

# Prune dev dependencies for production
RUN npm prune --production

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

# Install dumb-init for proper signal handling and OpenSSL for Prisma
RUN apk add --no-cache dumb-init openssl

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 sanctuary

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Copy only necessary files from builder (already pruned)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=deps /app/prisma.config.ts ./

# Copy migration scripts
COPY server/scripts ./scripts

# Change ownership
RUN chown -R sanctuary:nodejs /app

# Switch to non-root user
USER sanctuary

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["node", "dist/app/src/index.js"]
