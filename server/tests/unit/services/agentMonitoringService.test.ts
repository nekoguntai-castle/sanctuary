import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    findActiveAgentsByOperationalWalletId: vi.fn(),
    findAgentById: vi.fn(),
    countRejectedFundingAttemptsSince: vi.fn(),
    createAlertIfNotDuplicate: vi.fn(),
  },
  addressRepository: {
    findWalletSummariesByAddresses: vi.fn(),
  },
  transactionRepository: {
    findByWalletIdAndTxids: vi.fn(),
  },
  utxoRepository: {
    getUnspentBalance: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  addressRepository: mocks.addressRepository,
  agentRepository: mocks.agentRepository,
  transactionRepository: mocks.transactionRepository,
  utxoRepository: mocks.utxoRepository,
}));

import {
  classifyOperationalSpendDestination,
  evaluateOperationalTransactionAlerts,
  evaluateRejectedFundingAttemptAlert,
} from '../../../src/services/agentMonitoringService';
import {
  buildDestinationMetadata,
  getUnknownDestinationHandlingMode,
} from '../../../src/services/agentMonitoring/destinationClassification';
import type { TransactionNotification } from '../../../src/services/notifications/channels/types';

describe('agentMonitoringService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.agentRepository.createAlertIfNotDuplicate.mockResolvedValue({ id: 'alert-1' });
    mocks.addressRepository.findWalletSummariesByAddresses.mockResolvedValue([]);
    mocks.transactionRepository.findByWalletIdAndTxids.mockImplementation((_walletId: string, txids: string[]) =>
      Promise.resolve(txids.map(txid => ({
        txid,
        type: 'sent',
        counterpartyAddress: 'tb1qexternal',
        outputs: [{ address: 'tb1qexternal', amount: 75_000n, isOurs: false }],
      })))
    );
    mocks.utxoRepository.getUnspentBalance.mockResolvedValue(20_000n);
  });

  it('classifies operational spend destinations from outputs and counterparty metadata', () => {
    const knownWallets = new Map([
      ['tb1qopschange', { walletId: 'operational-wallet', walletName: 'Ops' }],
      ['tb1qknownwallet', { walletId: 'wallet-2', walletName: 'Savings' }],
      ['tb1qnoname', { walletId: 'wallet-3' }],
    ]);

    expect(getUnknownDestinationHandlingMode({
      notifyOnOperationalSpend: false,
      pauseOnUnexpectedSpend: false,
    } as any)).toBe('record_only');
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'empty',
      type: 'sent',
      outputs: [],
      counterpartyAddress: null,
    }).classification).toBe('unknown_destination');
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'malformed',
      type: 'sent',
      outputs: [{ address: ' ', isOurs: false }],
    }).classification).toBe('unknown_destination');
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'external',
      type: 'sent',
      outputs: [
        { address: 'tb1qopschange', isOurs: true },
        { address: 'tb1qexternal', isOurs: false },
      ],
    }, knownWallets).classification).toBe('external_spend');
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'known',
      type: 'sent',
      outputs: [
        { address: 'tb1qopschange', isOurs: true },
        { address: 'tb1qknownwallet', isOurs: false },
      ],
    }, knownWallets)).toEqual(expect.objectContaining({
      classification: 'known_self_transfer',
      knownDestinationWalletId: 'wallet-2',
    }));
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'change',
      type: 'sent',
      outputs: [{ address: 'tb1qopschange', isOurs: false }],
    }, knownWallets).classification).toBe('change_like_movement');
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'counterparty',
      type: 'sent',
      counterpartyAddress: 'tb1qknownwallet',
      outputs: null,
    }, knownWallets).classification).toBe('known_self_transfer');
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'self',
      type: 'self_transfer',
      outputs: [{ address: 'tb1qopschange', isOurs: true }],
    }, knownWallets)).toEqual(expect.objectContaining({
      classification: 'change_like_movement',
      outputCount: 1,
      classificationSource: 'outputs',
    }));
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'consolidation-no-outputs',
      type: 'consolidation',
      outputs: null,
    })).toEqual(expect.objectContaining({
      classification: 'change_like_movement',
      outputCount: 0,
      ownedOutputCount: 0,
      classificationSource: 'counterparty',
    }));
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'current-counterparty',
      type: 'sent',
      counterpartyAddress: 'tb1qopschange',
      outputs: null,
    }, knownWallets)).toEqual(expect.objectContaining({
      classification: 'change_like_movement',
      knownDestinationWalletId: 'operational-wallet',
      knownDestinationWalletName: 'Ops',
    }));
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'current-counterparty-no-name',
      type: 'sent',
      counterpartyAddress: 'tb1qcurrentnoname',
      outputs: null,
    }, new Map([
      ['tb1qcurrentnoname', { walletId: 'operational-wallet' }],
    ])).knownDestinationWalletName).toBeNull();
    expect(classifyOperationalSpendDestination('operational-wallet', {
      txid: 'external-counterparty',
      type: 'sent',
      counterpartyAddress: 'tb1qexternal',
      outputs: null,
    }, knownWallets).classification).toBe('external_spend');
    const noNameKnown = classifyOperationalSpendDestination('operational-wallet', {
      txid: 'known-no-name',
      type: 'sent',
      counterpartyAddress: 'tb1qnoname',
      outputs: null,
    }, knownWallets);
    expect(noNameKnown.knownDestinationWalletName).toBeNull();
    expect(buildDestinationMetadata(noNameKnown, 'record_only', {
      shouldNotify: false,
      shouldPause: false,
    })).toEqual(expect.objectContaining({
      destinationAddress: 'tb1qnoname',
      knownDestinationWalletId: 'wallet-3',
      unknownDestinationHandlingMode: 'record_only',
    }));
    expect(buildDestinationMetadata(
      classifyOperationalSpendDestination('operational-wallet', {
        txid: 'known-with-name',
        type: 'sent',
        counterpartyAddress: 'tb1qknownwallet',
        outputs: null,
      }, knownWallets),
      'notify_only',
      { shouldNotify: true, shouldPause: false }
    )).toEqual(expect.objectContaining({
      knownDestinationWalletName: 'Savings',
      shouldNotify: true,
    }));
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
        metadata: expect.objectContaining({
          destinationClassification: 'external_spend',
          thresholdSats: '50000',
        }),
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

  it('evaluates notify-only, pause-only, and notify-plus-pause modes for unknown destinations', async () => {
    const txid = 'g'.repeat(64);
    mocks.transactionRepository.findByWalletIdAndTxids.mockResolvedValueOnce([{
      txid,
      type: 'sent',
      counterpartyAddress: null,
      outputs: [],
    }]);

    const evaluations = await evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid,
      type: 'sent',
      amount: -12_000n,
      feeSats: 450n,
    }], [
      agentFixture({
        id: 'agent-notify',
        notifyOnOperationalSpend: true,
        pauseOnUnexpectedSpend: false,
      }),
      agentFixture({
        id: 'agent-pause',
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: true,
      }),
      agentFixture({
        id: 'agent-both',
        notifyOnOperationalSpend: true,
        pauseOnUnexpectedSpend: true,
      }),
    ] as any);

    expect(evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: 'agent-notify',
        destinationClassification: 'unknown_destination',
        unknownDestinationHandlingMode: 'notify_only',
        shouldNotify: true,
        shouldPause: false,
      }),
      expect.objectContaining({
        agentId: 'agent-pause',
        destinationClassification: 'unknown_destination',
        unknownDestinationHandlingMode: 'pause_agent',
        shouldNotify: false,
        shouldPause: true,
      }),
      expect.objectContaining({
        agentId: 'agent-both',
        destinationClassification: 'unknown_destination',
        unknownDestinationHandlingMode: 'notify_and_pause',
        shouldNotify: true,
        shouldPause: true,
      }),
    ]));

    const unknownAlertWrites = mocks.agentRepository.createAlertIfNotDuplicate.mock.calls
      .map(([alert]) => alert)
      .filter(alert => alert.type === 'operational_destination_unknown');

    expect(unknownAlertWrites).toHaveLength(3);
    expect(unknownAlertWrites).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: 'agent-pause',
        severity: 'critical',
        reasonCode: 'unknown_destination',
        metadata: expect.objectContaining({
          destinationClassification: 'unknown_destination',
          unknownDestinationHandlingMode: 'pause_agent',
          shouldNotify: false,
          shouldPauseAgent: true,
        }),
      }),
    ]));
  });

  it('records unknown destinations without notification or pause when both policies are disabled', async () => {
    const txid = 'h'.repeat(64);
    mocks.transactionRepository.findByWalletIdAndTxids.mockResolvedValueOnce([]);

    const evaluations = await evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid,
      type: 'sent',
      amount: -12_000n,
      feeSats: 450n,
    }], [
      agentFixture({
        id: 'agent-record',
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: false,
      }),
    ] as any);

    expect(evaluations).toEqual([
      expect.objectContaining({
        agentId: 'agent-record',
        destinationClassification: 'unknown_destination',
        unknownDestinationHandlingMode: 'record_only',
        shouldNotify: false,
        shouldPause: false,
      }),
    ]);
    expect(mocks.addressRepository.findWalletSummariesByAddresses).toHaveBeenCalledWith([]);
  });

  it('uses known address ownership rows when evaluating operational transactions', async () => {
    const txid = 'i'.repeat(64);
    mocks.transactionRepository.findByWalletIdAndTxids.mockResolvedValueOnce([{
      txid,
      type: 'sent',
      counterpartyAddress: 'tb1qknownwallet',
      outputs: [{ address: 'tb1qknownwallet', amount: 12_000n, isOurs: false }],
    }]);
    mocks.addressRepository.findWalletSummariesByAddresses.mockResolvedValueOnce([{
      address: 'tb1qknownwallet',
      wallet: { id: 'wallet-2', name: 'Savings' },
    }]);

    const evaluations = await evaluateOperationalTransactionAlerts('operational-wallet', [{
      txid,
      type: 'sent',
      amount: -12_000n,
    }], [
      agentFixture({
        notifyOnOperationalSpend: true,
      }),
    ] as any);

    expect(mocks.addressRepository.findWalletSummariesByAddresses).toHaveBeenCalledWith(['tb1qknownwallet']);
    expect(evaluations).toEqual([
      expect.objectContaining({
        destinationClassification: 'known_self_transfer',
        metadata: expect.objectContaining({
          knownDestinationWalletId: 'wallet-2',
          knownDestinationWalletName: 'Savings',
        }),
      }),
    ]);
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
    }])).resolves.toEqual([]);

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
