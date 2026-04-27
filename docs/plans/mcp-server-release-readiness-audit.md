# MCP Server Release Readiness Audit

Date: 2026-04-25
Commit audited: `accfd6df chore: restore grade and split compose benchmark (#181)`
Status: not release-ready for LAN MCP as the default next-release story; viable as a loopback-only read-only preview after the security and docs issues below are fixed.

Update: this is the pre-implementation audit that drove PRs #182 through #194. The current release proof and operator checklist live in `docs/plans/ai-mcp-console-release-proof.md` and `docs/how-to/ai-mcp-console.md`. Keep this file as historical evidence of the original gaps.

## Scope

This audit covers two possible product paths:

1. Direct MCP path: an external MCP client or LAN-hosted LLM connects to Sanctuary's MCP HTTP endpoint.
2. In-app console path: Sanctuary exposes a terminal-like assistant in the GUI, sends prompts to a configured LAN LLM, and lets the backend invoke the same read-only wallet/transaction tool surface.

The target is "most GUI read features via MCP" plus natural-language questions about transactions, wallets, balances, UTXOs, policies, drafts, fees, prices, insights, and audit data where authorized. Spending, signing, PSBT export/import, address generation, label mutation, wallet mutation, policy mutation, and other write workflows are intentionally out of scope until there is a separate confirmation and authorization model.

## Executive Verdict

Sanctuary already has a real read-only MCP foundation: `POST /mcp`, bearer-token authentication, wallet-scoped API keys, audit logging, rate limiting, read-only resource/tool annotations, DTO redaction, and cache-only fee/price reads. It is a good base for local wallet Q&A.

It does not yet meet the stated next-release goal for a LAN-accessible external LLM/client. The default Compose and config surface keep MCP on loopback, docs do not show a correct LAN setup, the prebuilt Compose file does not include MCP, HTTP transport has no built-in TLS, backups currently restore MCP key hashes as still-usable credentials, tests do not prove real client compatibility, and read parity with the GUI is incomplete.

The safer near-term product is the in-app Sanctuary Console path. It can reuse the existing Treasury Intelligence chat and AI proxy architecture, keep the MCP port loopback-only or disabled, enforce browser user auth and wallet access in the backend, and still use the same MCP/read tool registry for answers.

## Implemented MCP Surface

- Server construction: `server/src/mcp/index.ts` creates an SDK `McpServer`, registers resources, tools, and prompts, and advertises logging. The server version is hardcoded to `0.8.34`, while package versions are `0.8.44`.
- Transport: `server/src/mcp/transport.ts` exposes `POST /mcp`, rejects `GET /mcp` and `DELETE /mcp`, validates protocol versions, authenticates every POST, rate-limits by MCP key, logs each operation, and creates a stateless `StreamableHTTPServerTransport`.
- Resources: `wallets`, wallet detail, balance, transactions, transaction detail, UTXOs, addresses, labels, policies, drafts, insights, fees, price, and audit logs.
- Tools: transaction query, UTXO query, address search, wallet overview, wallet analytics, balance history, fee estimates, price conversion, and draft status lookup.
- Prompts: transaction analysis, UTXO management, spending analysis, fee optimization, and wallet health.
- Authentication: MCP API keys use the `mcp_<64 hex>` token format, HMAC-hashed lookup, timing-safe comparison, revocation, optional expiry, wallet scope, and `allowAuditLogs` scope.

## Release Blockers

