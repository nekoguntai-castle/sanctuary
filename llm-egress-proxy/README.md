# Sanctuary LLM Egress Proxy

Security-isolated sidecar for external LLM provider egress. The proxy handles provider calls in a separate runtime boundary, so the backend can keep database access, signing, and private-key responsibilities out of the provider-facing process.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture reference.

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Docker Network                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐      ┌──────────────────────────────────┐ │
│  │  llm-egress-proxy│      │  sanctuary-backend               │ │
│  │  (sidecar)       │      │  (existing)                      │ │
│  │                  │      │                                  │ │
│  │  - Label suggest │ ───► │  - Wallets, keys, signing        │ │
│  │  - NL queries    │ READ │  - Transactions                  │ │
│  │                  │ ONLY │  - All critical operations       │ │
│  │                  │      │                                  │ │
│  │  NO ACCESS TO:   │      │  Internal AI endpoints:          │ │
│  │  - Private keys  │      │  GET /internal/ai/tx/:id         │ │
│  │  - Signing ops   │      │  GET /internal/ai/wallet/:id/*   │ │
│  │  - DB directly   │      │                                  │ │
│  └────────┬─────────┘      └──────────────────────────────────┘ │
│           │                                                      │
│           │ Outbound only (configurable)                         │
│           ▼                                                      │
│  ┌──────────────────┐                                           │
│  │  External AI     │  Ollama / llama.cpp / OpenAI-compatible   │
│  │  (user-provided) │                                           │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

## Security Guarantees

| Component                  | Can Access                                     | Cannot Access                                        |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| LLM Egress Proxy           | Transaction metadata (amount, date, direction) | Private keys, signing, DB, secrets, addresses, txids |
| Backend Internal Endpoints | Sanitized tx data for AI                       | Full transaction objects                             |
| External AI Calls          | Only from LLM egress proxy                     | Never from backend directly                          |

All LLM egress proxy routes except `/health` require the backend shared secret in
`x-llm-egress-proxy-secret`. Provider API keys are synced into proxy memory only,
never returned by `/config`, and sent to OpenAI-compatible providers only as
`Authorization: Bearer ...`.

## Data Sanitization

The LLM egress proxy only receives:

- ✓ Transaction amount (in satoshis)
- ✓ Transaction direction (send/receive)
- ✓ Transaction date
- ✓ Existing label names
- ✓ Confirmation count

The LLM egress proxy NEVER receives:

- ✗ Bitcoin addresses
- ✗ Transaction IDs (txids)
- ✗ Private keys or xpubs
- ✗ Wallet passwords
- ✗ Any identifiable blockchain data

## Egress Policy

The proxy is the only Sanctuary process that contacts configured LLM providers. It allows host-local and mDNS-discovered endpoints by default, and rejects Docker service names plus numeric LAN/public IPs unless the operator explicitly allowlists them through `LLM_EGRESS_PROXY_ALLOWED_HOSTS`, `LLM_EGRESS_PROXY_ALLOWED_CIDRS`, or `LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS=true`.

This gives the sidecar a concrete security job even when all models are external:

- The backend keeps database, signing, and key access out of the provider-facing process.
- Compose keeps the proxy off the main app network; it shares only a dedicated egress bridge with the backend.
- Provider credentials are copied only into proxy memory and are never returned by proxy config routes.
- Endpoint policy rejects embedded URL credentials, unsupported protocols, and unapproved provider endpoints before any provider request is sent.
- Sanitized prompt context is fetched through backend-owned read-only internal routes.

**Warning**: With public/cloud providers, sanitized transaction metadata may be sent to external servers. Use explicit allowlisting and a trusted provider endpoint.

## Usage

The LLM egress proxy container starts automatically with Sanctuary. It idles until AI features are enabled and connects only to the provider endpoint configured in AI Settings.

### Configure AI Endpoint

In Sanctuary Admin → AI Settings:

1. Enable AI Features
2. Set AI Endpoint URL:
   - Host Ollama: `http://host.docker.internal:11434`
   - LAN Ollama: `http://192.168.1.20:11434` (requires `LLM_EGRESS_PROXY_ALLOWED_CIDRS`)
   - LM Studio/OpenAI-compatible: `http://192.168.1.20:1234/v1` (requires `LLM_EGRESS_PROXY_ALLOWED_CIDRS`)
   - Cloud: `https://api.openai.com` (requires explicit endpoint allowlisting)
3. Set Model Name: e.g., `llama3.2:3b` or `gpt-4`

### Running An External Provider

```bash
# Option A: Host-installed Ollama outside Sanctuary
ollama serve
# In another terminal:
ollama pull llama3.2:3b

# Option B: LM Studio or another OpenAI-compatible runtime outside Sanctuary
# Start the provider app/server outside Sanctuary.

# Endpoints:
# - Host: http://host.docker.internal:11434
# - LM Studio LAN: http://<host-or-ip>:1234/v1
#   Add the LAN CIDR to LLM_EGRESS_PROXY_ALLOWED_CIDRS first.
```

## API Endpoints

| Endpoint         | Method | Description                          |
| ---------------- | ------ | ------------------------------------ |
| `/health`        | GET    | Health check                         |
| `/config`        | POST   | Update AI configuration              |
| `/config`        | GET    | Get current configuration            |
| `/suggest-label` | POST   | Get label suggestion for transaction |
| `/query`         | POST   | Execute natural language query       |
| `/test`          | POST   | Test AI connection                   |

## Risk Mitigation

| Risk                     | Mitigation                                                         |
| ------------------------ | ------------------------------------------------------------------ |
| LLM egress proxy compromised | No DB access, no keys - worst case: reads sanitized tx metadata    |
| Malicious AI response    | Responses are suggestions only, user must confirm                  |
| AI endpoint data leak    | Only sends: amounts, dates, labels - NO addresses/txids            |
| DoS via AI               | Rate limiting (10 req/min), timeout (35s), backend circuit breaker |
| LLM egress proxy down        | Main app fully functional, AI features show "unavailable"          |

## Troubleshooting

### LLM Egress Proxy Not Starting

> **Note:** The LLM egress proxy starts automatically with Sanctuary - no profile flag is needed.

```bash
docker compose logs llm-egress-proxy
docker compose ps
```

### Cannot Reach Local Provider

- For Ollama, ensure it is running: `ollama serve`; default port is 11434.
- For LM Studio, start the local server and use its OpenAI-compatible `/v1` base URL; default port is commonly 1234.
- From Docker, use `host.docker.internal` or an allowlisted LAN IP instead of `localhost` when the provider runs outside the LLM egress proxy container.

### Network Issues

```bash
# Check if LLM egress proxy can reach backend
docker compose exec llm-egress-proxy wget -qO- http://backend:3001/health

# Check whether the LLM egress proxy can reach an explicitly allowed provider
docker compose exec llm-egress-proxy wget -qO- --timeout=5 https://api.openai.com
```

## Environment Variables

| Variable                      | Default               | Description                                                                    |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `PORT`                        | `3100`                | LLM egress proxy port                                                          |
| `BACKEND_URL`                 | `http://backend:3001` | Backend URL for sanitized data                                                 |
| `LLM_EGRESS_PROXY_SECRET`     | random at startup     | Backend-to-proxy shared secret for non-health routes                           |
| `LLM_EGRESS_PROXY_ALLOWED_HOSTS` | empty              | Comma-separated public/cloud provider host allowlist; supports `*.example.com` |
| `LLM_EGRESS_PROXY_ALLOWED_CIDRS` | empty              | Comma-separated IPv4 CIDRs for explicit provider endpoint allowlisting         |
| `LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS` | `false`               | Allow any public HTTPS provider endpoint                                       |
| `NODE_ENV`                    | `production`          | Environment mode                                                               |
