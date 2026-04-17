import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

const prisma = vi.hoisted(() => ({
  walletAgent: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  agentApiKey: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  agentFundingAttempt: {
    create: vi.fn(),
    count: vi.fn(),
  },
  agentFundingOverride: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  agentAlert: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  draftTransaction: {
    aggregate: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  transaction: {
    findMany: vi.fn(),
  },
  uTXO: {
    groupBy: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: prisma,
}));

import * as agentRepository from '../../../src/repositories/agentRepository';

describe('agentRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: '' }]);
  });

  it('creates and finds wallet agent metadata', async () => {
    prisma.walletAgent.create.mockResolvedValue({ id: 'agent-1' });

    await expect(agentRepository.createAgent({
      userId: 'user-1',
      name: 'Treasury Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'agent-device',
    })).resolves.toEqual({ id: 'agent-1' });

    expect(prisma.walletAgent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        name: 'Treasury Agent',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        signerDeviceId: 'agent-device',
        status: 'active',
        maxFundingAmountSats: null,
        maxOperationalBalanceSats: null,
        dailyFundingLimitSats: null,
        weeklyFundingLimitSats: null,
        cooldownMinutes: null,
        minOperationalBalanceSats: null,
        largeOperationalSpendSats: null,
        largeOperationalFeeSats: null,
        repeatedFailureThreshold: null,
        repeatedFailureLookbackMinutes: null,
        alertDedupeMinutes: null,
        requireHumanApproval: true,
        notifyOnOperationalSpend: true,
        pauseOnUnexpectedSpend: false,
        revokedAt: null,
      },
    });

    prisma.walletAgent.findUnique.mockResolvedValue({ id: 'agent-1' });
    await agentRepository.findAgentById('agent-1');

    expect(prisma.walletAgent.findUnique).toHaveBeenCalledWith({ where: { id: 'agent-1' } });
  });

  it('sets revokedAt when a wallet agent is created revoked', async () => {
    prisma.walletAgent.create.mockResolvedValue({ id: 'agent-1', status: 'revoked' });

    await agentRepository.createAgent({
      userId: 'user-1',
      name: 'Disabled Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'agent-device',
      status: 'revoked',
    });

    expect(prisma.walletAgent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'revoked',
        revokedAt: expect.any(Date),
      }),
    });
  });

  it('lists, updates, and tracks wallet agent policy metadata', async () => {
    prisma.walletAgent.findMany.mockResolvedValue([{ id: 'agent-1' }]);
    await agentRepository.findAgents();

    expect(prisma.walletAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        user: expect.anything(),
        fundingWallet: expect.anything(),
        operationalWallet: expect.anything(),
        signerDevice: expect.anything(),
        apiKeys: true,
      }),
    }));

    await agentRepository.findAgents({ walletId: 'wallet-1' });
    expect(prisma.walletAgent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        OR: [
          { fundingWalletId: 'wallet-1' },
          { operationalWalletId: 'wallet-1' },
        ],
      },
    }));

    prisma.walletAgent.update.mockResolvedValue({ id: 'agent-1', status: 'paused' });
    await agentRepository.updateAgent('agent-1', {
      status: 'paused',
      maxFundingAmountSats: 100000n,
      minOperationalBalanceSats: 25000n,
      repeatedFailureThreshold: 3,
      cooldownMinutes: 10,
    });

    expect(prisma.walletAgent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: expect.objectContaining({
        status: 'paused',
        maxFundingAmountSats: 100000n,
        minOperationalBalanceSats: 25000n,
        repeatedFailureThreshold: 3,
        cooldownMinutes: 10,
      }),
    });

    await agentRepository.markAgentFundingDraftCreated('agent-1', new Date('2026-04-16T00:00:00.000Z'));
    expect(prisma.walletAgent.update).toHaveBeenLastCalledWith({
      where: { id: 'agent-1' },
      data: { lastFundingDraftAt: new Date('2026-04-16T00:00:00.000Z') },
    });

    prisma.draftTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50000n } });
    await expect(agentRepository.sumAgentDraftAmountsSince(
      'agent-1',
      new Date('2026-04-16T00:00:00.000Z')
    )).resolves.toBe(50000n);
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
      .mockResolvedValueOnce([{ ...draft, agentId: 'agent-1' }])
      .mockResolvedValueOnce([spend])
      .mockResolvedValueOnce([alert]);

    await expect(agentRepository.findDashboardRows()).resolves.toEqual([
      expect.objectContaining({
        agent,
        operationalBalanceSats: 82000n,
        pendingFundingDraftCount: 1,
        openAlertCount: 2,
        activeKeyCount: 1,
        lastFundingDraft: draft,
        lastOperationalSpend: spend,
        recentFundingDrafts: [draft],
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

    await expect(agentRepository.findDashboardRows()).resolves.toEqual([]);

    expect(prisma.uTXO.groupBy).not.toHaveBeenCalled();
    expect(prisma.draftTransaction.groupBy).not.toHaveBeenCalled();
    expect(prisma.agentAlert.groupBy).not.toHaveBeenCalled();
    expect(prisma.agentApiKey.groupBy).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('creates, finds, revokes, and updates agent API keys', async () => {
    prisma.agentApiKey.create.mockResolvedValue({ id: 'key-1' });

    await expect(agentRepository.createApiKey({
      agentId: 'agent-1',
      name: 'Runtime key',
      keyHash: 'hash',
      keyPrefix: 'agt_hash',
    })).resolves.toEqual({ id: 'key-1' });

    expect(prisma.agentApiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-1',
        createdByUserId: null,
        name: 'Runtime key',
        keyHash: 'hash',
        keyPrefix: 'agt_hash',
        scope: Prisma.DbNull,
        expiresAt: null,
      }),
    });

    prisma.agentApiKey.findUnique.mockResolvedValue({ id: 'key-1' });
    await agentRepository.findApiKeyByHash('hash');

    expect(prisma.agentApiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: 'hash' },
      include: {
        agent: {
          include: {
            user: {
              select: { id: true, username: true, isAdmin: true },
            },
          },
        },
      },
    });

    await agentRepository.findApiKeyById('key-1');
    expect(prisma.agentApiKey.findUnique).toHaveBeenLastCalledWith({ where: { id: 'key-1' } });

    prisma.agentApiKey.findMany.mockResolvedValue([{ id: 'key-1' }]);
    await agentRepository.findApiKeysByAgentId('agent-1');
    expect(prisma.agentApiKey.findMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1' },
      orderBy: { createdAt: 'desc' },
    });

    prisma.agentApiKey.update.mockResolvedValue({ id: 'key-1', revokedAt: expect.any(Date) });
    await agentRepository.revokeApiKey('key-1');

    expect(prisma.agentApiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { revokedAt: expect.any(Date) },
    });

    const staleBefore = new Date('2026-04-16T00:00:00.000Z');
    await agentRepository.updateApiKeyLastUsedIfStale('key-1', staleBefore, { lastUsedIp: '127.0.0.1' });

    expect(prisma.agentApiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'key-1',
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }],
      },
      data: {
        lastUsedAt: expect.any(Date),
        lastUsedIp: '127.0.0.1',
        lastUsedAgent: null,
      },
    });
  });

  it('serializes agent funding work with a database advisory lock', async () => {
    const result = await agentRepository.withAgentFundingLock('agent-1', async () => 'locked-result');

    expect(result).toBe('locked-result');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5000,
      timeout: 60000,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('records agent funding attempts for monitoring', async () => {
    prisma.agentFundingAttempt.create.mockResolvedValue({ id: 'attempt-1' });

    await expect(agentRepository.createFundingAttempt({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      draftId: 'draft-1',
      status: 'rejected',
      reasonCode: 'policy_daily_limit',
      reasonMessage: 'Agent daily funding limit would be exceeded',
      amount: 10000n,
      feeRate: 5,
      recipient: 'tb1qrecipient',
      ipAddress: '127.0.0.1',
      userAgent: 'agent-runtime',
    })).resolves.toEqual({ id: 'attempt-1' });

    expect(prisma.agentFundingAttempt.create).toHaveBeenCalledWith({
      data: {
        agentId: 'agent-1',
        keyId: 'key-1',
        keyPrefix: 'agt_prefix',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        draftId: 'draft-1',
        status: 'rejected',
        reasonCode: 'policy_daily_limit',
        reasonMessage: 'Agent daily funding limit would be exceeded',
        amount: 10000n,
        feeRate: 5,
        recipient: 'tb1qrecipient',
        ipAddress: '127.0.0.1',
        userAgent: 'agent-runtime',
      },
    });
  });

  it('creates, lists, consumes, and revokes funding overrides', async () => {
    const expiresAt = new Date('2026-04-17T00:00:00.000Z');
    const now = new Date('2026-04-16T00:00:00.000Z');
    const override = {
      id: 'override-1',
      agentId: 'agent-1',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      createdByUserId: 'admin-1',
      reason: 'emergency refill',
      maxAmountSats: 250000n,
      expiresAt,
      status: 'active',
      usedAt: null,
      usedDraftId: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    prisma.agentFundingOverride.create.mockResolvedValue(override);
    await expect(agentRepository.createFundingOverride({
      agentId: 'agent-1',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      createdByUserId: 'admin-1',
      reason: 'emergency refill',
      maxAmountSats: 250000n,
      expiresAt,
    })).resolves.toEqual(override);

    expect(prisma.agentFundingOverride.create).toHaveBeenCalledWith({
      data: {
        agentId: 'agent-1',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        createdByUserId: 'admin-1',
        reason: 'emergency refill',
        maxAmountSats: 250000n,
        expiresAt,
      },
    });

    prisma.agentFundingOverride.findMany.mockResolvedValue([override]);
    await expect(agentRepository.findFundingOverrides({
      agentId: 'agent-1',
      status: 'active',
    })).resolves.toEqual([override]);

    expect(prisma.agentFundingOverride.findMany).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        status: 'active',
      },
      orderBy: { createdAt: 'desc' },
    });

    prisma.agentFundingOverride.findUnique.mockResolvedValue(override);
    await expect(agentRepository.findFundingOverrideById('override-1')).resolves.toEqual(override);
    expect(prisma.agentFundingOverride.findUnique).toHaveBeenCalledWith({ where: { id: 'override-1' } });

    prisma.agentFundingOverride.findFirst.mockResolvedValue(override);
    await expect(agentRepository.findUsableFundingOverride({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
      amount: 125000n,
      now,
    })).resolves.toEqual(override);

    expect(prisma.agentFundingOverride.findFirst).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        operationalWalletId: 'operational-wallet',
        status: 'active',
        revokedAt: null,
        usedAt: null,
        expiresAt: { gt: now },
        maxAmountSats: { gte: 125000n },
      },
      orderBy: [
        { expiresAt: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    prisma.agentFundingOverride.update.mockResolvedValue({ ...override, status: 'used', usedDraftId: 'draft-1' });
    await agentRepository.markFundingOverrideUsed('override-1', 'draft-1');
    expect(prisma.agentFundingOverride.update).toHaveBeenCalledWith({
      where: { id: 'override-1' },
      data: {
        status: 'used',
        usedAt: expect.any(Date),
        usedDraftId: 'draft-1',
      },
    });

    prisma.agentFundingOverride.update.mockResolvedValue({ ...override, status: 'revoked', revokedAt: now });
    await agentRepository.revokeFundingOverride('override-1');
    expect(prisma.agentFundingOverride.update).toHaveBeenLastCalledWith({
      where: { id: 'override-1' },
      data: {
        status: 'revoked',
        revokedAt: expect.any(Date),
      },
    });
  });

  it('counts rejected funding attempts and stores deduped alert history', async () => {
    const since = new Date('2026-04-16T00:00:00.000Z');
    prisma.agentFundingAttempt.count.mockResolvedValue(3);

    await expect(agentRepository.countRejectedFundingAttemptsSince('agent-1', since)).resolves.toBe(3);
    expect(prisma.agentFundingAttempt.count).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        status: 'rejected',
        createdAt: { gte: since },
      },
    });

    prisma.agentAlert.create.mockResolvedValue({ id: 'alert-1' });
    await expect(agentRepository.createAlert({
      agentId: 'agent-1',
      walletId: 'wallet-1',
      type: 'large_operational_spend',
      severity: 'critical',
      txid: 'a'.repeat(64),
      amountSats: 100000n,
      thresholdSats: 75000n,
      message: 'Large operational spend',
      dedupeKey: 'agent:agent-1:large_spend:tx',
      metadata: { thresholdSats: '75000' },
    })).resolves.toEqual({ id: 'alert-1' });

    expect(prisma.agentAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-1',
        walletId: 'wallet-1',
        type: 'large_operational_spend',
        severity: 'critical',
        status: 'open',
        amountSats: 100000n,
        thresholdSats: 75000n,
        dedupeKey: 'agent:agent-1:large_spend:tx',
        metadata: { thresholdSats: '75000' },
      }),
    });

    prisma.agentAlert.findFirst.mockClear();
    prisma.agentAlert.create.mockClear();
    prisma.agentAlert.findFirst.mockResolvedValueOnce(null);
    prisma.agentAlert.create.mockResolvedValueOnce({ id: 'alert-locked' });
    await expect(agentRepository.createAlertIfNotDuplicate({
      agentId: 'agent-1',
      type: 'operational_balance_low',
      severity: 'warning',
      amountSats: 20000n,
      thresholdSats: 25000n,
      message: 'Balance below threshold',
      dedupeKey: 'agent:agent-1:balance_low:wallet-1',
    }, since)).resolves.toEqual({ id: 'alert-locked' });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5000,
      timeout: 5000,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.agentAlert.findFirst).toHaveBeenCalledWith({
      where: {
        dedupeKey: 'agent:agent-1:balance_low:wallet-1',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.agentAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-1',
        type: 'operational_balance_low',
        dedupeKey: 'agent:agent-1:balance_low:wallet-1',
      }),
    });

    prisma.agentAlert.findFirst.mockClear();
    prisma.agentAlert.create.mockClear();
    prisma.agentAlert.findFirst.mockResolvedValueOnce({ id: 'existing-alert' });
    await expect(agentRepository.createAlertIfNotDuplicate({
      agentId: 'agent-1',
      type: 'operational_balance_low',
      severity: 'warning',
      message: 'Balance below threshold',
      dedupeKey: 'agent:agent-1:balance_low:wallet-1',
    }, since)).resolves.toBeNull();
    expect(prisma.agentAlert.create).not.toHaveBeenCalled();

    prisma.$transaction.mockClear();
    prisma.$queryRaw.mockClear();
    prisma.agentAlert.create.mockClear();
    prisma.agentAlert.create.mockResolvedValueOnce({ id: 'alert-without-dedupe' });
    await expect(agentRepository.createAlertIfNotDuplicate({
      agentId: 'agent-1',
      type: 'manual_review',
      severity: 'info',
      message: 'Manual review alert without dedupe',
    }, since)).resolves.toEqual({ id: 'alert-without-dedupe' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.agentAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-1',
        type: 'manual_review',
        dedupeKey: null,
      }),
    });

    prisma.agentAlert.findMany.mockResolvedValue([{ id: 'alert-2' }]);
    await expect(agentRepository.findAlerts({
      agentId: 'agent-1',
      status: 'open',
      type: 'large_operational_fee',
      limit: 10,
    })).resolves.toEqual([{ id: 'alert-2' }]);
    expect(prisma.agentAlert.findMany).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        status: 'open',
        type: 'large_operational_fee',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });
});
