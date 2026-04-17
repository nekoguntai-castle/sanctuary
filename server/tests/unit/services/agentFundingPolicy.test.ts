import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidInputError, NotFoundError } from '../../../src/errors';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    findAgentById: vi.fn(),
    sumAgentDraftAmountsSince: vi.fn(),
    findUsableFundingOverride: vi.fn(),
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
    mocks.agentRepository.findUsableFundingOverride.mockResolvedValue(null);
    mocks.utxoRepository.getUnspentBalance.mockResolvedValue(0n);
  });

  it('allows funding when configured policy limits are not exceeded', async () => {
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 50000n, now)).resolves.toEqual({
      overrideId: null,
    });

    expect(mocks.agentRepository.sumAgentDraftAmountsSince).toHaveBeenCalledTimes(2);
    expect(mocks.utxoRepository.getUnspentBalance).toHaveBeenCalledWith('operational-wallet');
  });

  it('allows funding when optional caps are unset and a completed cooldown has elapsed', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({
      maxFundingAmountSats: null,
      maxOperationalBalanceSats: null,
      dailyFundingLimitSats: null,
      weeklyFundingLimitSats: null,
      cooldownMinutes: 10,
      lastFundingDraftAt: new Date('2026-04-16T11:00:00.000Z'),
    }));

    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 50000n, now)).resolves.toEqual({
      overrideId: null,
    });

    expect(mocks.utxoRepository.getUnspentBalance).not.toHaveBeenCalled();
    expect(mocks.agentRepository.sumAgentDraftAmountsSince).not.toHaveBeenCalled();
    expect(mocks.agentRepository.findUsableFundingOverride).not.toHaveBeenCalled();
  });

  it('rejects inactive agents and destination mismatches', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 1n, now)).rejects.toThrow(NotFoundError);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({ revokedAt: new Date('2026-04-16T00:00:00.000Z') }));
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 1n, now)).rejects.toThrow(InvalidInputError);

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

  it('calculates weekly funding windows from the previous Monday when now is Sunday', async () => {
    const sunday = new Date('2026-04-19T12:00:00.000Z');
    mocks.agentRepository.sumAgentDraftAmountsSince
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(490000n);

    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 20000n, sunday))
      .rejects.toThrow('weekly funding limit');

    expect(mocks.agentRepository.sumAgentDraftAmountsSince).toHaveBeenNthCalledWith(
      2,
      'agent-1',
      new Date('2026-04-13T00:00:00.000Z')
    );
  });

  it('allows cap violations when a valid owner override exists', async () => {
    mocks.agentRepository.findUsableFundingOverride.mockResolvedValueOnce({
      id: 'override-1',
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
      maxAmountSats: 150000n,
      expiresAt: new Date('2026-04-16T13:00:00.000Z'),
      status: 'active',
    });

    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 150000n, now)).resolves.toEqual({
      overrideId: 'override-1',
    });

    expect(mocks.agentRepository.findUsableFundingOverride).toHaveBeenCalledWith({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
      amount: 150000n,
      now,
    });
  });

  it('rejects cap violations when no usable owner override covers the request', async () => {
    mocks.agentRepository.findUsableFundingOverride.mockResolvedValueOnce(null);

    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 150000n, now))
      .rejects.toThrow('per-request cap');

    expect(mocks.agentRepository.findUsableFundingOverride).toHaveBeenCalledWith({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
      amount: 150000n,
      now,
    });
  });

  it('preserves the first cap violation message when several caps fail', async () => {
    mocks.utxoRepository.getUnspentBalance.mockResolvedValueOnce(190000n);
    mocks.agentRepository.sumAgentDraftAmountsSince
      .mockResolvedValueOnce(90000n)
      .mockResolvedValueOnce(490000n);

    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 150000n, now))
      .rejects.toThrow('per-request cap');
  });

  it('does not use overrides for inactive agents, wrong destinations, or cooldowns', async () => {
    mocks.agentRepository.findUsableFundingOverride.mockResolvedValue({
      id: 'override-1',
    });

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({ status: 'paused' }));
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 150000n, now)).rejects.toThrow(InvalidInputError);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture());
    await expect(enforceAgentFundingPolicy('agent-1', 'other-wallet', 150000n, now)).rejects.toThrow('linked operational wallet');

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({
      lastFundingDraftAt: new Date('2026-04-16T11:55:00.000Z'),
      cooldownMinutes: 10,
    }));
    await expect(enforceAgentFundingPolicy('agent-1', 'operational-wallet', 150000n, now)).rejects.toThrow('cooldown');
    expect(mocks.agentRepository.findUsableFundingOverride).not.toHaveBeenCalled();
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