1. LAN direct access is not ready as documented. `docker-compose.yml` publishes MCP to `${MCP_BIND_ADDRESS:-127.0.0.1}:${MCP_PORT:-3003}`, and `MCP_ALLOWED_HOSTS` defaults to loopback hostnames only. The docs say to override the bind address but the example still uses `127.0.0.1`. A LAN client needs a documented config such as `MCP_BIND_ADDRESS=0.0.0.0`, a specific `MCP_ALLOWED_HOSTS` entry for the Sanctuary LAN hostname or IP, firewall guidance, and preferably TLS/VPN guidance.
2. Plain HTTP over LAN exposes bearer tokens and wallet metadata to the local network. Direct LAN MCP should be documented as requiring HTTPS termination, WireGuard/Tailscale, or another trusted encrypted channel. The unauthenticated `/health` and `/metrics` endpoints are also published with the MCP service.
3. Backup/restore currently resurrects MCP API keys. `mcpApiKey` is in the backup table order, restore bulk-inserts records, and there is no special handling to revoke restored MCP keys. The docs say backups contain hashes and metadata "not reusable bearer tokens", but restoring the hash makes any previously known token usable again.
4. There is no release-grade integration proof. Existing tests cover units around auth, transport, DTOs, repositories, metrics, route handlers, rate-limit policy, and support collection, but not an actual SDK MCP client using a DB-backed key, resource/tool/prompt listing, host allowlist behavior, Docker `--with-mcp`, MCP Inspector, or a local LLM client.
5. GUI read parity is incomplete. Current MCP is useful for core wallet reads, but it does not cover many GUI read workflows listed below.

## High-Risk Gaps

- Authentication is custom bearer-key auth, not MCP 2025-11-25 OAuth protected-resource metadata. This can be acceptable for a self-hosted local deployment, but direct HTTP MCP clients increasingly expect the authorization discovery shape. If we keep API keys, document that it is a custom auth mode and still return standards-aligned `401` challenges where practical.
- API keys can be created without expiry and without wallet scope, which means "all wallets the target user can access." For LAN LLM usage, the default should be expiring and wallet-scoped.
- Tool output schemas are generic passthrough objects. Local LLM tool use will be better and safer with precise output schemas for transactions, UTXOs, balances, fees, drafts, and analytics.
- Strictly requiring `MCP-Protocol-Version` on every POST may reject clients that follow the spec fallback behavior for initial requests.
- Audit-log reads are correctly admin plus `allowAuditLogs`, but returned audit data can include IP address, user agent, and details. Keep that as an explicit high-privilege scope.
- The existing AI chat path passes only supplied `walletContext` into the AI proxy and does not have tool-calling. This is a good isolation baseline, but the terminal-like console will need a backend-owned tool execution loop, not arbitrary LLM access to the database or shell.

## GUI Read-Parity Gaps

Add read-only MCP coverage for these before claiming "most GUI features":

- Dashboard: network-filtered totals, pending counts by wallet, portfolio summaries, and sparkline or balance-history views.
- Wallet detail: device/share/access summaries, privacy summary, address summary, transaction stats, explorer URLs, and wallet logs.
- Transactions: pending transaction reads, transaction stats, export-equivalent structured reads, and possibly raw transaction hex only under an explicit sensitive-data scope.
- UTXOs: wallet privacy summary, per-UTXO privacy scoring, and coin-selection simulation that does not lock or mutate coins.
- Addresses: address summary and address detail/lookup. Do not expose address generation through MCP.
- Labels: label detail with associated transaction/address references and transaction/address label reads. Do not expose create/update/delete or assignment as part of the read-only release.
- Policies: policy detail, policy events, policy addresses, and dry-run policy evaluation. Admin/global policy reads should require admin scope.
- Drafts: sanitized output counts, fee rate, warning/approval summaries, and lifecycle status. Do not expose PSBTs in the default surface.
- Fees/prices: advanced fee views, configured currencies/providers, provider health, cache stats, and stored history without external fetch side effects.
- Insights: filter/count/status/settings reads. Do not expose insight status updates or chat mutations through external MCP.
- Admin/ops: filtered audit stats, MCP key metadata, agent dashboard/alerts/options, feature flags, monitoring, cache/DLQ, node/electrum reads, all behind explicit admin scopes.

## Two-Path Recommendation

Path 1: Direct external MCP client or LAN LLM

- Use this for power users, MCP Inspector, Claude Desktop-style clients, and dedicated LAN agents.
- Require `MCP_BIND_ADDRESS` and `MCP_ALLOWED_HOSTS` to be explicit for LAN exposure.
- Require bearer auth on every MCP request, with scoped expiring keys. Prefer defaults like 30-day expiry, one wallet, no audit logs, and clear display of last-used IP/user-agent.
- Require HTTPS/VPN/reverse-proxy guidance before recommending LAN use.
- Add a "rotate after restore" mechanism or automatically revoke imported MCP keys.
- Add standards-aligned auth metadata or at least standards-aligned `WWW-Authenticate` responses for MCP clients.
- Add integration tests and a documented MCP Inspector/local-client config.

