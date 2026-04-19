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
      /* v8 ignore start -- absent IPs are normalized defensively for non-HTTP MCP callers */
      lastUsedIp: data.lastUsedIp ?? null,
      /* v8 ignore stop */
      lastUsedAgent: data.lastUsedAgent ?? null,
    },
  });
}

export interface McpKeySupportStats {
  total: number;
  active: number;
  revoked: number;
  expired: number;
  lastUsedBuckets: {
    within24h: number;
    within7d: number;
    older: number;
    never: number;
  };
}

export async function getSupportStats(now: Date = new Date()): Promise<McpKeySupportStats> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [total, revoked, expired, within24h, within7d, older, never] = await Promise.all([
    prisma.mcpApiKey.count(),
    prisma.mcpApiKey.count({ where: { revokedAt: { not: null } } }),
    prisma.mcpApiKey.count({
      where: { revokedAt: null, expiresAt: { not: null, lte: now } },
    }),
    prisma.mcpApiKey.count({ where: { lastUsedAt: { gte: dayAgo } } }),
    prisma.mcpApiKey.count({
      where: { lastUsedAt: { gte: weekAgo, lt: dayAgo } },
    }),
    prisma.mcpApiKey.count({ where: { lastUsedAt: { lt: weekAgo } } }),
    prisma.mcpApiKey.count({ where: { lastUsedAt: null } }),
  ]);

  const active = total - revoked - expired;

  return {
    total,
    active,
    revoked,
    expired,
    lastUsedBuckets: { within24h, within7d, older, never },
  };
}

export const mcpApiKeyRepository = {
  create,
  findByKeyHash,
  findById,
  findMany,
  revoke,
  updateLastUsedIfStale,
  getSupportStats,
};

export default mcpApiKeyRepository;
