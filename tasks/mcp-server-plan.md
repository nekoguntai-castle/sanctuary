# Sanctuary MCP Server — Implementation Plan

## Context

Sanctuary is a self-hosted Bitcoin wallet coordinator. The goal is to expose Sanctuary's data via the **Model Context Protocol (MCP)** so that local LLMs (LM Studio, llama.cpp, Ollama on host, etc.) can query wallet data, transactions, UTXOs, fee estimates, and more — without any write access.

**Primary client:** External local LLMs running on the host, connecting via an exposed HTTP port.
**Access level:** Read-only. No mutations, no draft creation, no label writes. This is a Bitcoin wallet — safety first.
**Posture:** Opt-in and disabled by default. Even read-only MCP access is a broad data export surface for wallet labels, addresses, transaction history, policies, and audit trails. Requires an explicit admin-created API key before any data is exposed.

---

## Value & Use Cases

### Why This Matters

Sanctuary holds rich, structured Bitcoin data — but today it's only accessible through the web UI or REST API. Making it an MCP server turns Sanctuary into a **data source any AI can reason over**, without building custom integrations for each LLM tool.

### Concrete Use Cases

1. **Natural language wallet queries** — "How much did I spend last month?" / "Show me my largest UTXOs" / "What's my average transaction fee?"
2. **UTXO management advice** — Analyze UTXO set (dust count, age distribution, frozen amounts), recommend consolidation strategies timed to low-fee periods.
3. **Privacy analysis** — Examine transaction patterns, address reuse, UTXO linkability, flag privacy concerns.
4. **Fee optimization** — Check current fee estimates, compare to historical patterns, give timing advice.
5. **Audit & anomaly detection** — "Flag any unusual activity in the last 7 days." Second pair of eyes on access patterns.
6. **Cross-wallet intelligence** — "Which wallet has the healthiest UTXO set?" / "Show me my total holdings across all wallets."
7. **Label-powered reporting** — Spending reports, tax summaries, category breakdowns from labeled transactions.
8. **Vault policy comprehension** — "What happens if I try to send 0.5 BTC from this wallet?"

### Strategic Value

- **Privacy-preserving AI** — All data stays local. No wallet data leaves your machine.
- **MCP is becoming the standard** — Claude Desktop, Cursor, VS Code ecosystem is adopting MCP.
- **Differentiator** — No other self-hosted Bitcoin wallet exposes an MCP interface.
- **Foundation for write tools** — Starting read-only is safe; architecture supports adding writes later.

---

## Architecture

### New Docker container: `mcp`

Follows the same pattern as `worker` — reuses the `sanctuary-backend:local` image with a different entrypoint (`node dist/app/src/mcp-entry.js`). Connects to PostgreSQL and Redis on `sanctuary-network`. Bound to loopback by default (`127.0.0.1:3003`). Behind a Compose profile (`mcp`) — not started by default.

