# MCP Server

Sanctuary can expose a read-only Model Context Protocol endpoint for local LLM clients. The service is disabled by default and runs as a separate Docker Compose profile.

For the normal in-app assistant path, use [AI Settings, Sanctuary Console, And MCP Access](ai-mcp-console.md). Direct MCP is the advanced external-client path.

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

Prebuilt GHCR deployments use the same optional profile:

```bash
docker compose -f docker-compose.ghcr.yml --profile mcp up -d
```

Keep `MCP_BIND_ADDRESS=127.0.0.1` for local clients. To expose MCP to another machine on the LAN, bind to the LAN interface only behind a trusted TLS/VPN/reverse-proxy boundary:

```bash
MCP_BIND_ADDRESS=192.168.1.20 MCP_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.20 ./start.sh --with-mcp
```

Do not expose the MCP port directly to the public internet. Use expiring, wallet-scoped API keys for LAN clients.

## Create An API Key

The preferred key-management path is **Administration -> AI Settings -> MCP Access**. The admin UI shows server status, creates scoped keys, displays the one-time token, lists key metadata, and revokes keys.

Create keys from the admin API when automation needs it:

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

Some MCP clients omit `MCP-Protocol-Version` on the first `initialize` request. Sanctuary accepts that initial request when compatible, but rejects unsupported explicit protocol versions and non-initialize calls without a protocol header.

Example MCP Inspector settings:

```text
Transport: Streamable HTTP
Server URL: http://127.0.0.1:3003/mcp
Header: Authorization: Bearer mcp_<token>
```

The server is stateless. `POST /mcp` is supported; `GET /mcp` and `DELETE /mcp` intentionally return `405`.

## Security Notes

- Read-only only: no spending, signing, label edits, draft creation, or policy changes.
- Sanctuary Console is the recommended path for most users. Direct MCP is intended for loopback clients and trusted LAN clients behind TLS/VPN/reverse-proxy protection.
- Wallet descriptors, xpubs, PSBTs, derivation paths, key hashes, and bearer tokens are never returned by MCP DTOs.
- Fee and price resources are cache-only. MCP reads never fetch external services on cache miss.
- Every MCP request is audit logged under the `mcp` category.
- Audit log reads require both an admin user and an API key created with `allowAuditLogs: true`.
- API keys are included in Sanctuary backups as hashes and metadata. During restore, MCP keys are forced revoked so old bearer tokens cannot be reused on the restored node.

## Key Management

List metadata from the admin UI at **Administration -> AI Settings -> MCP Access**, or use the API:

```bash
curl https://localhost:8443/api/v1/admin/mcp-keys \
  -H "Authorization: Bearer <admin-jwt>"
```

Revoke a key from the same UI, or use the API:

```bash
curl -X DELETE https://localhost:8443/api/v1/admin/mcp-keys/<key-id> \
  -H "Authorization: Bearer <admin-jwt>"
```
