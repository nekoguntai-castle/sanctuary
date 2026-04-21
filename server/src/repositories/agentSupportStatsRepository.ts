import prisma from '../models/prisma';

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
