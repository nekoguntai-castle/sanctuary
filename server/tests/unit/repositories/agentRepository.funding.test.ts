import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentRepository,
  prisma,
  resetAgentRepositoryMocks,
} from './agentRepository.testHarness';

describe('agentRepository funding controls', () => {
  beforeEach(resetAgentRepositoryMocks);

  it('serializes agent funding work with a database advisory lock', async () => {
    const result = await agentRepository.withAgentFundingLock(
      'agent-1',
      async () => 'locked-result',
    );

    expect(result).toBe('locked-result');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5000,
      timeout: 60000,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('passes the advisory-locked transaction client to agent funding work', async () => {
    const result = await agentRepository.withAgentFundingTransaction(
      'agent-1',
      async tx => {
        expect(tx).toBe(prisma);
        return 'transaction-result';
      },
    );

    expect(result).toBe('transaction-result');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5000,
      timeout: 60000,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('records agent funding attempts for monitoring', async () => {
    prisma.agentFundingAttempt.create.mockResolvedValue({ id: 'attempt-1' });

    await expect(
      agentRepository.createFundingAttempt({
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
      }),
    ).resolves.toEqual({ id: 'attempt-1' });

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

    prisma.agentFundingAttempt.create.mockResolvedValueOnce({
      id: 'attempt-2',
    });
    await agentRepository.createFundingAttempt({
      agentId: 'agent-1',
      fundingWalletId: 'funding-wallet',
      status: 'accepted',
    });

    expect(prisma.agentFundingAttempt.create).toHaveBeenLastCalledWith({
      data: {
        agentId: 'agent-1',
        keyId: null,
        keyPrefix: null,
        fundingWalletId: 'funding-wallet',
        operationalWalletId: null,
        draftId: null,
        status: 'accepted',
        reasonCode: null,
        reasonMessage: null,
        amount: null,
        feeRate: null,
        recipient: null,
        ipAddress: null,
        userAgent: null,
      },
    });

    const client = {
      agentFundingAttempt: {
        create: vi.fn().mockResolvedValue({ id: 'attempt-tx' }),
      },
    };
    await agentRepository.createFundingAttempt(
      {
        agentId: 'agent-1',
        fundingWalletId: 'funding-wallet',
        status: 'accepted',
      },
      client as any,
    );
    expect(client.agentFundingAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentId: 'agent-1',
          status: 'accepted',
        }),
      }),
    );
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
    await expect(
      agentRepository.createFundingOverride({
        agentId: 'agent-1',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        createdByUserId: 'admin-1',
        reason: 'emergency refill',
        maxAmountSats: 250000n,
        expiresAt,
      }),
    ).resolves.toEqual(override);

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

    prisma.agentFundingOverride.create.mockResolvedValueOnce({
      ...override,
      id: 'override-2',
      createdByUserId: null,
    });
    await agentRepository.createFundingOverride({
      agentId: 'agent-1',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      createdByUserId: undefined,
      reason: 'self-service',
      maxAmountSats: 100000n,
      expiresAt,
    });

    expect(prisma.agentFundingOverride.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        createdByUserId: null,
      }),
    });

    prisma.agentFundingOverride.findMany.mockResolvedValue([override]);
    await expect(
      agentRepository.findFundingOverrides({
        agentId: 'agent-1',
        status: 'active',
        limit: 10,
      }),
    ).resolves.toEqual([override]);

    expect(prisma.agentFundingOverride.findMany).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        status: 'active',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    await agentRepository.findFundingOverrides({
      agentId: 'agent-1',
      limit: 5,
    });
    expect(prisma.agentFundingOverride.findMany).toHaveBeenLastCalledWith({
      where: {
        agentId: 'agent-1',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    prisma.agentFundingOverride.findUnique.mockResolvedValue(override);
    await expect(
      agentRepository.findFundingOverrideById('override-1'),
    ).resolves.toEqual(override);
    expect(prisma.agentFundingOverride.findUnique).toHaveBeenCalledWith({
      where: { id: 'override-1' },
    });

    prisma.agentFundingOverride.findFirst.mockResolvedValue(override);
    await expect(
      agentRepository.findUsableFundingOverride({
        agentId: 'agent-1',
        operationalWalletId: 'operational-wallet',
        amount: 125000n,
        now,
      }),
    ).resolves.toEqual(override);

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
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });

    prisma.agentFundingOverride.updateMany.mockResolvedValue({ count: 1 });
    prisma.agentFundingOverride.findUnique.mockResolvedValue({
      ...override,
      status: 'used',
      usedDraftId: 'draft-1',
    });
    await agentRepository.markFundingOverrideUsed('override-1', 'draft-1');
    expect(prisma.agentFundingOverride.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'override-1',
        status: 'active',
        revokedAt: null,
        usedAt: null,
      },
      data: {
        status: 'used',
        usedAt: expect.any(Date),
        usedDraftId: 'draft-1',
      },
    });

    prisma.agentFundingOverride.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      agentRepository.markFundingOverrideUsed('override-1', 'draft-2'),
    ).rejects.toThrow('no longer usable');

    prisma.agentFundingOverride.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.agentFundingOverride.findUnique.mockResolvedValueOnce(null);
    await expect(
      agentRepository.markFundingOverrideUsed('override-1', 'draft-3'),
    ).rejects.toThrow('not found');

    prisma.agentFundingOverride.update.mockResolvedValue({
      ...override,
      status: 'revoked',
      revokedAt: now,
    });
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

    await expect(
      agentRepository.countRejectedFundingAttemptsSince('agent-1', since),
    ).resolves.toBe(3);
    expect(prisma.agentFundingAttempt.count).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        status: 'rejected',
        createdAt: { gte: since },
      },
    });

    prisma.agentAlert.create.mockResolvedValue({ id: 'alert-1' });
    await expect(
      agentRepository.createAlert({
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
      }),
    ).resolves.toEqual({ id: 'alert-1' });

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
    await expect(
      agentRepository.createAlertIfNotDuplicate(
        {
          agentId: 'agent-1',
          type: 'operational_balance_low',
          severity: 'warning',
          amountSats: 20000n,
          thresholdSats: 25000n,
          message: 'Balance below threshold',
          dedupeKey: 'agent:agent-1:balance_low:wallet-1',
        },
        since,
      ),
    ).resolves.toEqual({ id: 'alert-locked' });

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
    await expect(
      agentRepository.createAlertIfNotDuplicate(
        {
          agentId: 'agent-1',
          type: 'operational_balance_low',
          severity: 'warning',
          message: 'Balance below threshold',
          dedupeKey: 'agent:agent-1:balance_low:wallet-1',
        },
        since,
      ),
    ).resolves.toBeNull();
    expect(prisma.agentAlert.create).not.toHaveBeenCalled();

    prisma.$transaction.mockClear();
    prisma.$queryRaw.mockClear();
    prisma.agentAlert.create.mockClear();
    prisma.agentAlert.create.mockResolvedValueOnce({
      id: 'alert-without-dedupe',
    });
    await expect(
      agentRepository.createAlertIfNotDuplicate(
        {
          agentId: 'agent-1',
          type: 'manual_review',
          severity: 'info',
          message: 'Manual review alert without dedupe',
        },
        since,
      ),
    ).resolves.toEqual({ id: 'alert-without-dedupe' });
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
    await expect(
      agentRepository.findAlerts({
        agentId: 'agent-1',
        status: 'open',
        type: 'large_operational_fee',
        limit: 10,
      }),
    ).resolves.toEqual([{ id: 'alert-2' }]);
    expect(prisma.agentAlert.findMany).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        status: 'open',
        type: 'large_operational_fee',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    await agentRepository.findAlerts({
      agentId: 'agent-1',
      limit: 5,
    });
    expect(prisma.agentAlert.findMany).toHaveBeenLastCalledWith({
      where: {
        agentId: 'agent-1',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });
});
