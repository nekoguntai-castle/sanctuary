import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';
import {
  agentRepository,
  prisma,
  resetAgentRepositoryMocks,
} from './agentRepository.testHarness';

describe('agentRepository', () => {
  beforeEach(resetAgentRepositoryMocks);

  it('creates and finds wallet agent metadata', async () => {
    prisma.walletAgent.create.mockResolvedValue({ id: 'agent-1' });

    await expect(
      agentRepository.createAgent({
        userId: 'user-1',
        name: 'Treasury Agent',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        signerDeviceId: 'agent-device',
      }),
    ).resolves.toEqual({ id: 'agent-1' });

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

    expect(prisma.walletAgent.findUnique).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
    });

    await agentRepository.findAgentByIdWithDetails('agent-1');
    expect(prisma.walletAgent.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'agent-1' },
        include: expect.objectContaining({
          user: expect.anything(),
          fundingWallet: expect.anything(),
          operationalWallet: expect.anything(),
          signerDevice: expect.anything(),
          apiKeys: true,
        }),
      }),
    );

    await agentRepository.findActiveAgentsByOperationalWalletId(
      'operational-wallet',
    );
    expect(prisma.walletAgent.findMany).toHaveBeenCalledWith({
      where: {
        operationalWalletId: 'operational-wallet',
        status: 'active',
        revokedAt: null,
      },
    });
  });

  it('sets revokedAt when a wallet agent is created revoked', async () => {
    prisma.walletAgent.create.mockResolvedValue({
      id: 'agent-1',
      status: 'revoked',
    });

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

  it('creates wallet agents without a signer device', async () => {
    prisma.walletAgent.create.mockResolvedValue({ id: 'agent-1' });

    await agentRepository.createAgent({
      userId: 'user-1',
      name: 'Requester Only Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
    });

    expect(prisma.walletAgent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signerDeviceId: null,
      }),
    });
  });

  it('creates wallet agents with explicit policy and monitoring fields', async () => {
    prisma.walletAgent.create.mockResolvedValue({
      id: 'agent-2',
      status: 'paused',
    });

    await agentRepository.createAgent({
      userId: 'user-2',
      name: 'Configured Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'agent-device',
      status: 'paused',
      maxFundingAmountSats: 100000n,
      maxOperationalBalanceSats: 200000n,
      dailyFundingLimitSats: 300000n,
      weeklyFundingLimitSats: 900000n,
      cooldownMinutes: 15,
      minOperationalBalanceSats: 25000n,
      largeOperationalSpendSats: 75000n,
      largeOperationalFeeSats: 5000n,
      repeatedFailureThreshold: 3,
      repeatedFailureLookbackMinutes: 60,
      alertDedupeMinutes: 120,
      requireHumanApproval: false,
      notifyOnOperationalSpend: false,
      pauseOnUnexpectedSpend: true,
    });

    expect(prisma.walletAgent.create).toHaveBeenLastCalledWith({
      data: {
        userId: 'user-2',
        name: 'Configured Agent',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        signerDeviceId: 'agent-device',
        status: 'paused',
        maxFundingAmountSats: 100000n,
        maxOperationalBalanceSats: 200000n,
        dailyFundingLimitSats: 300000n,
        weeklyFundingLimitSats: 900000n,
        cooldownMinutes: 15,
        minOperationalBalanceSats: 25000n,
        largeOperationalSpendSats: 75000n,
        largeOperationalFeeSats: 5000n,
        repeatedFailureThreshold: 3,
        repeatedFailureLookbackMinutes: 60,
        alertDedupeMinutes: 120,
        requireHumanApproval: false,
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: true,
        revokedAt: null,
      },
    });
  });

  it('lists, updates, and tracks wallet agent policy metadata', async () => {
    prisma.walletAgent.findMany.mockResolvedValue([{ id: 'agent-1' }]);
    await agentRepository.findAgents();

    expect(prisma.walletAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          user: expect.anything(),
          fundingWallet: expect.anything(),
          operationalWallet: expect.anything(),
          signerDevice: expect.anything(),
          apiKeys: true,
        }),
      }),
    );

    await agentRepository.findAgents({ walletId: 'wallet-1' });
    expect(prisma.walletAgent.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { fundingWalletId: 'wallet-1' },
            { operationalWalletId: 'wallet-1' },
          ],
        },
      }),
    );

    prisma.walletAgent.update.mockResolvedValue({
      id: 'agent-1',
      status: 'paused',
    });
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

    await agentRepository.markAgentFundingDraftCreated(
      'agent-1',
      new Date('2026-04-16T00:00:00.000Z'),
    );
    expect(prisma.walletAgent.update).toHaveBeenLastCalledWith({
      where: { id: 'agent-1' },
      data: { lastFundingDraftAt: new Date('2026-04-16T00:00:00.000Z') },
    });

    prisma.draftTransaction.aggregate.mockResolvedValue({
      _sum: { amount: 50000n },
    });
    await expect(
      agentRepository.sumAgentDraftAmountsSince(
        'agent-1',
        new Date('2026-04-16T00:00:00.000Z'),
      ),
    ).resolves.toBe(50000n);

    prisma.draftTransaction.aggregate.mockResolvedValueOnce({
      _sum: { amount: null },
    });
    await expect(
      agentRepository.sumAgentDraftAmountsSince(
        'agent-1',
        new Date('2026-04-16T00:00:00.000Z'),
      ),
    ).resolves.toBe(0n);
  });

  it('updates every wallet agent field when explicit values are provided', async () => {
    const revokedAt = new Date('2026-04-16T00:00:00.000Z');
    prisma.walletAgent.update.mockResolvedValue({ id: 'agent-1' });

    await agentRepository.updateAgent('agent-1', {
      name: 'Updated Agent',
      status: 'revoked',
      maxFundingAmountSats: 200000n,
      maxOperationalBalanceSats: 300000n,
      dailyFundingLimitSats: 400000n,
      weeklyFundingLimitSats: 1000000n,
      cooldownMinutes: 15,
      minOperationalBalanceSats: 50000n,
      largeOperationalSpendSats: 75000n,
      largeOperationalFeeSats: 5000n,
      repeatedFailureThreshold: 3,
      repeatedFailureLookbackMinutes: 60,
      alertDedupeMinutes: 120,
      requireHumanApproval: false,
      notifyOnOperationalSpend: false,
      pauseOnUnexpectedSpend: true,
      revokedAt,
    });

    expect(prisma.walletAgent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: {
        name: 'Updated Agent',
        status: 'revoked',
        maxFundingAmountSats: 200000n,
        maxOperationalBalanceSats: 300000n,
        dailyFundingLimitSats: 400000n,
        weeklyFundingLimitSats: 1000000n,
        cooldownMinutes: 15,
        minOperationalBalanceSats: 50000n,
        largeOperationalSpendSats: 75000n,
        largeOperationalFeeSats: 5000n,
        repeatedFailureThreshold: 3,
        repeatedFailureLookbackMinutes: 60,
        alertDedupeMinutes: 120,
        requireHumanApproval: false,
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: true,
        revokedAt,
      },
    });
  });

  it('creates, finds, revokes, and updates agent API keys', async () => {
    prisma.agentApiKey.create.mockResolvedValue({ id: 'key-1' });

    await expect(
      agentRepository.createApiKey({
        agentId: 'agent-1',
        name: 'Runtime key',
        keyHash: 'hash',
        keyPrefix: 'agt_hash',
      }),
    ).resolves.toEqual({ id: 'key-1' });

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
    expect(prisma.agentApiKey.findUnique).toHaveBeenLastCalledWith({
      where: { id: 'key-1' },
    });

    prisma.agentApiKey.findMany.mockResolvedValue([{ id: 'key-1' }]);
    await agentRepository.findApiKeysByAgentId('agent-1');
    expect(prisma.agentApiKey.findMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1' },
      orderBy: { createdAt: 'desc' },
    });

    prisma.agentApiKey.update.mockResolvedValue({
      id: 'key-1',
      revokedAt: expect.any(Date),
    });
    await agentRepository.revokeApiKey('key-1');

    expect(prisma.agentApiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { revokedAt: expect.any(Date) },
    });

    const staleBefore = new Date('2026-04-16T00:00:00.000Z');
    await agentRepository.updateApiKeyLastUsedIfStale('key-1', staleBefore, {
      lastUsedIp: '127.0.0.1',
    });

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

    prisma.agentApiKey.create.mockResolvedValueOnce({ id: 'key-2' });
    await agentRepository.createApiKey({
      agentId: 'agent-1',
      createdByUserId: 'admin-1',
      name: 'Scoped key',
      keyHash: 'hash-2',
      keyPrefix: 'agt_hash_2',
      scope: { allowedActions: ['create_funding_draft'] },
      expiresAt: new Date('2026-04-17T00:00:00.000Z'),
    });

    expect(prisma.agentApiKey.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        createdByUserId: 'admin-1',
        scope: { allowedActions: ['create_funding_draft'] },
        expiresAt: new Date('2026-04-17T00:00:00.000Z'),
      }),
    });

    await agentRepository.updateApiKeyLastUsedIfStale('key-2', staleBefore, {
      lastUsedAgent: 'agent-runtime',
    });
    expect(prisma.agentApiKey.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastUsedIp: null,
          lastUsedAgent: 'agent-runtime',
        }),
      }),
    );
  });

});