```
┌──────────────────────────────────────────────────┐
│  Host Machine (loopback only)                     │
│  ┌────────────┐         ┌──────────────────────┐ │
│  │ LM Studio  │ ──HTTP──▶ 127.0.0.1:3003  MCP  │ │
│  │ llama.cpp  │         │  (Streamable HTTP)    │ │
│  │ Ollama     │         │                        │ │
│  └────────────┘         └────────┬───────────────┘ │
│                                  │ sanctuary-network│
│                         ┌────────▼───────────────┐ │
│                         │  PostgreSQL / Redis     │ │
│                         └────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Transport: Streamable HTTP (spec 2025-11-25, stateless mode)

Per the current MCP specification (`2025-11-25`), Streamable HTTP supports `POST`, `GET`, and `DELETE` on a single endpoint. **V1 runs in stateless mode:**

- `POST /mcp` — the only method clients use. Each request is an independent JSON-RPC message. Response is a single JSON object (no SSE streaming).
- `GET /mcp` — returns HTTP 405 Method Not Allowed. V1 has no server-initiated streams or resumption.
- `DELETE /mcp` — returns HTTP 405 Method Not Allowed. V1 has no sessions to terminate.
- `MCP-Protocol-Version` header is required on `POST`. No `MCP-Session-Id` handling in v1.

Tests verify the 405 behavior on `GET` and `DELETE` so operators don't expect session support that v1 deliberately omits. The SDK's `StreamableHTTPServerTransport` is configured with sessions disabled.

### Authentication: API Key (Sanctuary-local extension)

This is a Sanctuary-local auth extension, not spec-compliant MCP OAuth authorization. Local LLMs can't do interactive login flows.

- New `McpApiKey` Prisma model (hashed keys, bound to a user, optional expiry, scoped)
- Key format: `mcp_<64 hex chars>` — generated from 32 bytes CSPRNG entropy
- Passed as `Authorization: Bearer mcp_...` header
- Each key has explicit scopes: `walletIds` (optional restriction), `allowAuditLogs` flag
- Key hash comparison uses `crypto.timingSafeEqual`
- `Origin`/`Host` validation to reduce DNS rebinding risk
- All MCP operations logged to audit log
- `lastUsedAt` updates throttled (max once per 5 minutes) to avoid per-request DB writes
- Bearer values redacted from all logs

**Per-request auth context:** Auth state (userId, key scope, wallet access set) is strictly per-request — never stored in module globals or singleton server state. Passed through the SDK transport extras or a request-scoped context object so concurrent clients cannot bleed authorization into each other.

**Scope validation — at creation and at use:**
- **At creation** (`POST`): every requested `walletId` in the scope must exist and be accessible to the target user. Admins get immediate feedback for invalid scopes.
- **At request time**: enforce the intersection of the user's current wallet access and the key's `walletIds` scope, because wallet sharing can change after key creation.

**Admin key management — revoke-first design:**
- `POST /api/v1/admin/mcp-keys` — creates key, returns the full `mcp_...` token exactly once. Requires target `userId` and visible `name` so ownership is clear.
- `GET /api/v1/admin/mcp-keys` — returns metadata and `keyPrefix` only, never the full token.
- `DELETE /api/v1/admin/mcp-keys/:id` — sets `revokedAt` (soft-delete). Audit history remains intact. No hard-delete endpoint.

---

## File Structure

```
server/src/mcp/
  index.ts                  # MCP server construction, resource/tool/prompt registration
  config.ts                 # MCP env var configuration
  auth.ts                   # API key validation → userId resolution (per-request)
  transport.ts              # Streamable HTTP transport (Express micro-app, stateless)
  types.ts                  # MCP context types, BigInt serializer
  dto.ts                    # MCP Data Transfer Objects (redacted shapes)
  health.ts                 # Health endpoint for Docker readiness
  metrics.ts                # Prometheus counters/histograms for MCP operations
  resources/
    index.ts                # Registration barrel
    wallets.ts              # Wallet list + detail
    transactions.ts         # Transaction history + detail
    utxos.ts                # UTXO set
    addresses.ts            # Address list
    labels.ts               # Labels with associations
    fees.ts                 # Fee estimates (cache-only)
    price.ts                # BTC price (cache-only)
    insights.ts             # AI insights
    policies.ts             # Vault policies
    drafts.ts               # Draft transactions (status-only DTO)
    auditLogs.ts            # Audit logs (admin)
  tools/
    index.ts                # Registration barrel
    queryTransactions.ts    # Search/filter transactions
    queryUtxos.ts           # Search/filter UTXOs
    searchAddresses.ts      # Address lookup
    walletAnalytics.ts      # Balance history, spending velocity
    walletOverview.ts       # Comprehensive wallet summary
    feeEstimation.ts        # Current fee estimates (cache-only)
    priceConversion.ts      # Sats ↔ fiat conversion (cache-only)
  prompts/
    index.ts                # Registration barrel
    transactionAnalysis.ts  # Analyze a specific transaction
    utxoManagement.ts       # UTXO consolidation advice
    spendingAnalysis.ts     # Spending pattern analysis
    feeOptimization.ts      # Fee timing advice
    walletHealth.ts         # Overall wallet health check
