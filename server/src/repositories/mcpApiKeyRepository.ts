/**
 * MCP API Key Repository
 *
 * Stores hashed API keys used by local Model Context Protocol clients.
 */

import prisma from '../models/prisma';
import { Prisma, type McpApiKey } from '../generated/prisma/client';

export interface CreateMcpApiKeyInput {
  userId: string;
  createdByUserId?: string | null;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scope?: Prisma.InputJsonValue | null;
  expiresAt?: Date | null;
}

export async function create(input: CreateMcpApiKeyInput): Promise<McpApiKey> {
  return prisma.mcpApiKey.create({
    data: {
      userId: input.userId,
      createdByUserId: input.createdByUserId ?? null,
      name: input.name,
      keyHash: input.keyHash,
      keyPrefix: input.keyPrefix,
      scope: input.scope ?? Prisma.DbNull,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function findByKeyHash(keyHash: string) {
  return prisma.mcpApiKey.findUnique({
    where: { keyHash },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          isAdmin: true,
        },
      },
    },
  });
}

export async function findById(id: string): Promise<McpApiKey | null> {
  return prisma.mcpApiKey.findUnique({ where: { id } });
}

export async function findMany() {
  return prisma.mcpApiKey.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          isAdmin: true,
        },
      },
    },
  });
}

export async function revoke(id: string): Promise<McpApiKey> {
  return prisma.mcpApiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export async function updateLastUsedIfStale(
  id: string,
  staleBefore: Date,
  data: { lastUsedIp?: string | null; lastUsedAgent?: string | null }
): Promise<void> {
  await prisma.mcpApiKey.updateMany({
    where: {
      id,
      OR: [
        { lastUsedAt: null },
        { lastUsedAt: { lt: staleBefore } },
      ],
    },
    data: {
      lastUsedAt: new Date(),
      lastUsedIp: data.lastUsedIp ?? null,
      lastUsedAgent: data.lastUsedAgent ?? null,
    },
  });
}

export const mcpApiKeyRepository = {
  create,
  findByKeyHash,
  findById,
  findMany,
  revoke,
  updateLastUsedIfStale,
};

export default mcpApiKeyRepository;
