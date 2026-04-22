# =============================================
# Sanctuary Frontend - Multi-stage Dockerfile
# Optimized for fast builds with better layer caching
# =============================================

# Stage 1: Dependencies
FROM node:25-alpine AS deps
WORKDIR /app

# Install Python and build tools for native modules (required for @trezor/connect-web usb dependency)
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev

# Copy package files first (best cache layer)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Stage 2: Builder
FROM node:25-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./

# Copy source files (server/ excluded via .dockerignore)
COPY . .

# Build argument for API URL (can be overridden at build time)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

# Build the application
RUN npm run build

# Stage 3: Production with Nginx
FROM nginx:alpine AS runner

# Install envsubst for runtime environment variable substitution
RUN apk add --no-cache gettext

# Create non-root user for nginx
RUN addgroup -g 1001 -S sanctuary && \
    adduser -S -D -H -u 1001 -h /var/cache/nginx -s /sbin/nologin -G sanctuary sanctuary

# Copy custom nginx configuration
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/nginx/default-ssl.conf.template /etc/nginx/templates/default-ssl.conf.template

# Create SSL directory (certificates mounted at runtime)
RUN mkdir -p /etc/nginx/ssl

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy entrypoint script
COPY docker/nginx/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Set proper permissions
RUN chown -R sanctuary:sanctuary /usr/share/nginx/html && \
    chown -R sanctuary:sanctuary /var/cache/nginx && \
    chown -R sanctuary:sanctuary /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R sanctuary:sanctuary /var/run/nginx.pid && \
    chown -R sanctuary:sanctuary /etc/nginx/conf.d && \
    chown -R sanctuary:sanctuary /etc/nginx/ssl

# Expose ports (HTTP and HTTPS)
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

# Use custom entrypoint
ENTRYPOINT ["/docker-entrypoint.sh"]

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
