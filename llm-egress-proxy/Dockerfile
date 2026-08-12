# Sanctuary LLM Egress Proxy
# Security-focused proxy that owns external LLM provider egress

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --strict-allow-scripts --ignore-scripts

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# --- Production image ---
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runner
ARG SANCTUARY_SOURCE_COMMIT
ARG SANCTUARY_IMAGE_LOCK_SHA256
LABEL org.opencontainers.image.revision="$SANCTUARY_SOURCE_COMMIT" \
      dev.sanctuary.image-lock-sha256="$SANCTUARY_IMAGE_LOCK_SHA256"

WORKDIR /app

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 llmproxy

# Copy built files
COPY --chown=llmproxy:nodejs --from=builder /app/dist ./dist
COPY --chown=llmproxy:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=llmproxy:nodejs --from=builder /app/package*.json ./

# Set ownership
USER llmproxy

ENV NODE_ENV=production
ENV PORT=3100

EXPOSE 3100

CMD ["node", "dist/index.js"]
