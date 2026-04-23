import crypto from 'node:crypto';
import type { Request } from 'express';
import { mcpApiKeyRepository, walletRepository } from '../repositories';
import { requireWalletAccess } from '../services/accessControl';
import { getClientInfo } from '../services/auditService';
import { hashApiKeyLookup, hashLegacyApiKeyLookup } from '../utils/apiKeyHash';
import type { McpApiKeyScope, McpRequestContext } from './types';
import { McpForbiddenError, McpUnauthorizedError } from './types';

const MCP_KEY_PATTERN = /^mcp_[a-f0-9]{64}$/;
const KEY_PREFIX_LENGTH = 16;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export function generateMcpApiKey(): string {
  return `mcp_${crypto.randomBytes(32).toString('hex')}`;
}

export function getMcpApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, KEY_PREFIX_LENGTH);
}

export function hashMcpApiKey(apiKey: string): string {
  return hashApiKeyLookup(apiKey, 'mcp');
}

export function validateMcpApiKeyFormat(apiKey: string): boolean {
  return MCP_KEY_PATTERN.test(apiKey);
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (extra || !scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token;
}

export function buildMcpKeyScope(input: {
  walletIds?: string[];
  allowAuditLogs?: boolean;
}): McpApiKeyScope {
  return {
    ...(input.walletIds && input.walletIds.length > 0 ? { walletIds: Array.from(new Set(input.walletIds)) } : {}),
    allowAuditLogs: input.allowAuditLogs === true,
  };
}

export function parseMcpKeyScope(value: unknown): McpApiKeyScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const scope = value as Record<string, unknown>;
  return {
    /* v8 ignore start -- API key scopes are normalized at creation time */
    ...(Array.isArray(scope.walletIds)
      ? { walletIds: scope.walletIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    /* v8 ignore stop */
    allowAuditLogs: scope.allowAuditLogs === true,
  };
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function findMcpApiKeyForToken(token: string) {
  const candidateHashes = [hashMcpApiKey(token), hashLegacyApiKeyLookup(token)];
  for (const candidateHash of candidateHashes) {
    // eslint-disable-next-line no-await-in-loop -- fallback lookup must preserve exact precedence.
    const key = await mcpApiKeyRepository.findByKeyHash(candidateHash);
    if (key && timingSafeEqualHex(candidateHash, key.keyHash)) {
      return { key, keyHash: candidateHash };
    }
  }
  return null;
}

export async function authenticateMcpRequest(req: Request): Promise<McpRequestContext> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token || !validateMcpApiKeyFormat(token)) {
    throw new McpUnauthorizedError('Valid MCP bearer token required');
  }

  const match = await findMcpApiKeyForToken(token);
  if (!match) {
    throw new McpUnauthorizedError('Invalid MCP API key');
  }
  const { key } = match;

  if (key.revokedAt) {
    throw new McpUnauthorizedError('MCP API key has been revoked');
  }

  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    throw new McpUnauthorizedError('MCP API key has expired');
  }

  const { ipAddress, userAgent } = getClientInfo(req);
  await mcpApiKeyRepository.updateLastUsedIfStale(
    key.id,
    new Date(Date.now() - LAST_USED_THROTTLE_MS),
    { lastUsedIp: ipAddress, lastUsedAgent: userAgent }
  );

  return {
    keyId: key.id,
    keyPrefix: key.keyPrefix,
    userId: key.userId,
    username: key.user.username,
    isAdmin: key.user.isAdmin,
    scope: parseMcpKeyScope(key.scope),
  };
}

export async function validateMcpScopeWallets(userId: string, walletIds: string[] = []): Promise<void> {
  for (const walletId of Array.from(new Set(walletIds))) {
    const hasAccess = await walletRepository.hasAccess(walletId, userId);
    if (!hasAccess) {
      throw new McpForbiddenError(`User does not have access to wallet ${walletId}`);
    }
  }
}

export async function requireMcpWalletAccess(
  walletId: string,
  context: McpRequestContext
): Promise<void> {
  if (context.scope.walletIds && !context.scope.walletIds.includes(walletId)) {
    throw new McpForbiddenError('MCP API key is not scoped for this wallet');
  }
  await requireWalletAccess(walletId, context.userId);
}

export function requireMcpAuditAccess(context: McpRequestContext): void {
  if (!context.isAdmin || context.scope.allowAuditLogs !== true) {
    throw new McpForbiddenError('MCP API key is not allowed to read audit logs');
  }
}
