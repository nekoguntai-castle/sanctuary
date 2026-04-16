# MCP Server

Sanctuary can expose a read-only Model Context Protocol endpoint for local LLM clients. The service is disabled by default and runs as a separate Docker Compose profile.

## Start The Service

```bash
./start.sh --with-mcp
```

Default endpoint:

```text
http://127.0.0.1:3003/mcp
```

The Docker service listens inside the container on `0.0.0.0:3003`, but the host port is published to loopback by default. Override with:

```bash
MCP_BIND_ADDRESS=127.0.0.1 MCP_PORT=3003 ./start.sh --with-mcp
```

## Create An API Key

Create keys from the admin API:

```bash
curl -X POST https://localhost:8443/api/v1/admin/mcp-keys \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<target-user-id>",
    "name": "Local LLM",
    "walletIds": ["<optional-wallet-id>"],
    "allowAuditLogs": false
  }'
```

The response includes the full `mcp_...` token exactly once. Later list responses only include `keyPrefix` metadata.

## Connect A Client

Use Streamable HTTP with:

```text
Authorization: Bearer mcp_<token>
MCP-Protocol-Version: 2025-11-25
```

The server is stateless. `POST /mcp` is supported; `GET /mcp` and `DELETE /mcp` intentionally return `405`.

## Security Notes

- Read-only only: no spending, signing, label edits, draft creation, or policy changes.
- Wallet descriptors, xpubs, PSBTs, derivation paths, key hashes, and bearer tokens are never returned by MCP DTOs.
- Fee and price resources are cache-only. MCP reads never fetch external services on cache miss.
- Every MCP request is audit logged under the `mcp` category.
- Audit log reads require both an admin user and an API key created with `allowAuditLogs: true`.
- API keys are included in Sanctuary backups as hashes and metadata, not as reusable bearer tokens.

## Key Management

List metadata:

```bash
curl https://localhost:8443/api/v1/admin/mcp-keys \
  -H "Authorization: Bearer <admin-jwt>"
```

Revoke a key:

```bash
curl -X DELETE https://localhost:8443/api/v1/admin/mcp-keys/<key-id> \
  -H "Authorization: Bearer <admin-jwt>"
```