server/src/mcp-entry.ts     # Process lifecycle: DB connect, Redis init, start MCP server
```

**Entry point split:** `server/src/mcp-entry.ts` owns process lifecycle (DB, Redis, signal handlers, startup/shutdown). `server/src/mcp/index.ts` and `transport.ts` own MCP server construction and HTTP wiring. No `server/src/mcp/entry.ts` — single lifecycle owner avoids duplicate startup/shutdown logic.

---

## Data Transfer Objects (DTOs)

Never return raw Prisma models. Build explicit MCP DTOs that redact sensitive fields:

**Always strip:**
- Wallet descriptors and xpub data
- User emails, passwords, 2FA secrets
- Node config details, encrypted secrets
- Internal IDs not useful for LLM reasoning
- Bearer tokens, key hashes

**Always include:**
- Data timestamps so stale fee/price data is visible
- Human-readable identifiers (wallet name, label names)
- Amounts as string-serialized sats (BigInt safety)

**Draft DTO denylist** (enforced explicitly and tested):
- `psbtBase64`, `signedPsbtBase64` — PSBT material never exposed
- `inputPaths`, `changeAddress` — derivation paths never exposed
- Selected UTXO IDs, policy snapshots — internal implementation details
- Draft resources expose status only: `id`, `name`, `status`, `createdAt`, `expiresAt`, `totalAmount` (string sats), `feeAmount` (string sats), `recipientCount`

---

## MCP Resources (Read-Only)

All resources reuse the existing **repository layer** — no new data access patterns.

**Access control rule:** Every wallet-scoped handler must call `requireWalletAccess(walletId, userId)` before running the wallet-scoped read. Repositories like transaction, label, policy, and draft don't enforce user access themselves. `sanctuary://audit-logs` requires admin check on the API key's user. Per-key `walletIds` scope is enforced on top of the user's existing access — a scoped key can only access the intersection of the user's wallets and the key's `walletIds`.

**Hard limits on all resources:** Max page size (default 100, cap 500), max date range, stable sorting, default limit.

**No external network calls from MCP reads.** Fee and price resources use dedicated cache-only read APIs (not existing service methods that may fetch on cache miss). These return the most recent cached value from the database/Redis and include `asOf`, `source`, and `stale` fields. If no cached value exists, the response indicates "unavailable" rather than triggering a fetch.

| Resource URI | Data | Repository/API |
|---|---|---|
| `sanctuary://wallets` | All wallets the user can access | `walletRepository.findByUserId()` |
| `sanctuary://wallets/{id}` | Wallet detail + sync status | `walletRepository.findByIdWithAccess()` |
| `sanctuary://wallets/{id}/balance` | Confirmed/unconfirmed sats | `utxoRepository` aggregation |
| `sanctuary://wallets/{id}/transactions` | Recent txs (paginated) | `transactionRepository.findByWalletIdPaginated()` |
| `sanctuary://wallets/{id}/transactions/{txid}` | Single tx with inputs/outputs | see note below |
| `sanctuary://wallets/{id}/utxos` | Unspent outputs | `utxoRepository.findUnspentWithDraftLocks()` |
| `sanctuary://wallets/{id}/addresses` | Addresses with labels | `addressRepository.findByWalletIdWithLabels()` |
| `sanctuary://wallets/{id}/labels` | Labels with counts | `labelRepository.findByWalletId()` |
| `sanctuary://wallets/{id}/policies` | Vault policies | `policyRepository.findAllPoliciesForWallet()` |
| `sanctuary://wallets/{id}/drafts` | Draft txs (status-only DTO) | `draftRepository.findByWalletId()` |
| `sanctuary://wallets/{id}/insights` | AI insights | `intelligenceRepository` |
| `sanctuary://fees` | Current fee estimates (cached) | Cache-only fee read API |
| `sanctuary://price/{currency}` | BTC price (cached) | Cache-only price read API |
| `sanctuary://audit-logs` | Recent audit trail (admin only) | `auditLogRepository` |

**Transaction by txid:** The `sanctuary://wallets/{id}/transactions/{txid}` handler binds both URI parameters. `requireWalletAccess(walletId, userId)` first, then verify the txid belongs to that specific wallet (not just any accessible wallet). Use `findByTxid(txid, walletId)` or add a new `findByTxidForWallet(txid, walletId)` repository helper.

---

## MCP Tools (Read-Only Queries)

Every tool defines an `outputSchema` and returns `structuredContent` alongside a compact text summary. This follows current MCP guidance and prevents clients from scraping JSON out of prose. No-argument tools use an explicit empty object input schema with `additionalProperties: false`. Task support is set to forbidden on all tools.

