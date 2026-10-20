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
    notifyWalletUsers: vi.fn(),
  },
}));

vi.mock('../../../../../src/services/telegram/telegramService', () => mockTelegramService);
vi.mock('../../../../../src/services/push/pushService', () => mockPushService);

import { telegramChannelHandler } from '../../../../../src/services/notifications/channels/telegram';
import { pushChannelHandler } from '../../../../../src/services/notifications/channels/push';

type ConsolidationSuggestion = Parameters<
  NonNullable<typeof telegramChannelHandler.notifyConsolidationSuggestion>
>[1];

function makeConsolidationSuggestion(
  overrides: Partial<Omit<ConsolidationSuggestion, 'utxoHealth'>> & {
    utxoHealth?: Partial<ConsolidationSuggestion['utxoHealth']>;
  } = {}
): ConsolidationSuggestion {
  const { utxoHealth, ...suggestionOverrides } = overrides;
  return {
    walletId: 'wallet-1',
    walletName: 'Treasury',
    feeRate: 5,
    utxoHealth: {
      totalUtxos: 12,
      dustCount: 0,
      dustValue: 0n,
      totalValue: 120_000n,
      ...utxoHealth,
    },
    estimatedSavings: 'minimal savings',
    reason: 'Fees are low',
    ...suggestionOverrides,
  } satisfies ConsolidationSuggestion;
}

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
      mockTelegramService.notifyNewTransactions.mockResolvedValueOnce({
        usersNotified: 2,
        attempted: 2,
        errors: [],
        outcome: 'accepted',
        failureClass: 'none',
      });

      const result = await telegramChannelHandler.notifyTransactions('wallet-1', [
        {
          txid: 'a'.repeat(64),
          type: 'sent',
          amount: 10_000n,
          agentDestinationClassification: 'unknown_destination',
          agentUnknownDestinationHandlingMode: 'notify_only',
        },
      ]);

      expect(mockTelegramService.notifyNewTransactions).toHaveBeenCalledWith('wallet-1', [
        expect.objectContaining({
          txid: 'a'.repeat(64),
          type: 'sent',
          amount: 10_000n,
          agentDestinationClassification: 'unknown_destination',
          agentUnknownDestinationHandlingMode: 'notify_only',
        }),
      ]);
      expect(result).toEqual({
        success: true,
        channelId: 'telegram',
        usersNotified: 2,
        errors: undefined,
        outcome: 'accepted',
        failureClass: 'none',
      });
    });

    it('returns failed transaction result when Telegram reports send errors', async () => {
      mockTelegramService.notifyNewTransactions.mockResolvedValueOnce({
        usersNotified: 0,
        attempted: 1,
        errors: ['Chat not found'],
        outcome: 'rejected',
        failureClass: 'provider_rejected',
      });

      const result = await telegramChannelHandler.notifyTransactions('wallet-1', [
        { txid: 'b'.repeat(64), type: 'received', amount: 8_000n },
      ]);

      expect(result).toEqual({
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: ['Chat not found'],
        outcome: 'rejected',
        failureClass: 'provider_rejected',
      });
    });

    it.each([
      {
        summary: { usersNotified: 0, attempted: 1, errors: ['legacy failure'] },
        expected: { outcome: 'ambiguous', failureClass: 'unknown' },
      },
      {
        summary: { usersNotified: 1, attempted: 1, errors: [] },
        expected: { outcome: 'accepted', failureClass: 'none' },
      },
      {
        summary: { usersNotified: 0, attempted: 0, errors: [] },
        expected: { outcome: 'no_recipients', failureClass: 'none' },
      },
    ])('derives safe fields from legacy Telegram summary %#', async ({ summary, expected }) => {
      mockTelegramService.notifyNewTransactions.mockResolvedValueOnce(summary);

      const result = await telegramChannelHandler.notifyTransactions('wallet-legacy', [
        { txid: 'c'.repeat(64), type: 'received', amount: 1n },
      ]);

      expect(result).toMatchObject(expected);
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
      mockTelegramService.notifyNewDraft.mockResolvedValueOnce({
        success: true,
        usersNotified: 1,
      });

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
        errors: undefined,
        recorded: undefined,
      });
    });

    it('does not fabricate success when notifyNewDraft reports zero delivered', async () => {
      mockTelegramService.notifyNewDraft.mockResolvedValueOnce({
        success: false,
        usersNotified: 0,
        error: 'All 2 Telegram draft notification send(s) failed',
        recorded: false,
      });

      const result = await telegramChannelHandler.notifyDraft!(
        'wallet-1',
        {
          id: 'draft-3',
          amount: 5_000n,
          recipient: 'tb1qexample',
          feeRate: 3,
        },
        'user-3'
      );

      expect(result).toEqual({
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: ['All 2 Telegram draft notification send(s) failed'],
        recorded: false,
      });
    });

    it('maps a lookup failure reported by notifyNewDraft to a failed result', async () => {
      mockTelegramService.notifyNewDraft.mockResolvedValueOnce({
        success: false,
        usersNotified: 0,
        error: 'wallet lookup failed',
        recorded: false,
      });

      const result = await telegramChannelHandler.notifyDraft!(
        'wallet-1',
        {
          id: 'draft-4',
          amount: 5_000n,
          recipient: 'tb1qexample',
          feeRate: 3,
        },
        'user-4'
      );

      expect(result).toEqual({
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: ['wallet lookup failed'],
        recorded: false,
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
      expect(result.recorded).toBe(false);
    });

    it('sends consolidation suggestions only to enabled telegram recipients', async () => {
      mockTelegramService.getWalletUsers.mockResolvedValueOnce([
        {
          username: 'alice',
          preferences: { telegram: { enabled: true, botToken: 'bot-1', chatId: 'chat-1' }, autopilot: { wallets: { 'wallet-1': { enabled: true } } } },
        },
        {
          username: 'bob',
          preferences: { telegram: { enabled: false, botToken: 'bot-2', chatId: 'chat-2' }, autopilot: { wallets: { 'wallet-1': { enabled: true } } } },
        },
        {
          username: 'carol',
          preferences: { telegram: { enabled: true, botToken: 'bot-3' }, autopilot: { wallets: { 'wallet-1': { enabled: true } } } },
        },
      ]);
      mockTelegramService.sendTelegramMessage.mockResolvedValueOnce({ success: true });

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        makeConsolidationSuggestion({
          walletName: 'Treasury <Main>',
          utxoHealth: {
            totalUtxos: 21,
            dustCount: 3,
            dustValue: 12000n,
            totalValue: 900000n,
          },
          estimatedSavings: '~12,000 sats in potential fee savings',
        })
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

    it('sends consolidation suggestions only to users with autopilot enabled for the wallet', async () => {
      const telegram = (n: number) => ({ enabled: true, botToken: `bot-${n}`, chatId: `chat-${n}` });
      mockTelegramService.getWalletUsers.mockResolvedValueOnce([
        {
          username: 'alice',
          preferences: { telegram: telegram(1), autopilot: { wallets: { 'wallet-1': { enabled: true, notifyTelegram: true } } } },
        },
        {
          username: 'bob',
          preferences: { telegram: telegram(2), autopilot: { wallets: { 'wallet-1': { enabled: true, notifyTelegram: false } } } },
        },
        { username: 'carol', preferences: { telegram: telegram(3) } },
        {
          username: 'dave',
          preferences: { telegram: telegram(4), autopilot: { wallets: { 'wallet-1': { enabled: false } } } },
        },
        {
          username: 'erin',
          preferences: { telegram: telegram(5), autopilot: { wallets: { 'wallet-2': { enabled: true } } } },
        },
      ]);
      mockTelegramService.sendTelegramMessage.mockResolvedValue({ success: true });

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        makeConsolidationSuggestion()
      );

      expect(mockTelegramService.sendTelegramMessage).toHaveBeenCalledTimes(1);
      expect(mockTelegramService.sendTelegramMessage.mock.calls[0].slice(0, 2)).toEqual(['bot-1', 'chat-1']);
      expect(result.usersNotified).toBe(1);
    });

    it('continues when one consolidation notification fails', async () => {
      mockTelegramService.getWalletUsers.mockResolvedValueOnce([
        {
          username: 'alice',
          preferences: { telegram: { enabled: true, botToken: 'bot-1', chatId: 'chat-1' }, autopilot: { wallets: { 'wallet-1': { enabled: true } } } },
        },
        {
          username: 'bob',
          preferences: { telegram: { enabled: true, botToken: 'bot-2', chatId: 'chat-2' }, autopilot: { wallets: { 'wallet-1': { enabled: true } } } },
        },
      ]);
      mockTelegramService.sendTelegramMessage
        .mockResolvedValueOnce({ success: false, error: 'chat blocked' })
        .mockResolvedValueOnce({ success: true });

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        makeConsolidationSuggestion({
          feeRate: 6,
          utxoHealth: {
            totalUtxos: 14,
            totalValue: 700000n,
          },
        })
      );

      expect(mockTelegramService.sendTelegramMessage).toHaveBeenCalledTimes(2);
      const [, , firstMessage] = mockTelegramService.sendTelegramMessage.mock.calls[0];
      expect(firstMessage).not.toContain('Estimated savings:');
      expect(result).toEqual({
        success: false,
        channelId: 'telegram',
        usersNotified: 1,
        errors: ['chat blocked'],
      });
    });

    it('reports unknown consolidation send failures without dropping later recipients', async () => {
      mockTelegramService.getWalletUsers.mockResolvedValueOnce([
        {
          username: 'alice',
          preferences: { telegram: { enabled: true, botToken: 'bot-1', chatId: 'chat-1' }, autopilot: { wallets: { 'wallet-1': { enabled: true } } } },
        },
      ]);
      mockTelegramService.sendTelegramMessage.mockResolvedValueOnce({ success: false });

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        makeConsolidationSuggestion({
          feeRate: 6,
          utxoHealth: {
            totalUtxos: 14,
            totalValue: 700000n,
          },
        })
      );

      expect(result).toEqual({
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: ['Unknown Telegram send failure'],
      });
    });

    it('returns failed result when consolidation notifications throw', async () => {
      mockTelegramService.getWalletUsers.mockRejectedValueOnce(new Error('wallet lookup failed'));

      const result = await telegramChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        makeConsolidationSuggestion({
          utxoHealth: {
            dustCount: 1,
            dustValue: 500n,
          },
          estimatedSavings: '~5,000 sats in potential fee savings',
        })
      );

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('telegram');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('wallet lookup failed');
    });
  });

  describe('pushChannelHandler', () => {
    it('advertises insight and consolidation support', () => {
      expect(pushChannelHandler.capabilities.supportsAIInsights).toBe(true);
      expect(pushChannelHandler.capabilities.supportsConsolidationSuggestions).toBe(true);
    });

    it('sends a minimal consolidation push without UTXO or savings details', async () => {
      mockPushService.notifyWalletUsers.mockResolvedValueOnce({ success: true, usersNotified: 2 });

      const result = await pushChannelHandler.notifyConsolidationSuggestion!(
        'wallet-1',
        makeConsolidationSuggestion({ estimatedSavings: 'about 12,345 sats', reason: 'secret reason' })
      );

      expect(mockPushService.notifyWalletUsers).toHaveBeenCalledWith('wallet-1', {
        title: 'Consolidation opportunity',
        body: 'Treasury: fees are low (5 sat/vB)',
        data: { walletId: 'wallet-1', kind: 'consolidation_suggestion' },
      }, expect.any(Function));
      expect(result).toEqual({
        success: true,
        channelId: 'push',
        usersNotified: 2,
        outcome: 'ambiguous',
        failureClass: 'unknown',
      });
    });

    it('only pushes consolidation suggestions to users with Autopilot push enabled for the wallet', async () => {
      mockPushService.notifyWalletUsers.mockResolvedValueOnce({ success: true, usersNotified: 0 });
      await pushChannelHandler.notifyConsolidationSuggestion!('wallet-1', makeConsolidationSuggestion());
      const isEligible = mockPushService.notifyWalletUsers.mock.calls[0][2];
      const autopilot = (settings: Record<string, unknown>) => ({
        preferences: { autopilot: { wallets: { 'wallet-1': settings } } },
      });

      expect(isEligible(autopilot({ enabled: true, notifyPush: true }))).toBe(true);
      expect(isEligible(autopilot({ enabled: true, notifyPush: false }))).toBe(false);
      expect(isEligible(autopilot({ enabled: false, notifyPush: true }))).toBe(false);
      expect(isEligible({ preferences: { autopilot: { wallets: { 'wallet-2': { enabled: true, notifyPush: true } } } } })).toBe(false);
      expect(isEligible({ preferences: null })).toBe(false);
    });

    it('maps push failures and throws for consolidation suggestions', async () => {
      mockPushService.notifyWalletUsers.mockResolvedValueOnce({
        success: false,
        usersNotified: 0,
        error: 'lookup failed',
        recorded: false,
      });
      await expect(
        pushChannelHandler.notifyConsolidationSuggestion!('wallet-1', makeConsolidationSuggestion())
      ).resolves.toMatchObject({ success: false, errors: ['lookup failed'], recorded: false });

      mockPushService.notifyWalletUsers.mockResolvedValueOnce({ success: false, usersNotified: 0 });
      await expect(
        pushChannelHandler.notifyConsolidationSuggestion!('wallet-1', makeConsolidationSuggestion())
      ).resolves.toMatchObject({ success: false, errors: undefined, recorded: false });

      mockPushService.notifyWalletUsers.mockRejectedValueOnce(new Error('boom'));
      await expect(
        pushChannelHandler.notifyConsolidationSuggestion!('wallet-1', makeConsolidationSuggestion())
      ).resolves.toMatchObject({ success: false, errors: ['boom'], recorded: false });
    });

    describe('notifyAIInsight', () => {
      const insight = {
        id: 'insight-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'Dust piling up',
        summary: 'You hold 5,000 sats of dust',
        walletName: 'Treasury',
      };
      const enabled = (extra: Record<string, unknown> = {}) => ({
        preferences: { intelligence: { wallets: { 'wallet-1': { enabled: true, ...extra } } } },
      });

      it('sends a minimal push that omits the AI summary text', async () => {
        mockPushService.notifyWalletUsers.mockResolvedValueOnce({ success: true, usersNotified: 1 });

        const result = await pushChannelHandler.notifyAIInsight!('wallet-1', insight);

        const [walletId, message] = mockPushService.notifyWalletUsers.mock.calls[0];
        expect(walletId).toBe('wallet-1');
        expect(message).toEqual({
          title: 'Treasury Intelligence',
          body: 'Treasury: warning UTXO Health insight',
          data: { walletId: 'wallet-1', insightId: 'insight-1', kind: 'ai_insight' },
        });
        expect(JSON.stringify(message)).not.toContain('dust');
        expect(result).toMatchObject({ success: true, channelId: 'push', usersNotified: 1 });
      });

      it('falls back to the raw type when it has no label', async () => {
        mockPushService.notifyWalletUsers.mockResolvedValueOnce({ success: true, usersNotified: 0 });

        await pushChannelHandler.notifyAIInsight!('wallet-1', { ...insight, type: 'custom' });

        expect(mockPushService.notifyWalletUsers.mock.calls[0][1].body).toBe(
          'Treasury: warning custom insight'
        );
      });

      it('only targets users with intelligence enabled and push not disabled', async () => {
        mockPushService.notifyWalletUsers.mockResolvedValueOnce({ success: true, usersNotified: 0 });
        await pushChannelHandler.notifyAIInsight!('wallet-1', insight);
        const isEligible = mockPushService.notifyWalletUsers.mock.calls[0][2];

        expect(isEligible(enabled())).toBe(true);
        expect(isEligible(enabled({ notifyPush: true }))).toBe(true);
        expect(isEligible(enabled({ notifyPush: false }))).toBe(false);
        expect(isEligible(enabled({ severityFilter: 'critical' }))).toBe(false);
        expect(isEligible({ preferences: null })).toBe(false);
      });

      it('maps push failures and throws', async () => {
        mockPushService.notifyWalletUsers.mockResolvedValueOnce({
          success: false,
          usersNotified: 1,
          error: 'send loop failed',
        });
        await expect(pushChannelHandler.notifyAIInsight!('wallet-1', insight)).resolves.toMatchObject({
          success: false,
          usersNotified: 1,
          errors: ['send loop failed'],
          recorded: false,
        });

        mockPushService.notifyWalletUsers.mockRejectedValueOnce(new Error('boom'));
        await expect(pushChannelHandler.notifyAIInsight!('wallet-1', insight)).resolves.toMatchObject({
          success: false,
          errors: ['boom'],
          recorded: false,
        });
      });
    });

    it('uses push service configuration status in isEnabled', async () => {
      mockPushService.isPushConfigured.mockReturnValueOnce(true);
      await expect(pushChannelHandler.isEnabled()).resolves.toBe(true);

      mockPushService.isPushConfigured.mockReturnValueOnce(false);
      await expect(pushChannelHandler.isEnabled()).resolves.toBe(false);
    });

    it('forwards transaction notifications and returns success result', async () => {
      mockPushService.notifyNewTransactions.mockResolvedValueOnce({
        success: true,
        usersNotified: 1,
      });

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
        outcome: 'ambiguous',
        failureClass: 'unknown',
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
      // Not self-recorded: an unexpected throw here must still reach the
      // job-level dead letter queue.
      expect(result.recorded).toBe(false);
    });

    it('reports failure instead of full success when the outer lookup fails', async () => {
      mockPushService.notifyNewTransactions.mockResolvedValueOnce({
        success: false,
        usersNotified: 0,
        error: 'wallet lookup exploded',
        recorded: false,
      });

      const result = await pushChannelHandler.notifyTransactions('wallet-2', [
        { txid: 'e'.repeat(64), type: 'received', amount: 1_000n },
      ]);

      expect(result).toEqual({
        success: false,
        channelId: 'push',
        usersNotified: 0,
        errors: ['wallet lookup exploded'],
        outcome: 'ambiguous',
        failureClass: 'internal',
        recorded: false,
      });
    });

    it('maps a send-loop failure with a partial usersNotified count to a failed, unrecorded result', async () => {
      mockPushService.notifyNewTransactions.mockResolvedValueOnce({
        success: false,
        usersNotified: 1,
        error: 'device lookup exploded',
        recorded: false,
      });

      const result = await pushChannelHandler.notifyTransactions('wallet-2', [
        { txid: 'g'.repeat(64), type: 'received', amount: 3_000n },
      ]);

      expect(result).toEqual({
        success: false,
        channelId: 'push',
        usersNotified: 1,
        errors: ['device lookup exploded'],
        outcome: 'ambiguous',
        failureClass: 'internal',
        recorded: false,
      });
    });

    it('omits errors and defaults recorded to false when the push result carries neither', async () => {
      mockPushService.notifyNewTransactions.mockResolvedValueOnce({
        success: false,
        usersNotified: 0,
      });

      const result = await pushChannelHandler.notifyTransactions('wallet-2', [
        { txid: 'f'.repeat(64), type: 'received', amount: 2_000n },
      ]);

      expect(result).toEqual({
        success: false,
        channelId: 'push',
        usersNotified: 0,
        errors: undefined,
        outcome: 'ambiguous',
        failureClass: 'internal',
        recorded: false,
      });
    });
  });
});
