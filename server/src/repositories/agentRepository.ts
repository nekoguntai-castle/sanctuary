/**
 * Agent Repository
 *
 * Stores agent wallet links and scoped API keys for agent funding-draft
 * submission. Agent keys are write-capable, so they are intentionally separate
 * from read-only MCP API keys.
 */

import prisma from '../models/prisma';
import { InvalidInputError, NotFoundError } from '../errors';
import {
  Prisma,
  type AgentAlert,
  type AgentApiKey,
  type AgentFundingAttempt,
  type AgentFundingOverride,
  type WalletAgent,
} from '../generated/prisma/client';
import { findDashboardRows } from './agentDashboardRepository';
export { findDashboardRows } from './agentDashboardRepository';
export type {
  AgentDashboardDraftSummary,
  AgentDashboardTransactionSummary,
  AgentWalletDashboardRow,
} from './agentDashboardRepository';

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
  minOperationalBalanceSats?: bigint | null;
  largeOperationalSpendSats?: bigint | null;
  largeOperationalFeeSats?: bigint | null;
  repeatedFailureThreshold?: number | null;
  repeatedFailureLookbackMinutes?: number | null;
  alertDedupeMinutes?: number | null;
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

export interface CreateAgentFundingOverrideInput {
  agentId: string;
  fundingWalletId: string;
  operationalWalletId: string;
  createdByUserId?: string | null;
  reason: string;
  maxAmountSats: bigint;
  expiresAt: Date;
}

export interface FindUsableAgentFundingOverrideInput {
  agentId: string;
  operationalWalletId: string;
  amount: bigint;
  now: Date;
}

