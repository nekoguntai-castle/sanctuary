import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    findActiveAgentsByOperationalWalletId: vi.fn(),
    findAgentById: vi.fn(),
    countRejectedFundingAttemptsSince: vi.fn(),
    createAlertIfNotDuplicate: vi.fn(),
  },
  utxoRepository: {
    getUnspentBalance: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: mocks.agentRepository,
  utxoRepository: mocks.utxoRepository,
}));

import {
  evaluateOperationalTransactionAlerts,
  evaluateRejectedFundingAttemptAlert,
} from '../../../src/services/agentMonitoringService';
import type { TransactionNotification } from '../../../src/services/notifications/channels/types';

describe('agentMonitoringService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.agentRepository.createAlertIfNotDuplicate.mockResolvedValue({ id: 'alert-1' });
    mocks.utxoRepository.getUnspentBalance.mockResolvedValue(20_000n);
  });

  it('creates operational spend, fee, and balance alerts with dedupe keys', async () => {
    const transactions: TransactionNotification[] = [{
      txid: 'a'.repeat(64),
      type: 'sent',
      amount: -75_000n,
      feeSats: 4_000n,
    }];

    await evaluateOperationalTransactionAlerts('operational-wallet', transactions, [
      agentFixture({
        largeOperationalSpendSats: 50_000n,
        largeOperationalFeeSats: 3_000n,
        minOperationalBalanceSats: 25_000n,
      }),
      agentFixture({
        id: 'agent-2',
        name: 'High Balance Agent',
        maxOperationalBalanceSats: 15_000n,
      }),
    ] as any);

    expect(mocks.utxoRepository.getUnspentBalance).toHaveBeenCalledWith('operational-wallet');
    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        walletId: 'operational-wallet',
        type: 'large_operational_spend',
        severity: 'critical',
        txid: 'a'.repeat(64),
        amountSats: 75_000n,
        thresholdSats: 50_000n,
        dedupeKey: `agent:agent-1:large_spend:${'a'.repeat(64)}`,
      }),
      new Date(0)
    );
    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      type: 'large_operational_fee',
      feeSats: 4_000n,
      thresholdSats: 3_000n,
    }), new Date(0));
    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      type: 'operational_balance_low',
      amountSats: 20_000n,
      thresholdSats: 25_000n,
    }), expect.any(Date));
    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-2',
      type: 'operational_balance_high',
      amountSats: 20_000n,
      thresholdSats: 15_000n,
    }), expect.any(Date));
  });

  it('uses the default operational alert dedupe window when none is configured', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'));

    await evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid: 'b'.repeat(64),
      type: 'sent',
      amount: -1_000n,
    }], [
      agentFixture({ minOperationalBalanceSats: 25_000n }),
    ] as any);

    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operational_balance_low',
    }), new Date('2026-04-16T11:00:00.000Z'));
  });

  it('returns early when there are no sent transactions or no active agents', async () => {
    await evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid: 'd'.repeat(64),
      type: 'received',
      amount: 1_000n,
    }]);
    expect(mocks.agentRepository.findActiveAgentsByOperationalWalletId).not.toHaveBeenCalled();

    mocks.agentRepository.findActiveAgentsByOperationalWalletId.mockResolvedValueOnce([]);
    await evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid: 'e'.repeat(64),
      type: 'sent',
      amount: 1_000n,
    }]);

    expect(mocks.agentRepository.findActiveAgentsByOperationalWalletId).toHaveBeenCalledWith('operational-wallet');
    expect(mocks.utxoRepository.getUnspentBalance).not.toHaveBeenCalled();
  });

  it('treats positive sent amounts as outgoing spend amounts', async () => {
    await evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid: 'f'.repeat(64),
      type: 'sent',
      amount: 75_000n,
      feeSats: null,
    }], [
      agentFixture({ largeOperationalSpendSats: 50_000n }),
    ] as any);

    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'large_operational_spend',
      amountSats: 75_000n,
    }), new Date(0));
  });

  it('creates a repeated rejected funding attempt alert when the threshold is reached', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'));
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture({
      repeatedFailureThreshold: 3,
      repeatedFailureLookbackMinutes: 15,
    }));
    mocks.agentRepository.countRejectedFundingAttemptsSince.mockResolvedValue(3);

    await evaluateRejectedFundingAttemptAlert('agent-1', 'policy_daily_limit');

    expect(mocks.agentRepository.countRejectedFundingAttemptsSince).toHaveBeenCalledWith(
      'agent-1',
      new Date('2026-04-16T11:45:00.000Z')
    );
    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      walletId: 'funding-wallet',
      type: 'repeated_funding_failures',
      severity: 'warning',
      observedCount: 3,
      reasonCode: 'policy_daily_limit',
      dedupeKey: 'agent:agent-1:repeated_failures:15:3',
    }), new Date('2026-04-16T11:00:00.000Z'));
  });

  it('uses default failure lookback and null reason metadata when omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'));
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture({
      repeatedFailureThreshold: 2,
      repeatedFailureLookbackMinutes: null,
    }));
    mocks.agentRepository.countRejectedFundingAttemptsSince.mockResolvedValue(2);

    await evaluateRejectedFundingAttemptAlert('agent-1');

    expect(mocks.agentRepository.countRejectedFundingAttemptsSince).toHaveBeenCalledWith(
      'agent-1',
      new Date('2026-04-16T11:00:00.000Z')
    );
    expect(mocks.agentRepository.createAlertIfNotDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: null,
      dedupeKey: 'agent:agent-1:repeated_failures:60:2',
    }), new Date('2026-04-16T11:00:00.000Z'));
  });

  it('does not alert rejected attempts before a threshold is configured or reached', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture());
    await evaluateRejectedFundingAttemptAlert('agent-1');
    expect(mocks.agentRepository.countRejectedFundingAttemptsSince).not.toHaveBeenCalled();

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({
      repeatedFailureThreshold: 3,
    }));
    mocks.agentRepository.countRejectedFundingAttemptsSince.mockResolvedValueOnce(2);

    await evaluateRejectedFundingAttemptAlert('agent-1');

    expect(mocks.agentRepository.createAlertIfNotDuplicate).not.toHaveBeenCalled();
  });

  it('does not alert rejected attempts for missing or revoked agents', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await evaluateRejectedFundingAttemptAlert('agent-1');
    expect(mocks.agentRepository.countRejectedFundingAttemptsSince).not.toHaveBeenCalled();

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({
      status: 'revoked',
      revokedAt: new Date('2026-04-16T00:00:00.000Z'),
      repeatedFailureThreshold: 1,
    }));

    await evaluateRejectedFundingAttemptAlert('agent-1');

    expect(mocks.agentRepository.countRejectedFundingAttemptsSince).not.toHaveBeenCalled();
    expect(mocks.agentRepository.createAlertIfNotDuplicate).not.toHaveBeenCalled();
  });

  it('logs and swallows monitoring repository errors', async () => {
    mocks.agentRepository.findActiveAgentsByOperationalWalletId.mockRejectedValueOnce(new Error('agent lookup failed'));
    await expect(evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid: 'c'.repeat(64),
      type: 'sent',
      amount: -1_000n,
    }])).resolves.toBeUndefined();

    mocks.agentRepository.findAgentById.mockRejectedValueOnce(new Error('agent lookup failed'));
    await expect(evaluateRejectedFundingAttemptAlert('agent-1')).resolves.toBeUndefined();
  });
});

function agentFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-16T00:00:00.000Z');
  return {
    id: 'agent-1',
    userId: 'user-1',
    name: 'Treasury Agent',
    status: 'active',
    fundingWalletId: 'funding-wallet',
    operationalWalletId: 'operational-wallet',
    signerDeviceId: 'device-1',
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
    lastFundingDraftAt: null,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
    ...overrides,
  };
}
