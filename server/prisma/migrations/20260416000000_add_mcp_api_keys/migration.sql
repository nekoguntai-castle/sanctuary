-- Create MCP API keys table for local read-only Model Context Protocol access.
CREATE TABLE "mcp_api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scope" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "lastUsedAgent" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "mcp_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_api_keys_keyHash_key" ON "mcp_api_keys"("keyHash");
CREATE INDEX "mcp_api_keys_userId_idx" ON "mcp_api_keys"("userId");
CREATE INDEX "mcp_api_keys_expiresAt_idx" ON "mcp_api_keys"("expiresAt");
CREATE INDEX "mcp_api_keys_revokedAt_idx" ON "mcp_api_keys"("revokedAt");

ALTER TABLE "mcp_api_keys"
  ADD CONSTRAINT "mcp_api_keys_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
