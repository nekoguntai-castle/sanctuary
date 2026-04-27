# Sanctuary AI Container

Security-isolated container for AI operations. This container handles all AI calls in a separate security domain, ensuring sensitive wallet data is never exposed to external AI services.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture reference.

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Docker Network                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐      ┌──────────────────────────────────┐ │
│  │  sanctuary-ai    │      │  sanctuary-backend               │ │
│  │  (THIS CONTAINER)│      │  (existing)                      │ │
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
| AI Container               | Transaction metadata (amount, date, direction) | Private keys, signing, DB, secrets, addresses, txids |
| Backend Internal Endpoints | Sanitized tx data for AI                       | Full transaction objects                             |
| External AI Calls          | Only from AI container                         | Never from backend directly                          |

All AI proxy routes except `/health` require the backend shared secret in
`x-ai-service-secret`. Provider API keys are synced into proxy memory only,
never returned by `/config`, and sent to OpenAI-compatible providers only as
`Authorization: Bearer ...`.

## Data Sanitization

The AI container only receives:

- ✓ Transaction amount (in satoshis)
- ✓ Transaction direction (send/receive)
- ✓ Transaction date
- ✓ Existing label names
- ✓ Confirmation count

The AI container NEVER receives:

- ✗ Bitcoin addresses
- ✗ Transaction IDs (txids)
- ✗ Private keys or xpubs
- ✗ Wallet passwords
- ✗ Any identifiable blockchain data

## Network Isolation

### Local AI Only (Default - Most Secure)

```yaml
# docker-compose.yml
ai:
  networks:
    - sanctuary-network # Can reach backend
    - ai-internal # internal: true = NO internet
```

The `ai-internal` network has no gateway, so the container cannot reach the internet. Use this with local AI (Ollama, llama.cpp).

### Cloud AI (Less Secure)

To use cloud AI providers (OpenAI-compatible gateways, hosted providers, etc.),
remove the ai-internal network and explicitly allow the provider endpoint:

```yaml
# docker-compose.yml
ai:
  networks:
    - sanctuary-network # Has internet access
    # - ai-internal      # REMOVED - allows internet
  environment:
    AI_PROXY_ALLOWED_HOSTS: api.openai.com
```

**Warning**: With cloud AI, sanitized transaction metadata will be sent to external servers.

## Usage

The AI container starts automatically with Sanctuary. It idles until AI features are enabled.

### Configure AI Endpoint

In Sanctuary Admin → AI Settings:

1. Enable AI Features
2. Set AI Endpoint URL:
   - Bundled Ollama: `http://ollama:11434` (when started with `./start.sh --with-ai`)
   - Host Ollama: `http://host.docker.internal:11434`
   - LAN Ollama: `http://192.168.1.20:11434`
   - LM Studio/OpenAI-compatible: `http://192.168.1.20:1234/v1`
   - Cloud: `https://api.openai.com` (requires internet access plus endpoint allowlisting)
3. Set Model Name: e.g., `llama3.2:3b` or `gpt-4`

### Running Local AI

```bash
# Option A: Bundled Ollama container
./start.sh --with-ai

# Option B: Host-installed Ollama (not in container)
ollama serve
ollama pull llama3.2:3b

# Endpoints:
# - Bundled: http://ollama:11434
# - Host: http://host.docker.internal:11434
# - LM Studio LAN: http://<host-or-ip>:1234/v1
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
| AI container compromised | No DB access, no keys - worst case: reads tx metadata              |
| Malicious AI response    | Responses are suggestions only, user must confirm                  |
| AI endpoint data leak    | Only sends: amounts, dates, labels - NO addresses/txids            |
| DoS via AI               | Rate limiting (10 req/min), timeout (35s), backend circuit breaker |
| AI container down        | Main app fully functional, AI features show "unavailable"          |

## Troubleshooting

### AI Container Not Starting

> **Note:** The AI container starts automatically with Sanctuary - no profile flag is needed.

```bash
docker compose logs ai
docker compose ps
```

### Cannot Reach Local Provider

- For Ollama, ensure it is running: `ollama serve`; default port is 11434.
- For LM Studio, start the local server and use its OpenAI-compatible `/v1` base URL; default port is commonly 1234.
- From Docker, use `host.docker.internal` or a LAN IP instead of `localhost` when the provider runs outside the AI proxy container.

### Network Issues

```bash
# Check if AI container can reach backend
docker exec sanctuary-ai wget -qO- http://backend:3001/health

# Check if AI container has internet (should fail in local-only mode)
docker exec sanctuary-ai wget -qO- --timeout=5 https://google.com
```

## Environment Variables

| Variable                      | Default               | Description                                                                    |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `PORT`                        | `3100`                | AI container port                                                              |
| `BACKEND_URL`                 | `http://backend:3001` | Backend URL for sanitized data                                                 |
| `AI_CONFIG_SECRET`            | random at startup     | Backend-to-proxy shared secret for non-health routes                           |
| `AI_PROXY_ALLOWED_HOSTS`      | empty                 | Comma-separated public/cloud provider host allowlist; supports `*.example.com` |
| `AI_PROXY_ALLOWED_CIDRS`      | empty                 | Comma-separated IPv4 CIDRs for explicit provider endpoint allowlisting         |
| `AI_PROXY_ALLOW_PUBLIC_HTTPS` | `false`               | Allow any public HTTPS provider endpoint                                       |
| `NODE_ENV`                    | `production`          | Environment mode                                                               |
