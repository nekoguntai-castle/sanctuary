/**
 * The daily/weekly agent funding caps must not reset when an accepted funding
 * request loses its draft row: the linked user deletes the still-actionable
 * draft (allowed) and broadcasts the agent intent through
 * /transactions/broadcast without a draftId (no draft row is needed there).
 * Runs the real policy and the real agentRepository over a mocked Prisma
 * client whose rows describe exactly that state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  walletAgent: { findUnique: vi.fn() },
  agentFundingAttempt: { aggregate: vi.fn() },
  agentFundingOverride: { findFirst: vi.fn() },
  draftTransaction: { aggregate: vi.fn() },
}));

vi.mock('../../../src/models/prisma', () => ({ __esModule: true, default: mockPrisma }));
vi.mock('../../../src/repositories', async () => ({
  agentRepository: await vi.importActual('../../../src/repositories/agentRepository'),
  utxoRepository: { getUnspentBalance: vi.fn() },
}));

import { enforceAgentFundingPolicy } from '../../../src/services/agentFundingPolicy';

describe('agent funding caps survive the funding draft', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.walletAgent.findUnique.mockResolvedValue({
      id: 'agent-1',
      status: 'active',
      revokedAt: null,
      operationalWalletId: 'operational-wallet',
      cooldownMinutes: null,
      lastFundingDraftAt: null,
      maxFundingAmountSats: null,
      maxOperationalBalanceSats: null,
      dailyFundingLimitSats: 30_000n,
      weeklyFundingLimitSats: 30_000n,
    });
    mockPrisma.agentFundingOverride.findFirst.mockResolvedValue(null);
    // The 30,000-sat request was accepted earlier today ...
    mockPrisma.agentFundingAttempt.aggregate.mockResolvedValue({ _sum: { amount: 30_000n } });
    // ... and its draft row is gone (deleted before broadcast, intent broadcast without it).
    mockPrisma.draftTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } });
  });

  it('refuses the next request in the window after the funding draft was deleted', async () => {
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 1n, now))
      .rejects.toMatchObject({ details: { reasonCode: 'policy_daily_limit' } });
    // The caps read accepted attempts only; draft rows never enter the sum.
    expect(mockPrisma.draftTransaction.aggregate).not.toHaveBeenCalled();
  });

  it('still admits a request that fits beside the accepted total', async () => {
    mockPrisma.agentFundingAttempt.aggregate.mockResolvedValue({ _sum: { amount: 29_999n } });

    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 1n, now))
      .resolves.toEqual({ overrideId: null });
    expect(mockPrisma.draftTransaction.aggregate).not.toHaveBeenCalled();
  });
});
