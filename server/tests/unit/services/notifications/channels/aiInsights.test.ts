/**
 * AI Insights Notification Channel Tests
 *
 * Tests for the aiInsightsChannelHandler which sends
 * Treasury Intelligence insights via Telegram.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock errors utility
vi.mock('../../../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

// Mock walletSharingRepository
const { mockFindWalletUsersWithPreferences } = vi.hoisted(() => ({
  mockFindWalletUsersWithPreferences: vi.fn(),
}));
vi.mock('../../../../../src/repositories', () => ({
  walletSharingRepository: {
    findWalletUsersWithPreferences: mockFindWalletUsersWithPreferences,
  },
}));

// Mock Telegram API
vi.mock('../../../../../src/services/telegram/api', () => ({
  sendTelegramMessage: vi.fn(),
}));

import { aiInsightsChannelHandler } from '../../../../../src/services/notifications/channels/aiInsights';
import * as telegramApi from '../../../../../src/services/telegram/api';
import type { AIInsightNotification } from '../../../../../src/services/notifications/channels/types';

const mockFindMany = mockFindWalletUsersWithPreferences;
const mockSendTelegram = vi.mocked(telegramApi.sendTelegramMessage);

function makeInsight(overrides?: Partial<AIInsightNotification>): AIInsightNotification {
  return {
    id: 'insight-1',
    type: 'utxo_health',
    severity: 'warning',
    title: 'UTXO fragmentation detected',
    summary: 'Your wallet has 42 dust UTXOs that could be consolidated.',
    walletName: 'Main Vault',
    ...overrides,
  };
}

function makeWalletUser(overrides?: {
  userId?: string;
  intelligence?: Record<string, any>;
  telegram?: Record<string, any> | null;
}) {
  const userId = overrides?.userId ?? 'user-1';
  const intelligence = overrides?.intelligence ?? {
    wallets: {
      'wallet-1': {
        enabled: true,
        notifyTelegram: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health', 'fee_timing', 'anomaly', 'tax', 'consolidation'],
      },
    },
  };

  // Use null sentinel to explicitly omit telegram; undefined falls through to default
  const hasTelegramOverride = overrides !== undefined && 'telegram' in (overrides as object);
  const telegram = hasTelegramOverride
    ? overrides!.telegram
    : { enabled: true, botToken: 'bot-token-123', chatId: '999888777' };

  const preferences: Record<string, any> = { intelligence };
  if (telegram !== undefined && telegram !== null) {
    preferences.telegram = telegram;
  }

  return {
    user: {
      id: userId,
      preferences,
    },
  };
}

describe('aiInsightsChannelHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('metadata and capabilities', () => {
    it('has correct id and name', () => {
      expect(aiInsightsChannelHandler.id).toBe('ai-insights');
      expect(aiInsightsChannelHandler.name).toBe('AI Insights');
    });

    it('supports AI insights and rich formatting', () => {
      expect(aiInsightsChannelHandler.capabilities.supportsAIInsights).toBe(true);
      expect(aiInsightsChannelHandler.capabilities.supportsRichFormatting).toBe(true);
    });

    it('does not support transactions, drafts, consolidation suggestions, or images', () => {
      expect(aiInsightsChannelHandler.capabilities.supportsTransactions).toBe(false);
      expect(aiInsightsChannelHandler.capabilities.supportsDrafts).toBe(false);
      expect(aiInsightsChannelHandler.capabilities.supportsConsolidationSuggestions).toBe(false);
      expect(aiInsightsChannelHandler.capabilities.supportsImages).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('always returns true', async () => {
      expect(await aiInsightsChannelHandler.isEnabled()).toBe(true);
    });
  });

  describe('notifyTransactions', () => {
    it('is a no-op that returns 0 users notified', async () => {
      const result = await aiInsightsChannelHandler.notifyTransactions('wallet-1', []);
      expect(result).toEqual({
        success: true,
        channelId: 'ai-insights',
        usersNotified: 0,
      });
    });
  });

  describe('notifyAIInsight', () => {
    it('sends Telegram message to users with intelligence enabled', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser()] as any);
      mockSendTelegram.mockResolvedValueOnce({ success: true });

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.success).toBe(true);
      expect(result.channelId).toBe('ai-insights');
      expect(result.usersNotified).toBe(1);

      expect(mockSendTelegram).toHaveBeenCalledOnce();
      expect(mockSendTelegram).toHaveBeenCalledWith(
        'bot-token-123',
        '999888777',
        expect.stringContaining('Treasury Intelligence'),
      );
    });

    it('skips users without intelligence settings', async () => {
      mockFindMany.mockResolvedValueOnce([{
        user: { id: 'user-no-prefs', preferences: null },
      }] as any);

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.success).toBe(true);
      expect(result.usersNotified).toBe(0);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('skips users whose intelligence is not enabled for the wallet', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeWalletUser({
          intelligence: {
            wallets: {
              'wallet-1': { enabled: false, notifyTelegram: true, severityFilter: 'info', typeFilter: ['utxo_health'] },
            },
          },
        }),
      ] as any);

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.usersNotified).toBe(0);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('respects severity filter - skips info when filter is warning', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeWalletUser({
          intelligence: {
            wallets: {
              'wallet-1': { enabled: true, notifyTelegram: true, severityFilter: 'warning', typeFilter: ['utxo_health'] },
            },
          },
        }),
      ] as any);

      const result = await aiInsightsChannelHandler.notifyAIInsight!(
        'wallet-1',
        makeInsight({ severity: 'info' }),
      );

      expect(result.usersNotified).toBe(0);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('passes severity filter - warning passes when filter is warning', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser({
        intelligence: {
          wallets: {
            'wallet-1': { enabled: true, notifyTelegram: true, severityFilter: 'warning', typeFilter: ['utxo_health'] },
          },
        },
      })] as any);
      mockSendTelegram.mockResolvedValueOnce({ success: true });

      const result = await aiInsightsChannelHandler.notifyAIInsight!(
        'wallet-1',
        makeInsight({ severity: 'warning' }),
      );

      expect(result.usersNotified).toBe(1);
    });

    it('passes severity filter - critical passes when filter is warning', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser({
        intelligence: {
          wallets: {
            'wallet-1': { enabled: true, notifyTelegram: true, severityFilter: 'warning', typeFilter: ['utxo_health'] },
          },
        },
      })] as any);
      mockSendTelegram.mockResolvedValueOnce({ success: true });

      const result = await aiInsightsChannelHandler.notifyAIInsight!(
        'wallet-1',
        makeInsight({ severity: 'critical' }),
      );

      expect(result.usersNotified).toBe(1);
    });

    it('defaults missing severity filter to info', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser({
        intelligence: {
          wallets: {
            'wallet-1': { enabled: true, notifyTelegram: true, typeFilter: ['utxo_health'] },
          },
        },
      })] as any);
      mockSendTelegram.mockResolvedValueOnce({ success: true });

      const result = await aiInsightsChannelHandler.notifyAIInsight!(
        'wallet-1',
        makeInsight({ severity: 'info' }),
      );

      expect(result.usersNotified).toBe(1);
      expect(mockSendTelegram).toHaveBeenCalledOnce();
    });

    it('respects type filter - skips insight types not in filter', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeWalletUser({
          intelligence: {
            wallets: {
              'wallet-1': { enabled: true, notifyTelegram: true, severityFilter: 'info', typeFilter: ['fee_timing'] },
            },
          },
        }),
      ] as any);

      const result = await aiInsightsChannelHandler.notifyAIInsight!(
        'wallet-1',
        makeInsight({ type: 'utxo_health' }),
      );

      expect(result.usersNotified).toBe(0);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('defaults missing Telegram notification preference to enabled', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser({
        intelligence: {
          wallets: {
            'wallet-1': { enabled: true, severityFilter: 'info', typeFilter: ['utxo_health'] },
          },
        },
      })] as any);
      mockSendTelegram.mockResolvedValueOnce({ success: true });

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.usersNotified).toBe(1);
      expect(mockSendTelegram).toHaveBeenCalledOnce();
    });

    it('skips Telegram when the wallet setting disables insight notifications', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser({
        intelligence: {
          wallets: {
            'wallet-1': { enabled: true, notifyTelegram: false, severityFilter: 'info', typeFilter: ['utxo_health'] },
          },
        },
      })] as any);

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.usersNotified).toBe(0);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('skips Telegram when user has no Telegram configuration', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeWalletUser({ telegram: null }),
      ] as any);

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.usersNotified).toBe(0);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('skips Telegram when Telegram is disabled', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeWalletUser({ telegram: { enabled: false, botToken: 'tok', chatId: '123' } }),
      ] as any);

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.usersNotified).toBe(0);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('handles Telegram send errors gracefully per user', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeWalletUser({ userId: 'user-1' }),
        makeWalletUser({ userId: 'user-2', telegram: { enabled: true, botToken: 'tok2', chatId: '456' } }),
      ] as any);

      mockSendTelegram
        .mockRejectedValueOnce(new Error('Telegram API timeout'))
        .mockResolvedValueOnce({ success: true });

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.success).toBe(true);
      expect(result.usersNotified).toBe(1);
      expect(mockSendTelegram).toHaveBeenCalledTimes(2);
    });

    it('returns failure result when findMany throws', async () => {
      mockFindMany.mockRejectedValueOnce(new Error('Database connection lost'));

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('ai-insights');
      expect(result.errors).toContain('Database connection lost');
    });

    it('notifies multiple users for the same wallet', async () => {
      mockFindMany.mockResolvedValueOnce([
        makeWalletUser({ userId: 'user-1' }),
        makeWalletUser({ userId: 'user-2', telegram: { enabled: true, botToken: 'tok2', chatId: '456' } }),
        makeWalletUser({ userId: 'user-3', telegram: { enabled: true, botToken: 'tok3', chatId: '789' } }),
      ] as any);

      mockSendTelegram.mockResolvedValue({ success: true });

      const result = await aiInsightsChannelHandler.notifyAIInsight!('wallet-1', makeInsight());

      expect(result.usersNotified).toBe(3);
      expect(mockSendTelegram).toHaveBeenCalledTimes(3);
    });

    it('formats the message with severity icon and type label', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser()] as any);
      mockSendTelegram.mockResolvedValueOnce({ success: true });

      await aiInsightsChannelHandler.notifyAIInsight!(
        'wallet-1',
        makeInsight({
          severity: 'critical',
          type: 'anomaly',
          title: 'Unusual spending detected',
          summary: 'Spending is 5x the 90-day average.',
          walletName: 'Cold Storage',
        }),
      );

      const sentMessage = mockSendTelegram.mock.calls[0][2];
      expect(sentMessage).toContain('Treasury Intelligence');
      expect(sentMessage).toContain('Cold Storage');
      expect(sentMessage).toContain('Unusual spending detected');
      expect(sentMessage).toContain('Spending is 5x the 90-day average.');
      expect(sentMessage).toContain('critical');
      expect(sentMessage).toContain('Anomaly Detection');
      expect(sentMessage).toContain('Sanctuary AI');
    });

    it('uses correct severity icons', async () => {
      for (const [severity, expectedIcon] of [
        ['info', '\u2139\uFE0F'],
        ['warning', '\u26A0\uFE0F'],
        ['critical', '\uD83D\uDED1'],
      ] as const) {
        vi.clearAllMocks();
        mockFindMany.mockResolvedValueOnce([makeWalletUser()] as any);
        mockSendTelegram.mockResolvedValueOnce({ success: true });

        await aiInsightsChannelHandler.notifyAIInsight!(
          'wallet-1',
          makeInsight({ severity }),
        );

        const sentMessage = mockSendTelegram.mock.calls[0][2];
        expect(sentMessage).toContain(expectedIcon);
      }
    });

    it('falls back to generic formatting for unknown severity and type values', async () => {
      mockFindMany.mockResolvedValueOnce([makeWalletUser({
        intelligence: {
          wallets: {
            'wallet-1': { enabled: true, notifyTelegram: true, severityFilter: 'unknown' },
          },
        },
      })] as any);
      mockSendTelegram.mockResolvedValueOnce({ success: true });

      await aiInsightsChannelHandler.notifyAIInsight!(
        'wallet-1',
        makeInsight({
          severity: 'unknown' as AIInsightNotification['severity'],
          type: 'custom_type' as AIInsightNotification['type'],
        }),
      );

      const sentMessage = mockSendTelegram.mock.calls[0][2];
      expect(sentMessage).toContain('\u2139\uFE0F');
      expect(sentMessage).toContain('Type: custom_type');
    });
  });
});
