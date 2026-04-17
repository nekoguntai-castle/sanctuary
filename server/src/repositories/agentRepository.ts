/**
 * Agent Repository
 *
 * Stores agent wallet links and scoped API keys for agent funding-draft
 * submission. Agent keys are write-capable, so they are intentionally separate
 * from read-only MCP API keys.
 */

import prisma from '../models/prisma';
import { Prisma, type AgentApiKey, type AgentFundingAttempt, type WalletAgent } from '../generated/prisma/client';

export const AGENT_ACTION_CREATE_FUNDING_DRAFT = 'create_funding_draft' as const;

export interface CreateWalletAgentInput {
  userId: string;
  name: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
  status?: string;
  maxFundingAmountSats?: bigint | null;
  maxOperationalBalanceSats?: bigint | null;
  dailyFundingLimitSats?: bigint | null;
  weeklyFundingLimitSats?: bigint | null;
  cooldownMinutes?: number | null;
  requireHumanApproval?: boolean;
  notifyOnOperationalSpend?: boolean;
  pauseOnUnexpectedSpend?: boolean;
}

export interface CreateAgentApiKeyInput {
  agentId: string;
  createdByUserId?: string | null;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scope?: Prisma.InputJsonValue | null;
  expiresAt?: Date | null;
}

export interface CreateAgentFundingAttemptInput {
  agentId: string;
  keyId?: string | null;
  keyPrefix?: string | null;
  fundingWalletId: string;
  operationalWalletId?: string | null;
  draftId?: string | null;
  status: 'accepted' | 'rejected';
  reasonCode?: string | null;
  reasonMessage?: string | null;
  amount?: bigint | null;
  feeRate?: number | null;
  recipient?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AgentApiKeyWithAgent = AgentApiKey & {
  agent: WalletAgent & {
    user: {
      id: string;
      username: string;
      isAdmin: boolean;
    };
  };
};

export type WalletAgentWithDetails = WalletAgent & {
  user: {
    id: string;
    username: string;
    isAdmin: boolean;
  };
  fundingWallet: {
    id: string;
    name: string;
    type: string;
    network: string;
  };
  operationalWallet: {
    id: string;
    name: string;
    type: string;
    network: string;
  };
  signerDevice: {
    id: string;
    label: string;
    fingerprint: string;
  };
  apiKeys?: AgentApiKey[];
};

export interface FindWalletAgentsFilter {
  walletId?: string;
}

export interface UpdateWalletAgentInput {
  name?: string;
  status?: string;
  maxFundingAmountSats?: bigint | null;
  maxOperationalBalanceSats?: bigint | null;
  dailyFundingLimitSats?: bigint | null;
  weeklyFundingLimitSats?: bigint | null;
  cooldownMinutes?: number | null;
  requireHumanApproval?: boolean;
  notifyOnOperationalSpend?: boolean;
  pauseOnUnexpectedSpend?: boolean;
  revokedAt?: Date | null;
}

export async function createAgent(input: CreateWalletAgentInput): Promise<WalletAgent> {
  return prisma.walletAgent.create({
    data: {
      userId: input.userId,
      name: input.name,
      fundingWalletId: input.fundingWalletId,
      operationalWalletId: input.operationalWalletId,
      signerDeviceId: input.signerDeviceId,
      status: input.status ?? 'active',
      maxFundingAmountSats: input.maxFundingAmountSats ?? null,
      maxOperationalBalanceSats: input.maxOperationalBalanceSats ?? null,
      dailyFundingLimitSats: input.dailyFundingLimitSats ?? null,
      weeklyFundingLimitSats: input.weeklyFundingLimitSats ?? null,
      cooldownMinutes: input.cooldownMinutes ?? null,
      requireHumanApproval: input.requireHumanApproval ?? true,
      notifyOnOperationalSpend: input.notifyOnOperationalSpend ?? true,
      pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend ?? false,
      revokedAt: input.status === 'revoked' ? new Date() : null,
    },
  });
}

export async function findAgents(filter: FindWalletAgentsFilter = {}): Promise<WalletAgentWithDetails[]> {
  const where: Prisma.WalletAgentWhereInput | undefined = filter.walletId
    ? {
        OR: [
          { fundingWalletId: filter.walletId },
          { operationalWalletId: filter.walletId },
        ],
      }
    : undefined;

  return prisma.walletAgent.findMany({
    ...(where && { where }),
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, username: true, isAdmin: true },
      },
      fundingWallet: {
        select: { id: true, name: true, type: true, network: true },
      },
      operationalWallet: {
        select: { id: true, name: true, type: true, network: true },
      },
      signerDevice: {
        select: { id: true, label: true, fingerprint: true },
      },
      apiKeys: true,
    },
  });
}

export async function findAgentById(agentId: string): Promise<WalletAgent | null> {
  return prisma.walletAgent.findUnique({
    where: { id: agentId },
  });
}