export interface CreateAgentAlertInput {
  agentId: string;
  walletId?: string | null;
  type: string;
  severity: string;
  status?: string;
  txid?: string | null;
  amountSats?: bigint | null;
  feeSats?: bigint | null;
  thresholdSats?: bigint | null;
  observedCount?: number | null;
  reasonCode?: string | null;
  message: string;
  dedupeKey?: string | null;
  metadata?: Prisma.InputJsonValue | null;
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

export interface FindAgentAlertsFilter {
  agentId: string;
  status?: string;
  type?: string;
  limit: number;
}

export interface FindAgentFundingOverridesFilter {
  agentId: string;
  status?: string;
  limit: number;
}

export interface UpdateWalletAgentInput {
  name?: string;
  status?: string;
  maxFundingAmountSats?: bigint | null;
  maxOperationalBalanceSats?: bigint | null;
  dailyFundingLimitSats?: bigint | null;
  weeklyFundingLimitSats?: bigint | null;
  cooldownMinutes?: number | null;
  minOperationalBalanceSats?: bigint | null;
  largeOperationalSpendSats?: bigint | null;
  largeOperationalFeeSats?: bigint | null;
  repeatedFailureThreshold?: number | null;
  repeatedFailureLookbackMinutes?: number | null;
  alertDedupeMinutes?: number | null;
  requireHumanApproval?: boolean;
  notifyOnOperationalSpend?: boolean;
  pauseOnUnexpectedSpend?: boolean;
  revokedAt?: Date | null;
}

function nullableBigInt(value?: bigint | null): bigint | null {
  return value ?? null;
}

function nullableNumber(value?: number | null): number | null {
  return value ?? null;
}

function nullableString(value?: string | null): string | null {
  return value ?? null;
}

function toCreateAgentPolicyData(input: CreateWalletAgentInput): Pick<
  Prisma.WalletAgentUncheckedCreateInput,
  | 'maxFundingAmountSats'
  | 'maxOperationalBalanceSats'
  | 'dailyFundingLimitSats'
  | 'weeklyFundingLimitSats'
  | 'cooldownMinutes'
  | 'minOperationalBalanceSats'
> {
  return {
    maxFundingAmountSats: nullableBigInt(input.maxFundingAmountSats),
    maxOperationalBalanceSats: nullableBigInt(input.maxOperationalBalanceSats),
    dailyFundingLimitSats: nullableBigInt(input.dailyFundingLimitSats),
    weeklyFundingLimitSats: nullableBigInt(input.weeklyFundingLimitSats),
    cooldownMinutes: nullableNumber(input.cooldownMinutes),
    minOperationalBalanceSats: nullableBigInt(input.minOperationalBalanceSats),
  };
}

function toCreateAgentAlertData(input: CreateWalletAgentInput): Pick<
  Prisma.WalletAgentUncheckedCreateInput,
  | 'largeOperationalSpendSats'
  | 'largeOperationalFeeSats'
  | 'repeatedFailureThreshold'
  | 'repeatedFailureLookbackMinutes'
  | 'alertDedupeMinutes'
> {
  return {
    largeOperationalSpendSats: nullableBigInt(input.largeOperationalSpendSats),
    largeOperationalFeeSats: nullableBigInt(input.largeOperationalFeeSats),
    repeatedFailureThreshold: nullableNumber(input.repeatedFailureThreshold),
    repeatedFailureLookbackMinutes: nullableNumber(input.repeatedFailureLookbackMinutes),
    alertDedupeMinutes: nullableNumber(input.alertDedupeMinutes),
  };
}

function toCreateAgentBehaviorData(input: CreateWalletAgentInput): Pick<
  Prisma.WalletAgentUncheckedCreateInput,
  'requireHumanApproval' | 'notifyOnOperationalSpend' | 'pauseOnUnexpectedSpend' | 'revokedAt'
> {
  return {
    requireHumanApproval: input.requireHumanApproval ?? true,
    notifyOnOperationalSpend: input.notifyOnOperationalSpend ?? true,
    pauseOnUnexpectedSpend: input.pauseOnUnexpectedSpend ?? false,
    revokedAt: input.status === 'revoked' ? new Date() : null,
  };
}

function toCreateAgentData(input: CreateWalletAgentInput): Prisma.WalletAgentUncheckedCreateInput {
  return {
    userId: input.userId,
    name: input.name,
    fundingWalletId: input.fundingWalletId,
    operationalWalletId: input.operationalWalletId,
    signerDeviceId: input.signerDeviceId,
    status: input.status ?? 'active',
    ...toCreateAgentPolicyData(input),
    ...toCreateAgentAlertData(input),
    ...toCreateAgentBehaviorData(input),
  };
}

export async function createAgent(input: CreateWalletAgentInput): Promise<WalletAgent> {
  return prisma.walletAgent.create({
    data: toCreateAgentData(input),
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
    ...(input.minOperationalBalanceSats !== undefined && { minOperationalBalanceSats: input.minOperationalBalanceSats }),
    ...(input.largeOperationalSpendSats !== undefined && { largeOperationalSpendSats: input.largeOperationalSpendSats }),
    ...(input.largeOperationalFeeSats !== undefined && { largeOperationalFeeSats: input.largeOperationalFeeSats }),
    ...(input.repeatedFailureThreshold !== undefined && { repeatedFailureThreshold: input.repeatedFailureThreshold }),
    ...(input.repeatedFailureLookbackMinutes !== undefined && { repeatedFailureLookbackMinutes: input.repeatedFailureLookbackMinutes }),
    ...(input.alertDedupeMinutes !== undefined && { alertDedupeMinutes: input.alertDedupeMinutes }),
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

export async function countRejectedFundingAttemptsSince(agentId: string, since: Date): Promise<number> {
  return prisma.agentFundingAttempt.count({
    where: {
      agentId,
      status: 'rejected',
      createdAt: { gte: since },
    },
  });
}

function toAgentAlertOptionalData(input: CreateAgentAlertInput): Pick<
  Prisma.AgentAlertUncheckedCreateInput,
  'walletId' | 'status' | 'reasonCode' | 'dedupeKey' | 'metadata'
> {
  return {
    walletId: nullableString(input.walletId),
    status: input.status ?? 'open',
    reasonCode: nullableString(input.reasonCode),
    dedupeKey: nullableString(input.dedupeKey),
    metadata: input.metadata ?? Prisma.DbNull,
  };
}

function toAgentAlertMetricData(input: CreateAgentAlertInput): Pick<
  Prisma.AgentAlertUncheckedCreateInput,
  'txid' | 'amountSats' | 'feeSats' | 'thresholdSats' | 'observedCount'
> {
  return {
    txid: nullableString(input.txid),
    amountSats: nullableBigInt(input.amountSats),
    feeSats: nullableBigInt(input.feeSats),
    thresholdSats: nullableBigInt(input.thresholdSats),
    observedCount: nullableNumber(input.observedCount),
  };
}

function buildAgentAlertCreateData(input: CreateAgentAlertInput): Prisma.AgentAlertUncheckedCreateInput {
  return {
    agentId: input.agentId,
    type: input.type,
    severity: input.severity,
    message: input.message,
    ...toAgentAlertOptionalData(input),
    ...toAgentAlertMetricData(input),
  };
}

export async function createAlert(input: CreateAgentAlertInput): Promise<AgentAlert> {
  return prisma.agentAlert.create({
    data: buildAgentAlertCreateData(input),
  });
}

/**
 * Create an alert unless the same dedupe key already exists since `since`.
 * Returns `null` when the alert is suppressed as a duplicate.
 */
export async function createAlertIfNotDuplicate(
  input: CreateAgentAlertInput,
  since: Date
): Promise<AgentAlert | null> {
  if (!input.dedupeKey) {
    return createAlert(input);
  }

  const lockKey = `agent-alert:${input.dedupeKey}`;
  return prisma.$transaction(async (tx) => {
    // Serialize same-key dedupe checks so concurrent monitor runs cannot both insert.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const duplicate = await tx.agentAlert.findFirst({
      where: {
        dedupeKey: input.dedupeKey,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate) return null;

    return tx.agentAlert.create({
      data: buildAgentAlertCreateData(input),
    });
  }, {
    maxWait: 5_000,
    timeout: 5_000,
  });
}

export async function findAlerts(filter: FindAgentAlertsFilter): Promise<AgentAlert[]> {
  return prisma.agentAlert.findMany({
    where: {
      agentId: filter.agentId,
      ...(filter.status && { status: filter.status }),
      ...(filter.type && { type: filter.type }),
    },
    orderBy: { createdAt: 'desc' },
    take: filter.limit,
  });
}

export async function createFundingOverride(
  input: CreateAgentFundingOverrideInput
): Promise<AgentFundingOverride> {
  return prisma.agentFundingOverride.create({
    data: {
      agentId: input.agentId,
      fundingWalletId: input.fundingWalletId,
      operationalWalletId: input.operationalWalletId,
      createdByUserId: input.createdByUserId ?? null,
      reason: input.reason,
      maxAmountSats: input.maxAmountSats,
      expiresAt: input.expiresAt,
    },
  });
}

export async function findFundingOverrides(
  filter: FindAgentFundingOverridesFilter
): Promise<AgentFundingOverride[]> {
  return prisma.agentFundingOverride.findMany({
    where: {
      agentId: filter.agentId,
      ...(filter.status && { status: filter.status }),
    },
    orderBy: { createdAt: 'desc' },
    take: filter.limit,
  });
}

export async function findFundingOverrideById(id: string): Promise<AgentFundingOverride | null> {
  return prisma.agentFundingOverride.findUnique({ where: { id } });
}

export async function findUsableFundingOverride(
  input: FindUsableAgentFundingOverrideInput
): Promise<AgentFundingOverride | null> {
  return prisma.agentFundingOverride.findFirst({
    where: {
      agentId: input.agentId,
      operationalWalletId: input.operationalWalletId,
      status: 'active',
      revokedAt: null,
      usedAt: null,
      expiresAt: { gt: input.now },
      maxAmountSats: { gte: input.amount },
    },
    orderBy: [
      { expiresAt: 'asc' },
      { createdAt: 'asc' },
    ],
  });
}

export async function markFundingOverrideUsed(
  id: string,
  draftId: string
): Promise<AgentFundingOverride> {
  // Conditional update claims the override atomically so concurrent draft
  // creation or admin revocation cannot consume the same owner override twice.
  const result = await prisma.agentFundingOverride.updateMany({
    where: {
      id,
      status: 'active',
      revokedAt: null,
      usedAt: null,
    },
    data: {
      status: 'used',
      usedAt: new Date(),
      usedDraftId: draftId,
    },
  });
  if (result.count !== 1) {
    throw new InvalidInputError('Agent funding override is no longer usable');
  }

  const override = await prisma.agentFundingOverride.findUnique({ where: { id } });
  if (!override) {
    throw new NotFoundError('Agent funding override not found');
  }
  return override;
}

export async function revokeFundingOverride(id: string): Promise<AgentFundingOverride> {
  return prisma.agentFundingOverride.update({
    where: { id },
    data: {
      status: 'revoked',
      revokedAt: new Date(),
    },
  });
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

export interface AgentSupportStats {
  agents: Array<{
    id: string;
    status: string;
    fundingWalletId: string;
    operationalWalletId: string;
    lastFundingDraftAt: Date | null;
    createdAt: Date;
    revokedAt: Date | null;
    requireHumanApproval: boolean;
    pauseOnUnexpectedSpend: boolean;
  }>;
  alertsByStatusSeverity: Array<{ status: string; severity: string; count: number }>;
  apiKeyCounts: { total: number; active: number };
  overridesByStatus: Record<string, number>;
  fundingAttemptsByStatusLast7d: Record<string, number>;
}

export async function getSupportStats(now: Date = new Date()): Promise<AgentSupportStats> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [agents, alertGroups, totalKeys, activeKeys, overrideGroups, attemptGroups] = await Promise.all([
    prisma.walletAgent.findMany({
      select: {
        id: true,
        status: true,
        fundingWalletId: true,
        operationalWalletId: true,
        lastFundingDraftAt: true,
        createdAt: true,
        revokedAt: true,
        requireHumanApproval: true,
        pauseOnUnexpectedSpend: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.agentAlert.groupBy({
      by: ['status', 'severity'],
      _count: { _all: true },
    }),
    prisma.agentApiKey.count(),
    prisma.agentApiKey.count({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.agentFundingOverride.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.agentFundingAttempt.groupBy({
      by: ['status'],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
  ]);

  return {
    agents,
    alertsByStatusSeverity: alertGroups.map(r => ({
      status: r.status,
      severity: r.severity,
      count: r._count._all,
    })),
    apiKeyCounts: { total: totalKeys, active: activeKeys },
    overridesByStatus: Object.fromEntries(overrideGroups.map(r => [r.status, r._count._all])),
    fundingAttemptsByStatusLast7d: Object.fromEntries(
      attemptGroups.map(r => [r.status, r._count._all])
    ),
  };
}

function toFundingAttemptIdentityData(input: CreateAgentFundingAttemptInput): Pick<
  Prisma.AgentFundingAttemptUncheckedCreateInput,
  'agentId' | 'keyId' | 'keyPrefix' | 'fundingWalletId' | 'operationalWalletId' | 'draftId'
> {
  return {
    agentId: input.agentId,
    keyId: nullableString(input.keyId),
    keyPrefix: nullableString(input.keyPrefix),
    fundingWalletId: input.fundingWalletId,
    operationalWalletId: nullableString(input.operationalWalletId),
    draftId: nullableString(input.draftId),
  };
}

function toFundingAttemptDetailData(input: CreateAgentFundingAttemptInput): Pick<
  Prisma.AgentFundingAttemptUncheckedCreateInput,
  'status' | 'reasonCode' | 'reasonMessage' | 'amount' | 'feeRate' | 'recipient' | 'ipAddress' | 'userAgent'
> {
  return {
    status: input.status,
    reasonCode: nullableString(input.reasonCode),
    reasonMessage: nullableString(input.reasonMessage),
    amount: nullableBigInt(input.amount),
    feeRate: nullableNumber(input.feeRate),
    recipient: nullableString(input.recipient),
    ipAddress: nullableString(input.ipAddress),
    userAgent: nullableString(input.userAgent),
  };
}

export async function createFundingAttempt(
  input: CreateAgentFundingAttemptInput
): Promise<AgentFundingAttempt> {
  return prisma.agentFundingAttempt.create({
    data: {
      ...toFundingAttemptIdentityData(input),
      ...toFundingAttemptDetailData(input),
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
  countRejectedFundingAttemptsSince,
  createFundingOverride,
  findFundingOverrides,
  findFundingOverrideById,
  findUsableFundingOverride,
  markFundingOverrideUsed,
  revokeFundingOverride,
  createAlert,
  createAlertIfNotDuplicate,
  findAlerts,
  findDashboardRows,
  createApiKey,
  findApiKeyByHash,
  findApiKeyById,
  findApiKeysByAgentId,
  revokeApiKey,
  updateApiKeyLastUsedIfStale,
  withAgentFundingLock,
  createFundingAttempt,
  getSupportStats,
};

export default agentRepository;
