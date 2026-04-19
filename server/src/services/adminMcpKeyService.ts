import type { Prisma } from '../generated/prisma/client';
import { InvalidInputError, NotFoundError } from '../errors/ApiError';
import {
  buildMcpKeyScope,
  generateMcpApiKey,
  getMcpApiKeyPrefix,
  hashMcpApiKey,
} from '../mcp/auth';
import { mcpApiKeyRepository, userRepository, walletRepository } from '../repositories';

export interface CreateMcpApiKeyServiceInput {
  userId: string;
  name: string;
  walletIds?: string[];
  allowAuditLogs?: boolean;
  expiresAt?: Date;
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

export function listMcpApiKeys() {
  return mcpApiKeyRepository.findMany();
}

export async function createMcpApiKey(
  input: CreateMcpApiKeyServiceInput,
  createdByUserId?: string | null
) {
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
    createdByUserId: createdByUserId ?? null,
    name: input.name.trim(),
    keyHash: hashMcpApiKey(apiKey),
    keyPrefix: getMcpApiKeyPrefix(apiKey),
    scope: scope as Prisma.InputJsonValue,
    expiresAt: input.expiresAt ?? null,
  });

  return { key, apiKey, targetUser };
}

export async function revokeMcpApiKey(keyId: string) {
  const existing = await mcpApiKeyRepository.findById(keyId);
  if (!existing) {
    throw new NotFoundError('MCP API key not found');
  }

  const revoked = existing.revokedAt ? existing : await mcpApiKeyRepository.revoke(keyId);

  return {
    key: revoked,
    alreadyRevoked: Boolean(existing.revokedAt),
  };
}
