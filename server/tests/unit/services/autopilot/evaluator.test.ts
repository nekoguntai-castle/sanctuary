import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WalletAutopilotSettings } from '../../../../src/services/autopilot/types';

const {
  mockGetRedisClient,
  mockIsRedisConnected,
  mockGetLatestFeeSnapshot,
  mockGetUtxoHealthProfile,
  mockGetEnabledAutopilotWallets,
  mockWalletLog,
  mockGetAllChannels,
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
    mockGetAllChannels: vi.fn(),
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
    getAll: mockGetAllChannels,
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
    });
    (mockGetEnabledAutopilotWallets as Mock).mockResolvedValue([]);
    (mockGetAllChannels as Mock).mockReturnValue([]);
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
      const pushNotify = vi.fn().mockResolvedValue(undefined);
      (mockGetAllChannels as Mock).mockReturnValue([
        { id: 'push', notifyConsolidationSuggestion: pushNotify },
      ]);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      redis.exists.mockResolvedValueOnce(1);

      await evaluateAllWallets();

      expect(pushNotify).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('requires stability threshold before notifying', async () => {
      const pushNotify = vi.fn().mockResolvedValue(undefined);
      (mockGetAllChannels as Mock).mockReturnValue([
        { id: 'push', notifyConsolidationSuggestion: pushNotify },
      ]);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(1);

      await evaluateAllWallets();

      expect(pushNotify).not.toHaveBeenCalled();
      expect(redis.expire).toHaveBeenCalledWith('autopilot:stability:wallet-1', 1800);
    });

    it('sends notifications respecting channel preferences and sets cooldown', async () => {
      const telegramNotify = vi.fn().mockResolvedValue(undefined);
      const pushNotify = vi.fn().mockResolvedValue(undefined);

      (mockGetAllChannels as Mock).mockReturnValue([
        { id: 'telegram', notifyConsolidationSuggestion: telegramNotify },
        { id: 'push', notifyConsolidationSuggestion: pushNotify },
      ]);
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
      expect(telegramNotify).not.toHaveBeenCalled();
      expect(pushNotify).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith('autopilot:cooldown:wallet-1', '1', 'EX', 43_200);
      expect(redis.del).toHaveBeenCalledWith('autopilot:stability:wallet-1');
    });

    it('continues when one channel fails to send', async () => {
      const pushNotify = vi.fn().mockRejectedValue(new Error('push send failed'));
      (mockGetAllChannels as Mock).mockReturnValue([
        { id: 'push', notifyConsolidationSuggestion: pushNotify },
      ]);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      redis.exists.mockResolvedValueOnce(0);
      redis.incr.mockResolvedValueOnce(2);

      await expect(evaluateAllWallets()).resolves.toBeUndefined();
      expect(redis.set).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send consolidation notification via push'),
        expect.objectContaining({ walletId: 'wallet-1' })
      );
    });

    it('does not notify when redis is disconnected for stability checks', async () => {
      const pushNotify = vi.fn().mockResolvedValue(undefined);
      (mockGetAllChannels as Mock).mockReturnValue([
        { id: 'push', notifyConsolidationSuggestion: pushNotify },
      ]);
      (mockGetEnabledAutopilotWallets as Mock).mockResolvedValueOnce([
        { walletId: 'wallet-1', walletName: 'Treasury', userId: 'u1', settings: baseSettings },
      ]);
      (mockIsRedisConnected as Mock).mockReturnValueOnce(false);

      await evaluateAllWallets();
      expect(pushNotify).not.toHaveBeenCalled();
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