| Tool | Description | Inputs |
|---|---|---|
| `query_transactions` | Search/filter transactions | `walletId, type?, dateFrom?, dateTo?, minAmount?, maxAmount?, limit?` |
| `query_utxos` | Filter UTXOs | `walletId, spent?, frozen?, minAmount?, maxAmount?, limit?` |
| `search_addresses` | Address lookup | `walletId, query?, used?, hasLabels?` |
| `get_wallet_overview` | Comprehensive summary | `walletId` → balance, tx count, UTXO count, pending drafts, policies |
| `get_wallet_analytics` | Analytics metrics | `walletId, metric (velocity|utxo_age|tx_types|fees), period?` |
| `get_balance_history` | Balance over time | `walletIds, startDate, bucketUnit` |
| `get_fee_estimates` | Network fee rates (cached) | `{}` (empty object) |
| `convert_price` | Sats ↔ fiat (cached) | `sats?, fiatAmount?, currency?` |

All tools use Zod input validation. All enforce wallet access via `userId`.

**Multi-wallet tools** (`get_balance_history`): dedupe `walletIds`, cap at 20, access-check each wallet before querying.

**Per-tool limits:** Each tool defines its own max `limit` (default 100, cap 500). Amounts are always string-serialized sats; integer values only when within `Number.MAX_SAFE_INTEGER`.

---

## MCP Prompts

| Prompt | Purpose |
|---|---|
| `transaction_analysis` | Deep-dive on a single tx: type, fee efficiency, privacy |
| `utxo_management` | Consolidation advice based on UTXO set + fee environment |
| `spending_analysis` | Spending patterns, velocity, trends by label |
| `fee_optimization` | When to send based on current/historical fees |
| `wallet_health` | Overall health: dust ratio, address reuse, sync status |

**Prompt guidelines:**
- Explicitly advisory and read-only — no financial/tax/legal advice framing
- No transaction construction instructions or claims the model can freeze/spend/label
- Cite data timestamp/source so stale fee or price data is visible to the user

---

## Security

1. **API key auth** — keys generated from 32 bytes CSPRNG, hashed with SHA-256, compared with `crypto.timingSafeEqual`. Short prefix stored for display. Bearer values redacted from logs.
2. **Per-key scopes** — `walletIds` (optional restriction), `allowAuditLogs` flag, `expiresAt`. Validated at creation (walletIds must exist and be accessible to target user) and at use (intersection of current access and key scope).
3. **Access control** — every resource/tool calls `requireWalletAccess(walletId, userId)` before wallet-scoped reads. Audit logs require admin check.
4. **Read-only** — no mutations exposed, period.
5. **Rate limiting** — configurable per-key rate limit (default 120/min). New `mcpDefault` rate limit policy.
6. **Audit logging** — MCP operations logged with `category: 'mcp'`, metadata-only details. Log: operation type/name, walletId, key prefix, success/failure, latency, row/count summaries. Do NOT log: full tool arguments, address lists, transaction data, labels, PSBT material, or resource responses. Requires updating `AuditCategory` type.
7. **Network** — bound to loopback by default (`127.0.0.1:3003`). `Origin`/`Host` header validation for DNS rebinding protection.
8. **BigInt safety** — satoshi amounts serialized as strings (no JSON.parse precision loss).
9. **DTO redaction** — never expose xpubs, descriptors, PSBTs, derivation paths, emails, encrypted secrets, or internal-only IDs.
10. **`lastUsedAt` throttling** — max one DB write per 5 minutes per key to avoid per-request overhead.
11. **Per-request isolation** — auth context never in module globals or singletons. Concurrent clients cannot bleed state.

---

## Database Changes

New model `McpApiKey`:
```prisma
model McpApiKey {
  id              String    @id @default(uuid())
  userId          String
  createdByUserId String?   // Plain string, not FK — audit log provides referential history
  name            String
  keyHash         String    @unique
  keyPrefix       String
  scope           Json?     // { walletIds?: string[], allowAuditLogs?: boolean }
  lastUsedAt      DateTime?
  lastUsedIp      String?
  lastUsedAgent   String?
  expiresAt       DateTime?
  createdAt       DateTime  @default(now())
  revokedAt       DateTime?
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@index([revokedAt])
  @@map("mcp_api_keys")
}
```

`createdByUserId` is a plain string (denormalized audit metadata), not a foreign key. This avoids Prisma named-relation complexity and a second User inverse field. The audit log provides full referential history of who created which key.

