import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidInputError } from '../../../src/errors';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    findAgentById: vi.fn(),
    sumAgentDraftAmountsSince: vi.fn(),
  },
  utxoRepository: {
    getUnspentBalance: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: mocks.agentRepository,
  utxoRepository: mocks.utxoRepository,
}));

import { enforceAgentFundingPolicy } from '../../../src/services/agentFundingPolicy';

describe('agentFundingPolicy', () => {
  const now = new Date('2026-04-16T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.sumAgentDraftAmountsSince.mockResolvedValue(0n);
    mocks.utxoRepository.getUnspentBalance.mockResolvedValue(0n);
  });

  it('allows funding when configured policy limits are not exceeded', async () => {
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 50000n, now)).resolves.toBeUndefined();

    expect(mocks.agentRepository.sumAgentDraftAmountsSince).toHaveBeenCalledTimes(2);
    expect(mocks.utxoRepository.getUnspentBalance).toHaveBeenCalledWith('operational-wallet');
  });

  it('rejects inactive agents and destination mismatches', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({ status: 'paused' }));
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 1n, now)).rejects.toThrow(InvalidInputError);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture());
    await expect(enforceAgentFundingPolicy('agent-1', 'other-wallet', 1n, now)).rejects.toThrow('linked operational wallet');
  });

  it('rejects per-request and operational balance cap violations', async () => {
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 150000n, now)).rejects.toThrow('per-request cap');

    mocks.utxoRepository.getUnspentBalance.mockResolvedValueOnce(160000n);
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 50000n, now)).rejects.toThrow('balance cap');
  });

  it('rejects cooldown and period-limit violations', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({
      lastFundingDraftAt: new Date('2026-04-16T11:55:00.000Z'),
      cooldownMinutes: 10,
    }));
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 1n, now)).rejects.toThrow('cooldown');

    mocks.agentRepository.sumAgentDraftAmountsSince.mockResolvedValueOnce(90000n);
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 20000n, now)).rejects.toThrow('daily funding limit');

    mocks.agentRepository.sumAgentDraftAmountsSince
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(490000n);
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 20000n, now)).rejects.toThrow('weekly funding limit');
  });
});

function agentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    status: 'active',
    revokedAt: null,
    operationalWalletId: 'operational-wallet',
    maxFundingAmountSats: 100000n,
    maxOperationalBalanceSats: 200000n,
    dailyFundingLimitSats: 100000n,
    weeklyFundingLimitSats: 500000n,
    cooldownMinutes: 0,
    lastFundingDraftAt: null,
    ...overrides,
  };
}
