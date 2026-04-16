/**
 * Admin MCP API Key Router
 *
 * Admin-only management for local read-only MCP API keys.
 */

import { Router } from 'express';
import type { Prisma } from '../../generated/prisma/client';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { mcpApiKeyRepository, userRepository, walletRepository } from '../../repositories';
import { CreateMcpApiKeySchema, McpApiKeyIdParamSchema } from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';
import {
  buildMcpKeyScope,
  generateMcpApiKey,
  getMcpApiKeyPrefix,
  hashMcpApiKey,
} from '../../mcp/auth';
import { toMcpApiKeyMetadata } from '../../mcp/dto';

const router = Router();

function parseKeyId(params: unknown): string {
  const parsed = McpApiKeyIdParamSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidInputError('Invalid MCP API key id');
  }
  return parsed.data.keyId;
}

async function validateWalletScope(userId: string, walletIds: string[] = []): Promise<void> {
  const uniqueWalletIds = Array.from(new Set(walletIds));
  for (const walletId of uniqueWalletIds) {
    const hasAccess = await walletRepository.hasAccess(walletId, userId);
    if (!hasAccess) {
      throw new InvalidInputError(`User does not have access to wallet ${walletId}`);
    }
  }
}

/**
 * GET /api/v1/admin/mcp-keys
 * List MCP API key metadata. Full tokens and hashes are never returned.
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const keys = await mcpApiKeyRepository.findMany();
  res.json(keys.map(toMcpApiKeyMetadata));
}));

/**
 * POST /api/v1/admin/mcp-keys
 * Create a scoped read-only MCP API key. Returns full token once.
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const input = parseAdminRequestBody(CreateMcpApiKeySchema, req.body);

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new InvalidInputError('expiresAt must be in the future');
  }

  const targetUser = await userRepository.findById(input.userId);
  if (!targetUser) {
    throw new NotFoundError('User not found');
  }

  await validateWalletScope(input.userId, input.walletIds);

  const apiKey = generateMcpApiKey();
  const scope = buildMcpKeyScope({
    walletIds: input.walletIds,
    allowAuditLogs: input.allowAuditLogs,
  });

  const key = await mcpApiKeyRepository.create({
    userId: input.userId,
    createdByUserId: req.user?.userId ?? null,
    name: input.name.trim(),
    keyHash: hashMcpApiKey(apiKey),
    keyPrefix: getMcpApiKeyPrefix(apiKey),
    scope: scope as Prisma.InputJsonValue,
    expiresAt: input.expiresAt ?? null,
  });

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
  const existing = await mcpApiKeyRepository.findById(keyId);
  if (!existing) {
    throw new NotFoundError('MCP API key not found');
  }

  const revoked = existing.revokedAt ? existing : await mcpApiKeyRepository.revoke(keyId);

  await auditService.logFromRequest(req, AuditAction.MCP_KEY_REVOKE, AuditCategory.MCP, {
    details: {
      keyId: revoked.id,
      keyPrefix: revoked.keyPrefix,
      targetUserId: revoked.userId,
      alreadyRevoked: Boolean(existing.revokedAt),
    },
  });

  res.json(toMcpApiKeyMetadata(revoked));
}));

export default router;
