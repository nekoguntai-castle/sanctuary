import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  walletAgent: {
    findMany: vi.fn(),
  },
  agentApiKey: {
    groupBy: vi.fn(),
  },
  agentAlert: {
    groupBy: vi.fn(),
  },
  draftTransaction: {
    groupBy: vi.fn(),
  },
  uTXO: {
    groupBy: vi.fn(),
  },
  $queryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: prisma,
}));

import { findDashboardRows } from '../../../src/repositories/agentDashboardRepository';

describe('agentDashboardRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds dashboard rows from balances, drafts, spends, alerts, and key counts', async () => {
    const now = new Date('2026-04-16T00:00:00.000Z');
    const agent = {
      id: 'agent-1',
      name: 'Treasury Agent',
      status: 'active',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'device-1',
      user: { id: 'user-1', username: 'alice', isAdmin: false },
      fundingWallet: { id: 'funding-wallet', name: 'Funding', type: 'multi_sig', network: 'testnet' },
      operationalWallet: { id: 'operational-wallet', name: 'Ops', type: 'single_sig', network: 'testnet' },
      signerDevice: { id: 'device-1', label: 'Agent signer', fingerprint: 'aabbccdd' },
      apiKeys: [],
    };
    const draft = {
      id: 'draft-1',
      walletId: 'funding-wallet',
      recipient: 'tb1qops',
      amount: 50000n,
      fee: 250n,
      feeRate: 2.5,
      status: 'partial',
      approvalStatus: 'not_required',
      createdAt: now,
      updatedAt: now,
    };
    const spend = {
      id: 'tx-1',
      txid: 'a'.repeat(64),
      walletId: 'operational-wallet',
      type: 'sent',
      amount: 12000n,
      fee: 350n,
      confirmations: 0,
      blockTime: null,
      counterpartyAddress: 'tb1qrecipient',
      createdAt: now,
    };
    const alert = {
      id: 'alert-1',
      agentId: 'agent-1',
      status: 'open',
      createdAt: now,
    };

    prisma.walletAgent.findMany.mockResolvedValue([agent]);
    prisma.uTXO.groupBy.mockResolvedValue([{ walletId: 'operational-wallet', _sum: { amount: 82000n } }]);
    prisma.draftTransaction.groupBy.mockResolvedValue([{ agentId: 'agent-1', _count: { _all: 1 } }]);
    prisma.agentAlert.groupBy.mockResolvedValue([{ agentId: 'agent-1', _count: { _all: 2 } }]);
    prisma.agentApiKey.groupBy.mockResolvedValue([{ agentId: 'agent-1', _count: { _all: 1 } }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { ...draft, agentId: 'agent-1' },
        { ...draft, id: 'draft-2', agentId: 'agent-1' },
      ])
      .mockResolvedValueOnce([spend])
      .mockResolvedValueOnce([alert]);

    await expect(findDashboardRows()).resolves.toEqual([
      expect.objectContaining({
        agent,
        operationalBalanceSats: 82000n,
        pendingFundingDraftCount: 1,
        openAlertCount: 2,
        activeKeyCount: 1,
        lastFundingDraft: draft,
        lastOperationalSpend: spend,
        recentFundingDrafts: [draft, { ...draft, id: 'draft-2' }],
        recentOperationalSpends: [spend],
        recentAlerts: [alert],
      }),
    ]);

    expect(prisma.uTXO.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['walletId'],
      where: { walletId: { in: ['operational-wallet'] }, spent: false },
    }));
    expect(prisma.draftTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['agentId'],
      where: expect.objectContaining({
        agentId: { in: ['agent-1'] },
        status: { in: ['unsigned', 'partial', 'signed'] },
      }),
    }));
    expect(prisma.agentApiKey.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentId: { in: ['agent-1'] },
        revokedAt: null,
      }),
    }));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('short-circuits dashboard aggregation when no agents are registered', async () => {
    prisma.walletAgent.findMany.mockResolvedValue([]);

    await expect(findDashboardRows()).resolves.toEqual([]);

    expect(prisma.uTXO.groupBy).not.toHaveBeenCalled();
    expect(prisma.draftTransaction.groupBy).not.toHaveBeenCalled();
    expect(prisma.agentAlert.groupBy).not.toHaveBeenCalled();
    expect(prisma.agentApiKey.groupBy).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses dashboard defaults when aggregate rows are absent or unassigned', async () => {
    const agent = {
      id: 'agent-1',
      operationalWalletId: 'operational-wallet',
      fundingWalletId: 'funding-wallet',
      apiKeys: [],
    };

    prisma.walletAgent.findMany.mockResolvedValue([agent]);
    prisma.uTXO.groupBy.mockResolvedValue([{ walletId: 'operational-wallet', _sum: { amount: null } }]);
    prisma.draftTransaction.groupBy.mockResolvedValue([{ agentId: null, _count: { _all: 99 } }]);
    prisma.agentAlert.groupBy.mockResolvedValue([]);
    prisma.agentApiKey.groupBy.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(findDashboardRows()).resolves.toEqual([
      expect.objectContaining({
        agent,
        operationalBalanceSats: 0n,
        pendingFundingDraftCount: 0,
        openAlertCount: 0,
        activeKeyCount: 0,
        lastFundingDraft: null,
        lastOperationalSpend: null,
        recentFundingDrafts: [],
        recentOperationalSpends: [],
        recentAlerts: [],
      }),
    ]);
  });

  it('uses zero dashboard balance when no wallet balance row exists', async () => {
    const agent = {
      id: 'agent-1',
      operationalWalletId: 'operational-wallet',
      fundingWalletId: 'funding-wallet',
      apiKeys: [],
    };

    prisma.walletAgent.findMany.mockResolvedValue([agent]);
    prisma.uTXO.groupBy.mockResolvedValue([]);
    prisma.draftTransaction.groupBy.mockResolvedValue([]);
    prisma.agentAlert.groupBy.mockResolvedValue([]);
    prisma.agentApiKey.groupBy.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(findDashboardRows()).resolves.toEqual([
      expect.objectContaining({
        agent,
        operationalBalanceSats: 0n,
      }),
    ]);
  });
});