**User model:** Add inverse relation `mcpApiKeys McpApiKey[]`.

**Backup semantics:** Revoke all MCP API keys on restore — prevents backup restore from resurrecting old bearer credentials.

---

## Observability

New file `server/src/mcp/metrics.ts` — Prometheus instrumentation for MCP operations:

- **Counter:** `mcp_auth_failures_total` — by `reason` (invalid, expired, revoked, scope_denied)
- **Counter:** `mcp_rate_limit_hits_total` — no key-specific labels (cardinality risk)
- **Counter:** `mcp_operations_total` — by `type` (resource, tool, prompt) and `name`
- **Histogram:** `mcp_operation_duration_seconds` — by `type` and `name`
- **Histogram:** `mcp_response_size_bytes` — by `type` and `name`

All labels are low-cardinality (reason/type/name). Key prefix is logged in audit logs only — never as a Prometheus label to avoid unbounded metric cardinality and credential metadata exposure through `/metrics`.

---

## Docker Compose Addition

```yaml
mcp:
  image: sanctuary-backend:local
  pull_policy: never
  restart: unless-stopped
  profiles:
    - mcp
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
  environment:
    NODE_OPTIONS: "--max-old-space-size=512"
    NODE_ENV: ${NODE_ENV:-production}
    LOG_LEVEL: ${LOG_LEVEL:-info}
    DATABASE_URL: postgresql://${POSTGRES_USER:-sanctuary}:${POSTGRES_PASSWORD:-sanctuary}@postgres:5432/${POSTGRES_DB:-sanctuary}?schema=public&connection_limit=${DB_MCP_POOL_SIZE:-5}&pool_timeout=30&connect_timeout=10&statement_timeout=30000
    REDIS_URL: redis://:${REDIS_PASSWORD:-}@redis:6379
    MCP_ENABLED: "true"
    MCP_PORT: 3003
    MCP_RATE_LIMIT_PER_MINUTE: ${MCP_RATE_LIMIT:-120}
    JWT_SECRET: ${JWT_SECRET}
    ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    ENCRYPTION_SALT: ${ENCRYPTION_SALT:-sanctuary-node-config}
    GATEWAY_SECRET: ${GATEWAY_SECRET:-}
    BITCOIN_NETWORK: ${BITCOIN_NETWORK:-mainnet}
  command: ["node", "dist/app/src/mcp-entry.js"]
  ports:
    - "127.0.0.1:${MCP_PORT:-3003}:3003"
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3003/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 10s
  networks:
    - sanctuary-network
  logging:
    driver: "json-file"
    options:
      max-size: "10m"
      max-file: "3"
  deploy:
    resources:
      limits: { cpus: '0.5', memory: 512M }
      reservations: { cpus: '0.1', memory: 128M }
  mem_swappiness: 10
  memswap_limit: 640M
```

**`start.sh` updates — all paths, not just start:**
- `--with-mcp` flag enables the `mcp` profile and persists `ENABLE_MCP=yes`, matching existing AI/Tor/monitoring patterns.
- `--stop`, `--logs`, and `--rebuild` include the `mcp` profile when `ENABLE_MCP=yes` or when an MCP container is already present. Otherwise the MCP service can be omitted from logs/rebuilds or left running unexpectedly.

---

## Implementation Order

### Phase 1: Foundation
1. `server/src/mcp/types.ts` — context types, BigInt serializer
2. `server/src/mcp/dto.ts` — DTO shapes with redaction helpers (including draft denylist)
3. `server/src/mcp/config.ts` — env var config
4. Update `server/src/config/types.ts` — add `McpConfig` interface
5. Update `server/src/config/schema.ts` — add `McpConfigSchema`
6. Update `server/src/config/index.ts` — load MCP config section
7. Prisma migration for `McpApiKey` model + inverse relation on `User`
8. `server/src/repositories/mcpApiKeyRepository.ts` + export from barrel
9. Update `AuditCategory` in audit service, repository, OpenAPI schemas
10. Add `mcpDefault` rate limit policy in `server/src/services/rateLimiting/policies.ts`
11. `server/src/mcp/auth.ts` — API key validation, timingSafeEqual, per-request context, scope checking (creation + use)
12. `server/src/mcp/health.ts` — health endpoint for Docker readiness
13. `server/src/mcp/metrics.ts` — Prometheus counters/histograms (low-cardinality labels only)
14. `server/src/mcp/transport.ts` — Streamable HTTP transport (stateless, sessions disabled, 405 on GET/DELETE)
15. `server/src/mcp/index.ts` — McpServer construction with `@modelcontextprotocol/sdk`
16. `server/src/mcp-entry.ts` — process lifecycle (DB connect, Redis init, start, signal handlers)
17. `server/src/api/admin/mcpKeys.ts` — admin routes (POST returns token once + validates scope walletIds, GET returns metadata/prefix, DELETE soft-revokes)
18. Request/response schemas for admin MCP key routes
19. Update backup/restore to revoke MCP API keys on restore
20. Add cache-only read APIs for fee and price data (no network I/O, returns stale/missing)