Path 2: In-app Sanctuary Console

- This should be the preferred general-user path.
- Build on the existing Treasury Intelligence chat and AI proxy instead of creating a second assistant stack.
- Do not implement an OS shell. Make it a command/chat console that can call approved Sanctuary tools and show tool-call traces.
- Keep tool execution in the Sanctuary backend. The browser sends the user's prompt; the backend calls the LAN LLM through the AI proxy; the backend decides which read-only tools can run; the backend executes them under the logged-in user's auth and wallet access.
- Prefer a shared in-process read-tool registry used by both MCP and the console, with MCP as one transport adapter. That avoids the console needing to mint and store an MCP bearer token for itself.
- If the console consumes the HTTP MCP server anyway, use a loopback-only service token generated for the backend, never expose that token to the browser or LLM.
- Add explicit consent for any future write-like action. For the next release, keep console tools read-only and generate "open this screen" or "prepare a draft" suggestions rather than mutating state.

## Other Design Ideas To Consider

- Tool trace pane: show each tool call, arguments, duration, result size, and whether data was redacted.
- Sensitivity levels: classify tool outputs as public, wallet-private, high-sensitivity, and admin-only. Let users choose the maximum level a LAN LLM may see.
- Result budgets: enforce token/row limits, response byte limits, and summarization before sending large transaction sets to the LLM.
- Query planner: have the LLM propose a structured plan, validate it against allowed tools, then execute. Never let model text become raw DB queries.
- Prompt-injection handling: treat wallet labels, memos, counterparties, and audit details as untrusted data. They should be data in tool results, not instructions.
- Wallet-scoped sessions: bind each conversation to one wallet or an explicit wallet set, then make cross-wallet reads a visible escalation.
- Deterministic calculations: balances, totals, fee math, and counts should be computed by Sanctuary tools, not inferred by the model.
- Saved investigations: let users save console sessions as audit-backed investigation notes without storing raw high-sensitivity payloads by default.
- Remote agent profiles: create named MCP/console profiles such as "Read-only analyst", "Auditor", and "Operations", each with fixed scopes, expiry, and rate limits.
- Restore safety: after backup restore, force review or regeneration of all external-access credentials, including MCP keys and AI integration secrets.

## Tests Run

Focused MCP validation passed:

```text
npx vitest run tests/unit/mcp/auth.test.ts tests/unit/mcp/cache-health.test.ts tests/unit/mcp/dto.test.ts tests/unit/mcp/metrics.test.ts tests/unit/mcp/repositories.test.ts tests/unit/mcp/transport.test.ts tests/unit/api/admin-mcpKeys-routes.test.ts tests/unit/services/supportPackage/mcpCollector.test.ts tests/unit/services/rateLimiting/policies.test.ts

Test Files  9 passed (9)
Tests       85 passed (85)
```

## Evidence References

- MCP server construction: `server/src/mcp/index.ts`
- MCP transport/auth/rate/audit: `server/src/mcp/transport.ts`, `server/src/mcp/auth.ts`
- MCP resources/tools/prompts: `server/src/mcp/resources/index.ts`, `server/src/mcp/tools/index.ts`, `server/src/mcp/prompts/index.ts`
- MCP deployment config: `docker-compose.yml`, `server/src/config/index.ts`, `start.sh`, `docs/how-to/mcp-server.md`
- Backup restore behavior: `server/src/services/backupService/restore.ts`, `server/src/services/backupService/constants.ts`, `server/src/services/backupService/serialization.ts`
- Existing AI console base: `components/Intelligence/tabs/ChatTab.tsx`, `server/src/services/intelligence/conversationService.ts`, `ai-proxy/src/index.ts`, `server/src/api/ai-internal.ts`
- Official MCP references checked: `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports`, `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization`, `https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices`
