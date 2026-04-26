import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  label: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  wallet: {
    findUnique: vi.fn(),
  },
  vaultPolicy: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  policyAddress: {
    findMany: vi.fn(),
  },
  policyEvent: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  draftTransaction: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  aIInsight: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  walletAgent: {
    findMany: vi.fn(),
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: prisma,
}));

import { assistantReadRepository } from '../../../src/repositories/assistantRead';

const walletId = '11111111-1111-4111-8111-111111111111';
const policyId = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const insightId = '66666666-6666-4666-8666-666666666666';

function wallet(groupId: string | null = null) {
  return { id: walletId, groupId };
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: policyId,
    walletId,
    groupId: null,
    sourceType: 'wallet',
    ...overrides,
  };
}

describe('assistant read batch 2 repository helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries label lists and details with bounded association includes', async () => {
    prisma.label.findMany.mockResolvedValueOnce([]);
    await assistantReadRepository.findWalletLabelsForAssistant(walletId, { query: 'ops', limit: 5 });
    expect(prisma.label.findMany).toHaveBeenCalledWith({
      where: { walletId, name: { contains: 'ops', mode: 'insensitive' } },
      include: { _count: { select: { transactionLabels: true, addressLabels: true } } },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      take: 5,
    });

    prisma.label.findMany.mockResolvedValueOnce([]);
    await assistantReadRepository.findWalletLabelsForAssistant(walletId, { limit: 2 });
    expect(prisma.label.findMany).toHaveBeenLastCalledWith({
      where: { walletId },
      include: { _count: { select: { transactionLabels: true, addressLabels: true } } },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      take: 2,
    });

    prisma.label.findMany.mockResolvedValueOnce([]);
    await assistantReadRepository.findWalletLabelsForAssistant(walletId, { limit: 999 });
    expect(prisma.label.findMany).toHaveBeenLastCalledWith({
      where: { walletId },
      include: { _count: { select: { transactionLabels: true, addressLabels: true } } },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      take: 201,
    });

    prisma.label.findMany.mockResolvedValueOnce([]);
    await assistantReadRepository.findWalletLabelsForAssistant(walletId);
    expect(prisma.label.findMany).toHaveBeenLastCalledWith({
      where: { walletId },
      include: { _count: { select: { transactionLabels: true, addressLabels: true } } },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      take: undefined,
    });

    prisma.label.findFirst.mockResolvedValueOnce({ id: 'label-1' });
    await expect(
      assistantReadRepository.findWalletLabelDetailForAssistant(walletId, 'label-1')
    ).resolves.toEqual({ id: 'label-1' });
    expect(prisma.label.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'label-1', walletId },
      include: expect.objectContaining({
        transactionLabels: expect.objectContaining({ take: 50 }),
        addressLabels: expect.objectContaining({ take: 50 }),
      }),
    }));
  });

  it('resolves wallet policies with optional inherited system and group policies', async () => {
    prisma.wallet.findUnique.mockResolvedValueOnce(null);
    await expect(
      assistantReadRepository.findWalletPoliciesForAssistant(walletId, true)
    ).resolves.toEqual({ wallet: null, policies: [] });

    prisma.wallet.findUnique.mockResolvedValueOnce(wallet());
    prisma.vaultPolicy.findMany.mockResolvedValueOnce([policy()]);
    await expect(
      assistantReadRepository.findWalletPoliciesForAssistant(walletId, false)
    ).resolves.toMatchObject({ policies: [policy()] });
    expect(prisma.vaultPolicy.findMany).toHaveBeenLastCalledWith({
      where: { walletId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    prisma.wallet.findUnique.mockResolvedValueOnce(wallet());
    prisma.vaultPolicy.findMany
      .mockResolvedValueOnce([policy()])
      .mockResolvedValueOnce([policy({ id: 'system-policy', walletId: null, sourceType: 'system' })]);

    const inheritedWithoutGroup = await assistantReadRepository.findWalletPoliciesForAssistant(walletId, true);
    expect(inheritedWithoutGroup.policies.map(item => item.id)).toEqual(['system-policy', policyId]);

    prisma.wallet.findUnique.mockResolvedValueOnce(wallet('group-1'));
    prisma.vaultPolicy.findMany
      .mockResolvedValueOnce([policy()])
      .mockResolvedValueOnce([policy({ id: 'system-policy', walletId: null, sourceType: 'system' })])
      .mockResolvedValueOnce([policy({ id: 'group-policy', walletId: null, groupId: 'group-1', sourceType: 'group' })]);

    const result = await assistantReadRepository.findWalletPoliciesForAssistant(walletId, true);
    expect(result.policies.map(item => item.id)).toEqual(['system-policy', 'group-policy', policyId]);
  });

  it('resolves policy detail only when the policy is visible to the wallet', async () => {
    prisma.wallet.findUnique.mockResolvedValueOnce(null);
    await expect(
      assistantReadRepository.findWalletPolicyDetailForAssistant(walletId, policyId)
    ).resolves.toBeNull();

    prisma.wallet.findUnique.mockResolvedValue(wallet('group-1'));
    prisma.policyAddress.findMany.mockResolvedValue([]);
    prisma.policyEvent.findMany.mockResolvedValue([]);
    prisma.policyEvent.count.mockResolvedValue(0);

    prisma.vaultPolicy.findUnique.mockResolvedValueOnce(policy());
    await expect(
      assistantReadRepository.findWalletPolicyDetailForAssistant(walletId, policyId)
    ).resolves.toMatchObject({ policy: policy(), addresses: [], eventTotal: 0 });

    prisma.vaultPolicy.findUnique.mockResolvedValueOnce(policy({ walletId: null, sourceType: 'system' }));
    await expect(
      assistantReadRepository.findWalletPolicyDetailForAssistant(walletId, policyId)
    ).resolves.toMatchObject({ policy: expect.objectContaining({ sourceType: 'system' }) });

    prisma.vaultPolicy.findUnique.mockResolvedValueOnce(policy({ walletId: null, groupId: 'group-1', sourceType: 'group' }));
    await expect(
      assistantReadRepository.findWalletPolicyDetailForAssistant(walletId, policyId, 'allow')
    ).resolves.toMatchObject({ policy: expect.objectContaining({ groupId: 'group-1' }) });
    expect(prisma.policyAddress.findMany).toHaveBeenLastCalledWith({
      where: { policyId, listType: 'allow' },
      orderBy: { createdAt: 'desc' },
      take: 101,
    });

    prisma.vaultPolicy.findUnique.mockResolvedValueOnce(policy({ walletId: null, groupId: 'other-group', sourceType: 'group' }));
    await expect(
      assistantReadRepository.findWalletPolicyDetailForAssistant(walletId, policyId)
    ).resolves.toBeNull();
  });

  it('wraps policy events, draft detail, insights, and admin dashboard reads', async () => {
    prisma.policyEvent.findMany.mockResolvedValueOnce([{ id: 'event-1' }]);
    prisma.policyEvent.count.mockResolvedValueOnce(1);
    await expect(
      assistantReadRepository.findWalletPolicyEventsForAssistant(walletId, { policyId, limit: 3 })
    ).resolves.toEqual({ events: [{ id: 'event-1' }], total: 1 });
    expect(prisma.policyEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { walletId, policyId },
      take: 3,
    }));

    prisma.draftTransaction.count.mockResolvedValueOnce(2);
    await expect(assistantReadRepository.countDrafts(walletId)).resolves.toBe(2);
    prisma.draftTransaction.findFirst.mockResolvedValueOnce({ id: draftId });
    await expect(
      assistantReadRepository.findDraftDetailForAssistant(walletId, draftId)
    ).resolves.toEqual({ id: draftId });
    expect(prisma.draftTransaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: draftId, walletId },
      include: expect.objectContaining({
        approvalRequests: expect.any(Object),
        utxoLocks: expect.any(Object),
      }),
    }));

    prisma.aIInsight.findMany.mockResolvedValueOnce([{ id: insightId }]);
    await expect(
      assistantReadRepository.findWalletInsightsForAssistant(walletId, { status: 'active' }, 4)
    ).resolves.toEqual([{ id: insightId }]);
    expect(prisma.aIInsight.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { walletId, status: 'active' },
      take: 4,
    }));

    prisma.aIInsight.findUnique
      .mockResolvedValueOnce({ id: insightId, walletId: 'other-wallet' })
      .mockResolvedValueOnce({ id: insightId, walletId });
    await expect(
      assistantReadRepository.findWalletInsightDetailForAssistant(walletId, insightId)
    ).resolves.toBeNull();
    await expect(
      assistantReadRepository.findWalletInsightDetailForAssistant(walletId, insightId)
    ).resolves.toEqual({ id: insightId, walletId });

    prisma.walletAgent.findMany.mockResolvedValueOnce([]);
    await expect(assistantReadRepository.findAdminAgentDashboardRowsForAssistant(101)).resolves.toEqual([]);
    expect(prisma.walletAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });
});