### Phase 2: Resources
21. Implement all resource handlers with DTO redaction, access control, and `requireWalletAccess` gate
22. Transaction-by-txid handler with dual URI parameter binding (`walletId` + `txid`)
23. Fee/price resources using cache-only APIs with `asOf`/`source`/`stale` fields
24. Resource registration barrel

### Phase 3: Tools
25. Implement all read-only tools with `outputSchema`, `structuredContent`, per-tool limits, and multi-wallet access checks
26. Tool registration barrel

### Phase 4: Prompts
27. Implement prompt templates with advisory disclaimers and data timestamps
28. Prompt registration barrel

### Phase 5: Docker & Integration
29. Docker compose additions (profile, loopback, healthcheck)
30. `start.sh` updates — all paths (`--with-mcp`, `--stop`, `--logs`, `--rebuild` MCP-aware)
31. Documentation: client setup examples for MCP Inspector and at least one local LLM client
32. End-to-end verification

---

## Dependency

Single new dependency in `server/package.json`:
```
"@modelcontextprotocol/sdk": "^1.29.0"
```

Check latest version with `npm view @modelcontextprotocol/sdk version` before installing. `zod` already present.

---

## Key Files to Modify
- `server/package.json` — add MCP SDK dependency
- `server/prisma/schema.prisma` — add `McpApiKey` model + User inverse relation
- `server/src/config/types.ts` — add `McpConfig` interface to `AppConfig`
- `server/src/config/schema.ts` — add `McpConfigSchema`
- `server/src/config/index.ts` — load MCP config section
- `server/src/repositories/index.ts` — export new `mcpApiKeyRepository`
- `server/src/repositories/auditLogRepository.ts` — add `'mcp'` to `AuditCategory`
- `server/src/services/rateLimiting/policies.ts` — add `mcpDefault` policy
- `server/src/api/admin/mcpKeys.ts` — new admin route file
- `server/src/api/schemas/admin.ts` — MCP key request/response schemas
- `docker-compose.yml` — add `mcp` service under `mcp` profile
- `start.sh` — add `--with-mcp` flag + MCP-aware stop/logs/rebuild
- `server/package-lock.json` — update with the MCP SDK dependency
- `docs/` — client setup examples for MCP Inspector and local LLM clients

---

## Verification

1. **Unit tests**: Each resource handler, tool handler, auth module, and DTO serialization tested with mocked repositories
2. **TypeScript**: `cd server && npx tsc --noEmit` passes
3. **Integration test**: Start Docker stack with `--with-mcp`, generate API key via admin endpoint, use MCP Inspector to connect and browse resources/call tools
4. **Security tests**:
   - Expired/revoked keys rejected
   - Access control prevents cross-user wallet access
   - Rate limiting works per-key
   - DTO serialization never emits raw `bigint`, descriptors/xpubs, PSBTs, derivation paths, or bearer tokens
   - Concurrent requests with different API keys don't bleed auth state
5. **Protocol-level negative tests**:
   - Missing/invalid `MCP-Protocol-Version` header
   - `GET /mcp` returns 405
   - `DELETE /mcp` returns 405
   - Bad `Origin` header
   - Wrong API key prefix, revoked key, expired key
   - Attempt to access another user's wallet
   - Attempt to access wallet outside key's `walletIds` scope
   - Scope with invalid walletId at creation time rejected
6. **End-to-end**: Connect a local LLM (via MCP client) and query wallet data