export async function findAgentByIdWithDetails(agentId: string): Promise<WalletAgentWithDetails | null> {
  return prisma.walletAgent.findUnique({
    where: { id: agentId },
    include: {
      user: {
        select: { id: true, username: true, isAdmin: true },
      },
      fundingWallet: {
        select: { id: true, name: true, type: true, network: true },
      },
      operationalWallet: {
        select: { id: true, name: true, type: true, network: true },
      },
      signerDevice: {
        select: { id: true, label: true, fingerprint: true },
      },
      apiKeys: true,
    },
  });
}

export async function findActiveAgentsByOperationalWalletId(
  operationalWalletId: string
): Promise<WalletAgent[]> {
  return prisma.walletAgent.findMany({
    where: {
      operationalWalletId,
      status: 'active',
      revokedAt: null,
    },
  });
}

export async function updateAgent(agentId: string, input: UpdateWalletAgentInput): Promise<WalletAgent> {
  const data: Prisma.WalletAgentUpdateInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.maxFundingAmountSats !== undefined && { maxFundingAmountSats: input.maxFundingAmountSats }),
    ...(input.maxOperationalBalanceSats !== undefined && { maxOperationalBalanceSats: input.maxOperationalBalanceSats }),
    ...(input.dailyFundingLimitSats !== undefined && { dailyFundingLimitSats: input.dailyFundingLimitSats }),
    ...(input.weeklyFundingLimitSats !== undefined && { weeklyFundingLimitSats: input.weeklyFundingLimitSats }),
    ...(input.cooldownMinutes !== undefined && { cooldownMinutes: input.cooldownMinutes }),
    ...(input.requireHumanApproval !== undefined && { requireHumanApproval: input.requireHumanApproval }),
    ...(input.notifyOnOperationalSpend !== undefined && { notifyOnOperationalSpend: input.notifyOnOperationalSpend }),
    ...(input.pauseOnUnexpectedSpend !== undefined && { pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend }),
    ...(input.revokedAt !== undefined && { revokedAt: input.revokedAt }),
  };

  return prisma.walletAgent.update({
    where: { id: agentId },
    data,
  });
}

export async function markAgentFundingDraftCreated(agentId: string, at: Date = new Date()): Promise<void> {
  await prisma.walletAgent.update({
    where: { id: agentId },
    data: { lastFundingDraftAt: at },
  });
}

export async function sumAgentDraftAmountsSince(agentId: string, since: Date): Promise<bigint> {
  const result = await prisma.draftTransaction.aggregate({
    where: {
      agentId,
      createdAt: { gte: since },
      status: { in: ['unsigned', 'partial', 'signed'] },
    },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0n;
}

export async function createApiKey(input: CreateAgentApiKeyInput): Promise<AgentApiKey> {
  return prisma.agentApiKey.create({
    data: {
      agentId: input.agentId,
      createdByUserId: input.createdByUserId ?? null,
      name: input.name,
      keyHash: input.keyHash,
      keyPrefix: input.keyPrefix,
      scope: input.scope ?? Prisma.DbNull,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function findApiKeyByHash(keyHash: string): Promise<AgentApiKeyWithAgent | null> {
  return prisma.agentApiKey.findUnique({
    where: { keyHash },
    include: {
      agent: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              isAdmin: true,
            },
          },
        },
      },
    },
  });
}

export async function findApiKeyById(id: string): Promise<AgentApiKey | null> {
  return prisma.agentApiKey.findUnique({ where: { id } });
}

export async function findApiKeysByAgentId(agentId: string): Promise<AgentApiKey[]> {
  return prisma.agentApiKey.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeApiKey(id: string): Promise<AgentApiKey> {
  return prisma.agentApiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export async function updateApiKeyLastUsedIfStale(
  id: string,
  staleBefore: Date,
  data: { lastUsedIp?: string | null; lastUsedAgent?: string | null }
): Promise<void> {
  await prisma.agentApiKey.updateMany({
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

export async function withAgentFundingLock<T>(
  agentId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = `agent-funding:${agentId}`;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    return fn();
  }, {
    maxWait: 5_000,
    timeout: 60_000,
  });
}

export async function createFundingAttempt(
  input: CreateAgentFundingAttemptInput
): Promise<AgentFundingAttempt> {
  return prisma.agentFundingAttempt.create({
    data: {
      agentId: input.agentId,
      keyId: input.keyId ?? null,
      keyPrefix: input.keyPrefix ?? null,
      fundingWalletId: input.fundingWalletId,
      operationalWalletId: input.operationalWalletId ?? null,
      draftId: input.draftId ?? null,
      status: input.status,
      reasonCode: input.reasonCode ?? null,
      reasonMessage: input.reasonMessage ?? null,
      amount: input.amount ?? null,
      feeRate: input.feeRate ?? null,
      recipient: input.recipient ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export const agentRepository = {
  createAgent,
  findAgents,
  findAgentById,
  findAgentByIdWithDetails,
  findActiveAgentsByOperationalWalletId,
  updateAgent,
  markAgentFundingDraftCreated,
  sumAgentDraftAmountsSince,
  createApiKey,
  findApiKeyByHash,
  findApiKeyById,
  findApiKeysByAgentId,
  revokeApiKey,
  updateApiKeyLastUsedIfStale,
  withAgentFundingLock,
  createFundingAttempt,
};

export default agentRepository;
