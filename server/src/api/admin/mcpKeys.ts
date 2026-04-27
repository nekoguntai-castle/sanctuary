/**
 * Admin MCP API Key Router
 *
 * Admin-only management for local read-only MCP API keys.
 */

import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { createMcpApiKey, listMcpApiKeys, revokeMcpApiKey } from '../../services/adminMcpKeyService';
import { CreateMcpApiKeySchema, McpApiKeyIdParamSchema } from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';
import { toMcpApiKeyMetadata } from '../../mcp/dto';
import { getConfig } from '../../config';
import { version as serverVersion } from '../../../package.json';

const router = Router();
const adminMcpCodeqlLimiter = expressRateLimit({
  windowMs: 60_000,
  limit: 1000,
  standardHeaders: false,
  legacyHeaders: false,
});
const adminMcpPolicyLimiter = rateLimit('api:default');

function parseKeyId(params: unknown): string {
  const parsed = McpApiKeyIdParamSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidInputError('Invalid MCP API key id');
  }
  return parsed.data.keyId;
}

/**
 * GET /api/v1/admin/mcp-keys/status
 * Return runtime MCP server settings needed for admin setup.
 */
router.get(
  '/status',
  adminMcpCodeqlLimiter,
  adminMcpPolicyLimiter,
  authenticate,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { mcp } = getConfig();
    res.json({
      enabled: mcp.enabled,
      host: mcp.host,
      port: mcp.port,
      allowedHosts: mcp.allowedHosts,
      rateLimitPerMinute: mcp.rateLimitPerMinute,
      defaultPageSize: mcp.defaultPageSize,
      maxPageSize: mcp.maxPageSize,
      maxDateRangeDays: mcp.maxDateRangeDays,
      serverName: 'sanctuary',
      serverVersion,
    });
  })
);

/**
 * GET /api/v1/admin/mcp-keys
 * List MCP API key metadata. Full tokens and hashes are never returned.
 */
router.get(
  '/',
  adminMcpCodeqlLimiter,
  adminMcpPolicyLimiter,
  authenticate,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const keys = await listMcpApiKeys();
    res.json(keys.map(toMcpApiKeyMetadata));
  })
);

/**
 * POST /api/v1/admin/mcp-keys
 * Create a scoped read-only MCP API key. Returns full token once.
 */
router.post(
  '/',
  adminMcpCodeqlLimiter,
  adminMcpPolicyLimiter,
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * DELETE /api/v1/admin/mcp-keys/:keyId
 * Soft-revoke an MCP API key.
 */
router.delete(
  '/:keyId',
  adminMcpCodeqlLimiter,
  adminMcpPolicyLimiter,
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
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
  })
);

export default router;
