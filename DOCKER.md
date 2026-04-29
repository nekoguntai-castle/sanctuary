# Sanctuary Docker Deployment

This guide explains how to deploy Sanctuary using Docker and Docker Compose.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          Docker Network                                │
│                                                                        │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │   Frontend   │   │   Backend    │   │   Gateway    │              │
│  │   (nginx)    │──▶│   (node)     │◀──│   (node)     │              │
│  │    :443      │   │    :3001     │   │    :4000     │              │
│  └──────────────┘   └──────────────┘   └──────────────┘              │
│         │                  │                  │                       │
│         │                  ▼                  │                       │
│         │           ┌─────────────────┐       │                       │
│         │           │    PostgreSQL   │       │                       │
│         │           │     :5432       │       │                       │
│         │           └─────────────────┘       │                       │
│         ▼                  ▼                  ▼                       │
│    [exposed]          [volume]          [mobile API]                  │
└───────────────────────────────────────────────────────────────────────┘
```

## System Requirements

### Minimum Hardware

- **CPU**: 2 cores
- **RAM**: 4GB minimum, 6GB recommended
- **Storage**: 500MB for application + blockchain index cache

### Container Resource Allocation

| Service    | Memory Limit | CPU Limit | Notes |
|------------|--------------|-----------|-------|
| PostgreSQL | 1GB          | 2 cores   | Performance tuned with custom config |
| Backend    | 2GB          | 2 cores   | Handles sync, WebSocket, API |
| Frontend   | 256MB        | 0.5 core  | Nginx + static files |
| Gateway    | 256MB        | 0.5 core  | Mobile API gateway |
| Redis      | 192MB        | 0.5 core  | Cache and pub/sub |
| AI         | 256MB        | 0.5 core  | AI proxy (idle until enabled) |

> **Note**: Local model RAM/CPU requirements apply to the external provider process, such as host-installed Ollama, LM Studio, llama.cpp, or vLLM.

### PostgreSQL Performance Tuning

PostgreSQL is configured with optimized settings via command-line flags in `docker-compose.yml`:

- `shared_buffers = 256MB` - Main memory pool for caching
- `effective_cache_size = 768MB` - Query planner hint
- `work_mem = 16MB` - Memory per sort/join operation
- Slow query logging enabled (queries >1s logged)

Use the analysis script to diagnose performance issues:

```bash
# View slow queries
./scripts/db-analyze.sh slow

# Show database statistics and index usage
./scripts/db-analyze.sh stats

# Show current locks
./scripts/db-analyze.sh locks
```

## Quick Start

### 1. Prerequisites

- Docker Engine 20.10+
- Docker Compose V2

### 2. Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit the configuration (REQUIRED: change JWT_SECRET and POSTGRES_PASSWORD)
nano .env
```

**Important**: You MUST change these values before deployment:
- `JWT_SECRET` - Generate with: `openssl rand -base64 64`
- `POSTGRES_PASSWORD` - Use a strong, unique password

### 3. Build and Run

```bash
# Build and start all services (recommended)
./start.sh

# Or rebuild all containers
./start.sh --rebuild

# Watch the logs
docker compose logs -f

# Check service status
docker compose ps
```

> **Note**: Always use `./start.sh` for starting Sanctuary. This ensures proper environment setup and certificate generation.

### 4. Access the Application

- **Frontend**: https://localhost:8443 (or your configured HTTPS_PORT)
- **API Health Check**: https://localhost:8443/api/v1/health
- **Gateway (Mobile API)**: http://localhost:4000

## Commands

### Start/Stop

```bash
# Start services (recommended)
./start.sh

# AI providers run outside Sanctuary; configure the endpoint in Admin -> AI Settings

# Stop services
./start.sh --stop

# Or using docker compose directly
docker compose down

# Stop and remove volumes (CAUTION: deletes database!)
docker compose down -v
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

### Database Operations

```bash
# Run migrations manually
docker compose run --rm migrate

# Access PostgreSQL directly
docker compose exec postgres psql -U sanctuary -d sanctuary

# Create a database backup
docker compose exec postgres pg_dump -U sanctuary sanctuary > backup.sql

# Restore from backup
cat backup.sql | docker compose exec -T postgres psql -U sanctuary sanctuary
```

### Rebuild Services

```bash
# Rebuild all services (recommended)
./start.sh --rebuild

# Or using docker compose directly
docker compose build --no-cache

# Rebuild specific service
docker compose build --no-cache backend
```

## Production Deployment

For production, use the production override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This adds:
- Resource limits (CPU/memory)
- Security hardening (read-only filesystem, no new privileges)
- Optimized restart policies

### SSL/TLS with Let's Encrypt

For HTTPS in production, you have several options:

1. **Reverse Proxy (Recommended)**: Put Sanctuary behind a reverse proxy like Traefik, Caddy, or nginx-proxy that handles SSL termination.

2. **Cloudflare Tunnel**: Use Cloudflare Tunnel for zero-config HTTPS.

3. **Manual SSL**: Mount SSL certificates into the frontend container and modify nginx config.

Example with Traefik labels (add to frontend service):

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.sanctuary.rule=Host(`sanctuary.yourdomain.com`)"
  - "traefik.http.routers.sanctuary.tls.certresolver=letsencrypt"
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs backend

# Common issues:
# - Database not ready: Wait for postgres healthcheck
# - Missing JWT_SECRET: Add to .env file
# - Port already in use: Change FRONTEND_PORT in .env
```

### Database connection issues

```bash
# Verify postgres is running
docker compose ps postgres

# Test connection from backend
docker compose exec backend wget -q -O- http://localhost:3001/health
```

### Reset everything

```bash
# Stop all containers and remove volumes
docker compose down -v

# Remove all images
docker compose down --rmi all

# Start fresh
docker compose up -d --build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTPS_PORT` | `443` | HTTPS port to expose (use 8443 for non-root) |
| `HTTP_PORT` | `80` | HTTP redirect port |
| `GATEWAY_PORT` | `4000` | Mobile API gateway port |
| `POSTGRES_USER` | `sanctuary` | PostgreSQL username |
| `POSTGRES_PASSWORD` | - | PostgreSQL password (required) |
| `POSTGRES_DB` | `sanctuary` | PostgreSQL database name |
| `JWT_SECRET` | - | Secret for JWT tokens (required) |
| `JWT_EXPIRES_IN` | `7d` | JWT token expiration |
| `BITCOIN_NETWORK` | `mainnet` | Bitcoin network to use |
| `ELECTRUM_HOST` | `electrum.blockstream.info` | Electrum server host |
| `ELECTRUM_PORT` | `50002` | Electrum server port |
| `ELECTRUM_PROTOCOL` | `ssl` | Electrum protocol (ssl/tcp) |

## Security Considerations

1. **Never expose PostgreSQL port** to the internet
2. **Use strong passwords** for database and JWT secret
3. **Keep Docker and images updated** for security patches
4. **Use HTTPS in production** with proper SSL certificates
5. **Consider running your own Electrum server** for privacy
6. **Regular backups** of the PostgreSQL volume

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build

# Run any new migrations
docker compose run --rm migrate
```
