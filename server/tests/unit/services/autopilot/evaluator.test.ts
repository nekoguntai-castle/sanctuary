import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WalletAutopilotSettings } from '../../../../src/services/autopilot/types';

const {
  mockGetRedisClient,
  mockIsRedisConnected,
  mockGetLatestFeeSnapshot,
  mockGetUtxoHealthProfile,
  mockGetEnabledAutopilotWallets,
  mockWalletLog,
  mockQueueConsolidationSuggestionNotification,
  mockNotifyConsolidationSuggestion,
  mockLogger,
  redis,
} = vi.hoisted(() => {
  const redis = {
    exists: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };

  return {
    mockGetRedisClient: vi.fn(() => redis),
    mockIsRedisConnected: vi.fn(() => true),
    mockGetLatestFeeSnapshot: vi.fn(),
    mockGetUtxoHealthProfile: vi.fn(),
    mockGetEnabledAutopilotWallets: vi.fn(),
    mockWalletLog: vi.fn(),
    mockQueueConsolidationSuggestionNotification: vi.fn(),
    mockNotifyConsolidationSuggestion: vi.fn(),
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    redis,
  };
});

vi.mock('../../../../src/infrastructure', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
  queueConsolidationSuggestionNotification: mockQueueConsolidationSuggestionNotification,
}));

vi.mock('../../../../src/services/autopilot/feeMonitor', () => ({
  getLatestFeeSnapshot: mockGetLatestFeeSnapshot,
}));

vi.mock('../../../../src/services/autopilot/utxoHealth', () => ({
  getUtxoHealthProfile: mockGetUtxoHealthProfile,
}));

vi.mock('../../../../src/services/autopilot/settings', () => ({
  getEnabledAutopilotWallets: mockGetEnabledAutopilotWallets,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: mockWalletLog,
}));

vi.mock('../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: {
    notifyConsolidationSuggestion: mockNotifyConsolidationSuggestion,
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  evaluateAllWallets,
  evaluateWallet,
} from '../../../../src/services/autopilot/evaluator';

const baseSettings: WalletAutopilotSettings = {
  enabled: true,
  maxFeeRate: 10,
  minUtxoCount: 10,
  dustThreshold: 10_000,
  cooldownHours: 24,
  notifyTelegram: true,
  notifyPush: true,
  minDustCount: 0,
  maxUtxoSize: 0,
};

