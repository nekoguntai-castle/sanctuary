import prisma from '../models/prisma';
import {
  Prisma,
  type AgentAlert,
} from '../generated/prisma/client';
import type { WalletAgentWithDetails } from './agentRepository';

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

interface DashboardRowMaps {
  balancesByWalletId: Map<string, bigint>;
  pendingDraftsByAgentId: Map<string, number>;
  openAlertsByAgentId: Map<string, number>;
  activeKeysByAgentId: Map<string, number>;
  recentFundingDraftsByAgentId: Map<string, AgentDashboardDraftRecord[]>;
  recentOperationalSpendsByWalletId: Map<string, AgentDashboardTransactionRecord[]>;
  recentAlertsByAgentId: Map<string, AgentAlert[]>;
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

function getCount(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

function getBalance(map: Map<string, bigint>, key: string): bigint {
  return map.get(key) ?? 0n;
}

function getRows<T>(map: Map<string, T[]>, key: string): T[] {
  return map.get(key) ?? [];
}

function firstOrNull<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

function buildDashboardRow(
  agent: WalletAgentWithDetails,
  maps: DashboardRowMaps
): AgentWalletDashboardRow {
  const recentFundingDrafts = getRows(maps.recentFundingDraftsByAgentId, agent.id)
    .map(toDashboardDraftSummary);
  const recentOperationalSpends = getRows(
    maps.recentOperationalSpendsByWalletId,
    agent.operationalWalletId
  );
  const recentAlerts = getRows(maps.recentAlertsByAgentId, agent.id);

  return {
    agent,
    operationalBalanceSats: getBalance(maps.balancesByWalletId, agent.operationalWalletId),
    pendingFundingDraftCount: getCount(maps.pendingDraftsByAgentId, agent.id),
    openAlertCount: getCount(maps.openAlertsByAgentId, agent.id),
    activeKeyCount: getCount(maps.activeKeysByAgentId, agent.id),
    lastFundingDraft: firstOrNull(recentFundingDrafts),
    lastOperationalSpend: firstOrNull(recentOperationalSpends),
    recentFundingDrafts,
    recentOperationalSpends,
    recentAlerts,
  };
}

function findDashboardAgents(limit?: number): Promise<WalletAgentWithDetails[]> {
  return prisma.walletAgent.findMany({
    orderBy: { createdAt: 'desc' },
    ...(limit ? { take: limit } : {}),
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

/**
 * Build the admin operational dashboard in bulk. Counts and balances are grouped
 * by the database, and recent samples use windowed queries to avoid per-agent
 * query fan-out as the agent list grows.
 */
export async function findDashboardRows(options?: { limit?: number }): Promise<AgentWalletDashboardRow[]> {
  const agents = await findDashboardAgents(options?.limit);
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

  const maps: DashboardRowMaps = {
    balancesByWalletId: new Map(
      balanceRows.map(row => [row.walletId, row._sum.amount ?? 0n])
    ),
    pendingDraftsByAgentId: new Map(
      pendingDraftCounts.flatMap(row => row.agentId ? [[row.agentId, row._count._all]] : [])
    ),
    openAlertsByAgentId: new Map(
      openAlertCounts.map(row => [row.agentId, row._count._all])
    ),
    activeKeysByAgentId: new Map(
      activeKeyCounts.map(row => [row.agentId, row._count._all])
    ),
    recentFundingDraftsByAgentId: groupRowsBy(recentFundingDraftRows, row => row.agentId),
    recentOperationalSpendsByWalletId: groupRowsBy(recentOperationalSpendRows, row => row.walletId),
    recentAlertsByAgentId: groupRowsBy(recentAlertRows, row => row.agentId),
  };

  return agents.map(agent => buildDashboardRow(agent, maps));
}
