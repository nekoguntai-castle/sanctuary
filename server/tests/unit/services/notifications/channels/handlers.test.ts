import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTelegramService, mockPushService } = vi.hoisted(() => ({
  mockTelegramService: {
    notifyNewTransactions: vi.fn(),
    notifyNewDraft: vi.fn(),
    getWalletUsers: vi.fn(),
    escapeHtml: vi.fn((value: string) => value),
    sendTelegramMessage: vi.fn(),
  },
  mockPushService: {
    isPushConfigured: vi.fn(),
    notifyNewTransactions: vi.fn(),
  },
}));

vi.mock('../../../../../src/services/telegram/telegramService', () => mockTelegramService);
vi.mock('../../../../../src/services/push/pushService', () => mockPushService);

import { telegramChannelHandler } from '../../../../../src/services/notifications/channels/telegram';
import { pushChannelHandler } from '../../../../../src/services/notifications/channels/push';

describe('notification channel handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTelegramService.getWalletUsers.mockResolvedValue([]);
    mockTelegramService.sendTelegramMessage.mockResolvedValue({ success: true });
  });

  describe('telegramChannelHandler', () => {
    it('is always enabled', async () => {
      await expect(telegramChannelHandler.isEnabled()).resolves.toBe(true);
    });

    it('forwards transaction notifications and returns success result', async () => {
      mockTelegramService.notifyNewTransactions.mockResolvedValueOnce(undefined);

      const result = await telegramChannelHandler.notifyTransactions('wallet-1', [
        { txid: 'a'.repeat(64), type: 'received', amount: 10_000n },
      ]);

      expect(mockTelegramService.notifyNewTransactions).toHaveBeenCalledWith('wallet-1', [
        expect.objectContaining({ txid: 'a'.repeat(64), type: 'received', amount: 10_000n }),
      ]);
      expect(result).toEqual({
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      });
    });

    it('returns failed result when transaction notifications throw', async () => {
      mockTelegramService.notifyNewTransactions.mockRejectedValueOnce(new Error('telegram tx failure'));

      const result = await telegramChannelHandler.notifyTransactions('wallet-1', [
        { txid: 'b'.repeat(64), type: 'sent', amount: 8_000n },
      ]);

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('telegram');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('telegram tx failure');
    });

    it('forwards draft notifications and returns success result', async () => {
      mockTelegramService.notifyNewDraft.mockResolvedValueOnce(undefined);

      const result = await telegramChannelHandler.notifyDraft!(
        'wallet-1',
        {
          id: 'draft-1',
          amount: 12_000n,
          recipient: 'tb1qexample',
          feeRate: 2,
        },
        'user-1'
      );

      expect(mockTelegramService.notifyNewDraft).toHaveBeenCalledWith(
        'wallet-1',
        {
          id: 'draft-1',
          amount: 12_000n,
          recipient: 'tb1qexample',
          feeRate: 2,
        },
        'user-1',
        undefined
      );
      expect(result).toEqual({
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      });
    });

    it('returns failed result when draft notifications throw', async () => {
      mockTelegramService.notifyNewDraft.mockRejectedValueOnce(new Error('telegram draft failure'));

      const result = await telegramChannelHandler.notifyDraft!(
        'wallet-1',
        {
          id: 'draft-2',
          amount: 9_000n,
          recipient: 'tb1qexample',
          feeRate: 1,
        },
        'user-2'
      );

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('telegram');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('telegram draft failure');
    });

    it('sends consolidation suggestions only to enabled telegram recipients', async () => {
      mockTelegramService.getWalletUsers.mockResolvedValueOnce([
        {
          username: 'alice',
          preferences: { telegram: { enabled: true, botToken: 'bot-1', chatId: 'chat-1' } },
        },
        {
          username: 'bob',
          preferences: { telegram: { enabled: false, botToken: 'bot-2', chatId: 'chat-2' } },
        },
        {
          username: 'carol',
          preferences: { telegram: { enabled: true, botToken: 'bot-3' } },
        },
      ]);
      mockTelegramService.sendTelegramMessage.mockResolvedValueOnce({ success: true });

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        {
          walletId: 'wallet-1',
          walletName: 'Treasury <Main>',
          feeRate: 5,
          utxoHealth: {
            totalUtxos: 21,
            dustCount: 3,
            dustValue: 12000n,
            totalValue: 900000n,
            avgUtxoSize: 42_857n,
            smallestUtxo: 1000n,
            largestUtxo: 300000n,
          },
          estimatedSavings: '~12,000 sats in potential fee savings',
          reason: 'Fees are low',
        }
      );

      expect(mockTelegramService.sendTelegramMessage).toHaveBeenCalledTimes(1);
      const [botToken, chatId, message] = mockTelegramService.sendTelegramMessage.mock.calls[0];
      expect(botToken).toBe('bot-1');
      expect(chatId).toBe('chat-1');
      expect(message).toContain('Consolidation Opportunity');
      expect(message).toContain('3 dust');
      expect(message).toContain('Estimated savings: ~12,000 sats');
      expect(result).toEqual({
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      });
    });

    it('continues when one consolidation notification fails', async () => {
      mockTelegramService.getWalletUsers.mockResolvedValueOnce([
        {
          username: 'alice',
          preferences: { telegram: { enabled: true, botToken: 'bot-1', chatId: 'chat-1' } },
        },
        {
          username: 'bob',
          preferences: { telegram: { enabled: true, botToken: 'bot-2', chatId: 'chat-2' } },
        },
      ]);
      mockTelegramService.sendTelegramMessage
        .mockResolvedValueOnce({ success: false, error: 'chat blocked' })
        .mockResolvedValueOnce({ success: true });

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          feeRate: 6,
          utxoHealth: {
            totalUtxos: 14,
            dustCount: 0,
            dustValue: 0n,
            totalValue: 700000n,
            avgUtxoSize: 50_000n,
            smallestUtxo: 5000n,
            largestUtxo: 250000n,
          },
          estimatedSavings: 'minimal savings',
          reason: 'Fees are low',
        }
      );

      expect(mockTelegramService.sendTelegramMessage).toHaveBeenCalledTimes(2);
      const [, , firstMessage] = mockTelegramService.sendTelegramMessage.mock.calls[0];
      expect(firstMessage).not.toContain('Estimated savings:');
      expect(result).toEqual({
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      });
    });

    it('returns failed result when consolidation notifications throw', async () => {
      mockTelegramService.getWalletUsers.mockRejectedValueOnce(new Error('wallet lookup failed'));

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        {
          walletId: 'wallet-1',
          walletName: 'Treasury',
          feeRate: 5,
          utxoHealth: {
            totalUtxos: 12,
            dustCount: 1,
            dustValue: 500n,
            totalValue: 120000n,
            avgUtxoSize: 10000n,
            smallestUtxo: 500n,
            largestUtxo: 50000n,
          },
          estimatedSavings: '~5,000 sats in potential fee savings',
          reason: 'Fees are low',
        }
      );

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('telegram');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('wallet lookup failed');
    });
  });

  describe('pushChannelHandler', () => {
    it('uses push service configuration status in isEnabled', async () => {
      mockPushService.isPushConfigured.mockReturnValueOnce(true);
      await expect(pushChannelHandler.isEnabled()).resolves.toBe(true);

      mockPushService.isPushConfigured.mockReturnValueOnce(false);
      await expect(pushChannelHandler.isEnabled()).resolves.toBe(false);
    });

    it('forwards transaction notifications and returns success result', async () => {
      mockPushService.notifyNewTransactions.mockResolvedValueOnce(undefined);

      const result = await pushChannelHandler.notifyTransactions('wallet-2', [
        { txid: 'c'.repeat(64), type: 'received', amount: 6_000n },
      ]);

      expect(mockPushService.notifyNewTransactions).toHaveBeenCalledWith('wallet-2', [
        { txid: 'c'.repeat(64), type: 'received', amount: 6_000n },
      ]);
      expect(result).toEqual({
        success: true,
        channelId: 'push',
        usersNotified: 1,
      });
    });

    it('returns failed result when push notifications throw', async () => {
      mockPushService.notifyNewTransactions.mockRejectedValueOnce(new Error('push failure'));

      const result = await pushChannelHandler.notifyTransactions('wallet-2', [
        { txid: 'd'.repeat(64), type: 'sent', amount: 4_000n },
      ]);

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('push');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('push failure');
    });
  });
});
