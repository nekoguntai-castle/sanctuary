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

export const AGENT_ACTION_CREATE_FUNDING_DRAFT = 'create_funding_draft' as const;

const DASHBOARD_DRAFT_SELECT = {
  id: true,
  walletId: true,
  recipient: true,
  amount: true,
  fee: true,
  feeRate: true,
  status: true,
  approvalStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DraftTransactionSelect;

const DASHBOARD_TRANSACTION_SELECT = {
  id: true,
  txid: true,
  walletId: true,
  type: true,
  amount: true,
  fee: true,
  confirmations: true,
  blockTime: true,
  counterpartyAddress: true,
  createdAt: true,
} satisfies Prisma.TransactionSelect;

const DASHBOARD_RECENT_LIMIT = 3;
// These draft states still require human review, signing, broadcast, or cleanup.
const PENDING_DRAFT_STATUSES = ['unsigned', 'partial', 'signed'] as const;

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

export type AgentDashboardDraftSummary = Prisma.DraftTransactionGetPayload<{
  select: typeof DASHBOARD_DRAFT_SELECT;
}>;

export type AgentDashboardTransactionSummary = Prisma.TransactionGetPayload<{
  select: typeof DASHBOARD_TRANSACTION_SELECT;
}>;

export interface AgentWalletDashboardRow {
  agent: WalletAgentWithDetails;
  operationalBalanceSats: bigint;
  pendingFundingDraftCount: number;
  openAlertCount: number;
  activeKeyCount: number;
  lastFundingDraft: AgentDashboardDraftSummary | null;
  lastOperationalSpend: AgentDashboardTransactionSummary | null;
  recentFundingDrafts: AgentDashboardDraftSummary[];
  recentOperationalSpends: AgentDashboardTransactionSummary[];
  recentAlerts: AgentAlert[];
}

type AgentDashboardDraftRecord = AgentDashboardDraftSummary & { agentId: string };
type AgentDashboardTransactionRecord = AgentDashboardTransactionSummary;

export interface FindWalletAgentsFilter {
  walletId?: string;
}

export interface FindAgentAlertsFilter {
  agentId: string;
  status?: string;
  type?: string;
  limit?: number;
}

export interface FindAgentFundingOverridesFilter {
  agentId: string;
  status?: string;
  limit?: number;
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
      minOperationalBalanceSats: input.minOperationalBalanceSats ?? null,
      largeOperationalSpendSats: input.largeOperationalSpendSats ?? null,
      largeOperationalFeeSats: input.largeOperationalFeeSats ?? null,
      repeatedFailureThreshold: input.repeatedFailureThreshold ?? null,
      repeatedFailureLookbackMinutes: input.repeatedFailureLookbackMinutes ?? null,
      alertDedupeMinutes: input.alertDedupeMinutes ?? null,
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

function buildAgentAlertCreateData(input: CreateAgentAlertInput) {
  return {
    agentId: input.agentId,
    walletId: input.walletId ?? null,
    type: input.type,
    severity: input.severity,
    status: input.status ?? 'open',
    txid: input.txid ?? null,
    amountSats: input.amountSats ?? null,
    feeSats: input.feeSats ?? null,
    thresholdSats: input.thresholdSats ?? null,
    observedCount: input.observedCount ?? null,
    reasonCode: input.reasonCode ?? null,
    message: input.message,
    dedupeKey: input.dedupeKey ?? null,
    metadata: input.metadata ?? Prisma.DbNull,
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
    take: filter.limit ?? 25,
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
    take: filter.limit ?? 25,
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

function groupRowsBy<T>(rows: T[], getKey: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = getKey(row);
    const existing = grouped.get(key);
    if (existing) existing.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

function toDashboardDraftSummary(row: AgentDashboardDraftRecord): AgentDashboardDraftSummary {
  return {
    id: row.id,
    walletId: row.walletId,
    recipient: row.recipient,
    amount: row.amount,
    fee: row.fee,
    feeRate: row.feeRate,
    status: row.status,
    approvalStatus: row.approvalStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Build the admin operational dashboard in bulk. Counts and balances are grouped
 * by the database, and recent samples use windowed queries to avoid per-agent
 * query fan-out as the agent list grows.
 */
export async function findDashboardRows(): Promise<AgentWalletDashboardRow[]> {
  const agents = await findAgents();
  if (agents.length === 0) return [];

  const now = new Date();
  const agentIds = agents.map(agent => agent.id);
  const operationalWalletIds = [...new Set(agents.map(agent => agent.operationalWalletId))];

  const [
    balanceRows,
    pendingDraftCounts,
    openAlertCounts,
    activeKeyCounts,
    recentFundingDraftRows,
    recentOperationalSpendRows,
    recentAlertRows,
  ] = await Promise.all([
    prisma.uTXO.groupBy({
      by: ['walletId'],
      where: {
        walletId: { in: operationalWalletIds },
        spent: false,
      },
      _sum: { amount: true },
    }),
    prisma.draftTransaction.groupBy({
      by: ['agentId'],
      where: {
        agentId: { in: agentIds },
        status: { in: [...PENDING_DRAFT_STATUSES] },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.agentAlert.groupBy({
      by: ['agentId'],
      where: {
        agentId: { in: agentIds },
        status: 'open',
      },
      _count: { _all: true },
    }),
    prisma.agentApiKey.groupBy({
      by: ['agentId'],
      where: {
        agentId: { in: agentIds },
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.$queryRaw<AgentDashboardDraftRecord[]>`
      SELECT id,
             "walletId",
             recipient,
             amount,
             fee,
             "feeRate",
             status,
             "approvalStatus",
             "createdAt",
             "updatedAt",
             "agentId"
      FROM (
        SELECT id,
               "walletId",
               recipient,
               amount,
               fee,
               "feeRate",
               status,
               "approvalStatus",
               "createdAt",
               "updatedAt",
               "agentId",
               ROW_NUMBER() OVER (PARTITION BY "agentId" ORDER BY "createdAt" DESC) AS rn
        FROM "draft_transactions"
        WHERE "agentId" = ANY(${agentIds}::text[])
      ) ranked
      WHERE rn <= ${DASHBOARD_RECENT_LIMIT}
      ORDER BY "createdAt" DESC
    `,
    prisma.$queryRaw<AgentDashboardTransactionRecord[]>`
      SELECT id,
             txid,
             "walletId",
             type,
             amount,
             fee,
             confirmations,
             "blockTime",
             "counterpartyAddress",
             "createdAt"
      FROM (
        SELECT id,
               txid,
               "walletId",
               type,
               amount,
               fee,
               confirmations,
               "blockTime",
               "counterpartyAddress",
               "createdAt",
               ROW_NUMBER() OVER (
                 PARTITION BY "walletId"
                 ORDER BY "blockTime" DESC NULLS FIRST, "createdAt" DESC
               ) AS rn
        FROM "transactions"
        WHERE "walletId" = ANY(${operationalWalletIds}::text[])
          AND type = 'sent'
      ) ranked
      WHERE rn <= ${DASHBOARD_RECENT_LIMIT}
      ORDER BY "blockTime" DESC NULLS FIRST, "createdAt" DESC
    `,
    prisma.$queryRaw<AgentAlert[]>`
      SELECT id,
             "agentId",
             "walletId",
             type,
             severity,
             status,
             txid,
             "amountSats",
             "feeSats",
             "thresholdSats",
             "observedCount",
             "reasonCode",
             message,
             "dedupeKey",
             metadata,
             "createdAt",
             "acknowledgedAt",
             "resolvedAt"
      FROM (
        SELECT id,
               "agentId",
               "walletId",
               type,
               severity,
               status,
               txid,
               "amountSats",
               "feeSats",
               "thresholdSats",
               "observedCount",
               "reasonCode",
               message,
               "dedupeKey",
               metadata,
               "createdAt",
               "acknowledgedAt",
               "resolvedAt",
               ROW_NUMBER() OVER (PARTITION BY "agentId" ORDER BY "createdAt" DESC) AS rn
        FROM "agent_alerts"
        WHERE "agentId" = ANY(${agentIds}::text[])
          AND status = 'open'
      ) ranked
      WHERE rn <= ${DASHBOARD_RECENT_LIMIT}
      ORDER BY "createdAt" DESC
    `,
  ]);

  const balancesByWalletId = new Map(
    balanceRows.map(row => [row.walletId, row._sum.amount ?? 0n])
  );
  const pendingDraftsByAgentId = new Map(
    pendingDraftCounts.flatMap(row => row.agentId ? [[row.agentId, row._count._all]] : [])
  );
  const openAlertsByAgentId = new Map(
    openAlertCounts.map(row => [row.agentId, row._count._all])
  );
  const activeKeysByAgentId = new Map(
    activeKeyCounts.map(row => [row.agentId, row._count._all])
  );
  const recentFundingDraftsByAgentId = groupRowsBy(recentFundingDraftRows, row => row.agentId);
  const recentOperationalSpendsByWalletId = groupRowsBy(recentOperationalSpendRows, row => row.walletId);
  const recentAlertsByAgentId = groupRowsBy(recentAlertRows, row => row.agentId);

  return agents.map((agent) => {
    const recentFundingDrafts = (recentFundingDraftsByAgentId.get(agent.id) ?? [])
      .map(toDashboardDraftSummary);
    const recentOperationalSpends = recentOperationalSpendsByWalletId.get(agent.operationalWalletId) ?? [];
    const recentAlerts = recentAlertsByAgentId.get(agent.id) ?? [];

    return {
      agent,
      operationalBalanceSats: balancesByWalletId.get(agent.operationalWalletId) ?? 0n,
      pendingFundingDraftCount: pendingDraftsByAgentId.get(agent.id) ?? 0,
      openAlertCount: openAlertsByAgentId.get(agent.id) ?? 0,
      activeKeyCount: activeKeysByAgentId.get(agent.id) ?? 0,
      lastFundingDraft: recentFundingDrafts[0] ?? null,
      lastOperationalSpend: recentOperationalSpends[0] ?? null,
      recentFundingDrafts,
      recentOperationalSpends,
      recentAlerts,
    };
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
};

export default agentRepository;