describe('autopilot evaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.exists.mockResolvedValue(0);
    redis.incr.mockResolvedValue(2);
    redis.expire.mockResolvedValue(1);
    redis.set.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);

    (mockIsRedisConnected as Mock).mockReturnValue(true);
    (mockGetRedisClient as Mock).mockReturnValue(redis);

    (mockGetLatestFeeSnapshot as Mock).mockResolvedValue({
      timestamp: 1,
      fastest: 20,
      halfHour: 15,
      hour: 10,
      economy: 5,
      minimum: 2,
    });
    (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
      totalUtxos: 20,
      dustCount: 2,
      dustValue: 5000n,
      totalValue: 200_000n,
      avgUtxoSize: 10_000n,
      smallestUtxo: 500n,
      largestUtxo: 50_000n,
      consolidationCandidates: 20,
    });
    (mockGetEnabledAutopilotWallets as Mock).mockResolvedValue([]);
    (mockQueueConsolidationSuggestionNotification as Mock).mockResolvedValue(true);
    (mockNotifyConsolidationSuggestion as Mock).mockResolvedValue([]);
  });

  describe('evaluateWallet', () => {
    it('returns null when fee snapshot is unavailable', async () => {
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValueOnce(null);

      await expect(evaluateWallet('w1', 'Treasury', baseSettings)).resolves.toBeNull();
    });

    it('returns null when current fee is above configured maximum', async () => {
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValueOnce({
        timestamp: 1,
        fastest: 30,
        halfHour: 25,
        hour: 20,
        economy: 12,
        minimum: 6,
      });

      await expect(evaluateWallet('w1', 'Treasury', baseSettings)).resolves.toBeNull();
    });

    it('returns null when UTXO count is below threshold', async () => {
      (mockGetUtxoHealthProfile as Mock).mockResolvedValueOnce({
        totalUtxos: 3,
        dustCount: 0,
        dustValue: 0n,
        totalValue: 30_000n,
        avgUtxoSize: 10_000n,
        smallestUtxo: 10_000n,
        largestUtxo: 10_000n,
        consolidationCandidates: 3,
      });

      await expect(evaluateWallet('w1', 'Treasury', baseSettings)).resolves.toBeNull();
    });

    it('builds a suggestion with reason and sats savings estimate', async () => {
      const suggestion = await evaluateWallet('w1', 'Treasury', baseSettings);

      expect(suggestion).toEqual(
        expect.objectContaining({
          walletId: 'w1',
          walletName: 'Treasury',
          feeRate: 5,
          estimatedSavings: '~20,400 sats in potential fee savings',
        })
      );
      expect(suggestion?.reason).toContain('Fees are low (5 sat/vB, threshold: 10).');
      expect(suggestion?.reason).toContain('2 dust UTXOs found');
      expect(suggestion?.reason).toContain('20 total UTXOs could be consolidated');
    });

    it('returns null when dust count is below minDustCount', async () => {
      (mockGetUtxoHealthProfile as Mock).mockResolvedValueOnce({
        totalUtxos: 20,
        dustCount: 2,
        dustValue: 5000n,
        totalValue: 200_000n,
        avgUtxoSize: 10_000n,
        smallestUtxo: 500n,
        largestUtxo: 50_000n,
        consolidationCandidates: 20,
      });

      const result = await evaluateWallet('w1', 'Treasury', {
        ...baseSettings,
        minDustCount: 5,
      });

      expect(result).toBeNull();
    });

    it('passes when dust count meets minDustCount', async () => {
      (mockGetUtxoHealthProfile as Mock).mockResolvedValueOnce({
        totalUtxos: 20,
        dustCount: 5,
        dustValue: 15000n,
        totalValue: 200_000n,
        avgUtxoSize: 10_000n,
        smallestUtxo: 500n,
        largestUtxo: 50_000n,
        consolidationCandidates: 20,
      });

      const result = await evaluateWallet('w1', 'Treasury', {
        ...baseSettings,
        minDustCount: 5,
      });

      expect(result).not.toBeNull();
    });

    it('uses consolidationCandidates not totalUtxos for threshold check', async () => {
      (mockGetUtxoHealthProfile as Mock).mockResolvedValueOnce({
        totalUtxos: 20,
        dustCount: 2,
        dustValue: 5000n,
        totalValue: 200_000n,
        avgUtxoSize: 10_000n,
        smallestUtxo: 500n,
        largestUtxo: 50_000n,
        consolidationCandidates: 5, // below minUtxoCount of 10
      });

      const result = await evaluateWallet('w1', 'Treasury', baseSettings);

      expect(result).toBeNull();
    });

    it('passes maxUtxoSize to health profile', async () => {
      await evaluateWallet('w1', 'Treasury', {
        ...baseSettings,
        maxUtxoSize: 50_000,
      });

      expect(mockGetUtxoHealthProfile).toHaveBeenCalledWith('w1', 10_000, 50_000);
    });

    it('mentions size filter in reason when maxUtxoSize is set', async () => {
      (mockGetUtxoHealthProfile as Mock).mockResolvedValueOnce({
        totalUtxos: 20,
        dustCount: 2,
        dustValue: 5000n,
        totalValue: 200_000n,
        avgUtxoSize: 10_000n,
        smallestUtxo: 500n,
        largestUtxo: 50_000n,
        consolidationCandidates: 15,
      });

      const suggestion = await evaluateWallet('w1', 'Treasury', {
        ...baseSettings,
        maxUtxoSize: 25_000,
      });

      expect(suggestion?.reason).toContain('15 UTXOs under 25,000 sats could be consolidated');
      expect(suggestion?.reason).not.toContain('total UTXOs');
    });

    it('uses minimal savings label when current fee is not favorable', async () => {
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValueOnce({
        timestamp: 2,
        fastest: 40,
        halfHour: 35,
        hour: 30,
        economy: 25,
        minimum: 20,
      });

      const suggestion = await evaluateWallet('w1', 'Treasury', {
        ...baseSettings,
        maxFeeRate: 30,
      });
      expect(suggestion?.estimatedSavings).toBe('minimal savings');
    });
  });

  describe('evaluateAllWallets', () => {
    it('exits early when no wallets have autopilot enabled', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([]);

      await expect(evaluateAllWallets()).resolves.toBeUndefined();
      expect(mockGetEnabledAutopilotWallets).toHaveBeenCalledTimes(1);
    });

    it('resets stability when no suggestion is generated', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValueOnce(null);

      await evaluateAllWallets();

      expect(redis.del).toHaveBeenCalledWith('autopilot:stability:wallet-1');
    });

    it('suppresses notifications during cooldown', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      redis.exists.mockResolvedValueOnce(1);

      await evaluateAllWallets();

      expect(mockQueueConsolidationSuggestionNotification).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('requires stability threshold before notifying', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(1);

      await evaluateAllWallets();

      expect(mockQueueConsolidationSuggestionNotification).not.toHaveBeenCalled();
      expect(redis.expire).toHaveBeenCalledWith('autopilot:stability:wallet-1', 1800);
    });

    it('queues notifications respecting channel preferences and sets cooldown', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          userId: 'u1',
          settings: {
            ...baseSettings,
            notifyTelegram: false,
            notifyPush: true,
            cooldownHours: 12,
          },
        },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await evaluateAllWallets();

      expect(mockWalletLog).toHaveBeenCalledWith(
        'wallet-1',
        'info',
        'AUTOPILOT',
        expect.stringContaining('Fees are low'),
        expect.objectContaining({ feeRate: 5, totalUtxos: 20, dustCount: 2 })
      );
      expect(mockQueueConsolidationSuggestionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          walletName: 'Treasury',
          notifyTelegram: false,
          notifyPush: true,
          utxoHealth: expect.objectContaining({
            dustValue: '5000',
            totalValue: '200000',
          }),
        })
      );
      expect(mockNotifyConsolidationSuggestion).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith('autopilot:cooldown:wallet-1', '1', 'EX', 43_200);
      expect(redis.del).toHaveBeenCalledWith('autopilot:stability:wallet-1');
    });

    it('falls back to inline delivery when queueing fails and logs channel errors', async () => {
      (mockQueueConsolidationSuggestionNotification as Mock).mockResolvedValueOnce(false);
      (mockNotifyConsolidationSuggestion as Mock).mockResolvedValueOnce([
        { success: false, channelId: 'telegram', usersNotified: 0, errors: ['telegram send failed'] },
      ]);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await expect(evaluateAllWallets()).resolves.toBeUndefined();
      expect(mockNotifyConsolidationSuggestion).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({ walletId: 'wallet-1', walletName: 'Treasury' }),
        ['telegram', 'push']
      );
      expect(redis.set).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send consolidation notification via telegram'),
        expect.objectContaining({ walletId: 'wallet-1', errors: ['telegram send failed'] })
      );
    });

    it('falls back inline without logging channel errors when delivery succeeds', async () => {
      (mockQueueConsolidationSuggestionNotification as Mock).mockResolvedValueOnce(false);
      (mockNotifyConsolidationSuggestion as Mock).mockResolvedValueOnce([
        { success: true, channelId: 'telegram', usersNotified: 1 },
      ]);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await evaluateAllWallets();

      expect(mockNotifyConsolidationSuggestion).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed to send consolidation notification via telegram'),
        expect.anything()
      );
    });

    it('does not notify when redis is disconnected for stability checks', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      (mockIsRedisConnected as Mock).mockReturnValueOnce(false);

      await evaluateAllWallets();
      expect(mockQueueConsolidationSuggestionNotification).not.toHaveBeenCalled();
    });

    it('catches per-wallet errors and continues to next wallet', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-bad', walletName: 'Bad', userId: 'u1', settings: baseSettings },
        { walletId: 'wallet-ok', walletName: 'Ok', userId: 'u2', settings: baseSettings },
      ]);
      // First wallet's health profile rejects, second succeeds
      (mockGetUtxoHealthProfile as Mock)
        .mockRejectedValueOnce(new Error('UTXO query failed'))
        .mockResolvedValueOnce({
          totalUtxos: 20,
          dustCount: 2,
          dustValue: 5000n,
          totalValue: 200_000n,
          avgUtxoSize: 10_000n,
          smallestUtxo: 500n,
          largestUtxo: 50_000n,
          consolidationCandidates: 20,
        });

      await expect(evaluateAllWallets()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error evaluating wallet',
        expect.objectContaining({ walletId: 'wallet-bad', error: 'UTXO query failed' })
      );
      // Second wallet should still be evaluated (stability reset called)
      expect(redis.del).toHaveBeenCalled();
    });

    it('formats large savings in BTC when >= 100,000 sats', async () => {
      // totalUtxos=100, currentFeeRate=5 → savings = 100*68*(20-5) = 102,000 sats >= 100,000
      (mockGetUtxoHealthProfile as Mock).mockResolvedValueOnce({
        totalUtxos: 100,
        dustCount: 10,
        dustValue: 50_000n,
        totalValue: 5_000_000n,
        avgUtxoSize: 50_000n,
        smallestUtxo: 500n,
        largestUtxo: 100_000n,
        consolidationCandidates: 100,
      });

      const suggestion = await evaluateWallet('w1', 'Treasury', baseSettings);

      expect(suggestion).not.toBeNull();
      expect(suggestion!.estimatedSavings).toMatch(/~[\d.]+ BTC in potential fee savings/);
    });

    it('preserves channel preferences when notifyPush is false', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          userId: 'u1',
          settings: {
            ...baseSettings,
            notifyPush: false,
            notifyTelegram: true,
          },
        },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await evaluateAllWallets();

      expect(mockQueueConsolidationSuggestionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          notifyPush: false,
          notifyTelegram: true,
        })
      );
    });

    it('falls back inline with only enabled channels when queueing fails', async () => {
      (mockQueueConsolidationSuggestionNotification as Mock).mockResolvedValueOnce(false);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          userId: 'u1',
          settings: baseSettings,
        },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await evaluateAllWallets();

      expect(mockNotifyConsolidationSuggestion).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({ walletId: 'wallet-1' }),
        ['telegram', 'push']
      );
    });

    it('does not fall back inline when queueing fails and no channels are enabled', async () => {
      (mockQueueConsolidationSuggestionNotification as Mock).mockResolvedValueOnce(false);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          userId: 'u1',
          settings: {
            ...baseSettings,
            notifyTelegram: false,
            notifyPush: false,
          },
        },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await evaluateAllWallets();

      expect(mockNotifyConsolidationSuggestion).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith('autopilot:cooldown:wallet-1', '1', 'EX', 86_400);
    });

    it('falls back inline with only telegram when push notifications are disabled', async () => {
      (mockQueueConsolidationSuggestionNotification as Mock).mockResolvedValueOnce(false);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          userId: 'u1',
          settings: {
            ...baseSettings,
            notifyTelegram: true,
            notifyPush: false,
          },
        },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await evaluateAllWallets();

      expect(mockNotifyConsolidationSuggestion).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({ walletId: 'wallet-1' }),
        ['telegram']
      );
    });

    it('falls back inline with only push when telegram notifications are disabled', async () => {
      (mockQueueConsolidationSuggestionNotification as Mock).mockResolvedValueOnce(false);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          userId: 'u1',
          settings: {
            ...baseSettings,
            notifyTelegram: false,
            notifyPush: true,
          },
        },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await evaluateAllWallets();

      expect(mockNotifyConsolidationSuggestion).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({ walletId: 'wallet-1' }),
        ['push']
      );
    });

    it('omits dust mention in reason when dustCount is zero', async () => {
      (mockGetUtxoHealthProfile as Mock).mockResolvedValueOnce({
        totalUtxos: 20,
        dustCount: 0,
        dustValue: 0n,
        totalValue: 200_000n,
        avgUtxoSize: 10_000n,
        smallestUtxo: 2_000n,
        largestUtxo: 50_000n,
        consolidationCandidates: 20,
      });

      const suggestion = await evaluateWallet('w1', 'Treasury', baseSettings);

      expect(suggestion).not.toBeNull();
      expect(suggestion!.reason).toContain('Fees are low');
      expect(suggestion!.reason).toContain('20 total UTXOs could be consolidated');
      expect(suggestion!.reason).not.toContain('dust UTXOs found');
    });

    it('swallows top-level evaluator errors', async () => {
      (mockGetEnabledAutopilotWallets as Mock).mockRejectedValueOnce(new Error('db unavailable'));

      await expect(evaluateAllWallets()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in evaluateAllWallets',
        expect.objectContaining({ error: 'db unavailable' })
      );
    });
  });
});
