/**
 * Admin MCP API Key Router
 *
 * Admin-only management for local read-only MCP API keys.
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { createMcpApiKey, listMcpApiKeys, revokeMcpApiKey } from '../../services/adminMcpKeyService';
import { CreateMcpApiKeySchema, McpApiKeyIdParamSchema } from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';
import { toMcpApiKeyMetadata } from '../../mcp/dto';

const router = Router();

function parseKeyId(params: unknown): string {
  const parsed = McpApiKeyIdParamSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidInputError('Invalid MCP API key id');
  }
  return parsed.data.keyId;
}

/**
 * GET /api/v1/admin/mcp-keys
 * List MCP API key metadata. Full tokens and hashes are never returned.
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const keys = await listMcpApiKeys();
  res.json(keys.map(toMcpApiKeyMetadata));
}));

/**
 * POST /api/v1/admin/mcp-keys
 * Create a scoped read-only MCP API key. Returns full token once.
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const input = parseAdminRequestBody(CreateMcpApiKeySchema, req.body);
  const { key, apiKey, targetUser } = await createMcpApiKey(input, req.user?.userId ?? null);

  await auditService.logFromRequest(req, AuditAction.MCP_KEY_CREATE, AuditCategory.MCP, {
    details: {
      keyId: key.id,
      keyPrefix: key.keyPrefix,
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      walletScopeCount: input.walletIds?.length ?? 0,
      allowAuditLogs: input.allowAuditLogs === true,
      expiresAt: input.expiresAt?.toISOString(),
    },
  });

  res.status(201).json({
    ...toMcpApiKeyMetadata({ ...key, user: targetUser }),
    apiKey,
  });
}));

/**
 * DELETE /api/v1/admin/mcp-keys/:keyId
 * Soft-revoke an MCP API key.
 */
router.delete('/:keyId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const keyId = parseKeyId(req.params);
  const { key: revoked, alreadyRevoked } = await revokeMcpApiKey(keyId);

  await auditService.logFromRequest(req, AuditAction.MCP_KEY_REVOKE, AuditCategory.MCP, {
    details: {
      keyId: revoked.id,
      keyPrefix: revoked.keyPrefix,
      targetUserId: revoked.userId,
      alreadyRevoked,
    },
  });

  res.json(toMcpApiKeyMetadata(revoked));
}));

export default router;
