# Sanctuary AI Proxy
# Security-focused proxy that ensures AI calls stay on local network

FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# --- Production image ---
FROM node:24-alpine AS runner

WORKDIR /app

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 aiproxy

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Set ownership
RUN chown -R aiproxy:nodejs /app

USER aiproxy

ENV NODE_ENV=production
ENV PORT=3100

EXPOSE 3100

CMD ["node", "dist/index.js"]
