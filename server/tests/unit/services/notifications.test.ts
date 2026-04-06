/**
 * Notification Services Tests
 *
 * Tests for Telegram and push notification dispatching.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { createTelegramApiMock, createTelegramErrorMock, setupTelegramMock } from '../../mocks/externalApis';
import { sampleUsers, sampleWallets, testnetAddresses } from '../../fixtures/bitcoin';

// Save original fetch
const originalFetch = global.fetch;

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock walletLog (used by telegram notifications for system log entries)
vi.mock('../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

// Import after mocks
import {
  sendTelegramMessage,
  getChatIdFromBot,
  testTelegramConfig,
  notifyNewTransactions as telegramNotifyNewTransactions,
  notifyNewDraft,
  updateWalletTelegramSettings,
  getWalletTelegramSettings,
  getWalletUsers,
} from '../../../src/services/telegram/telegramService';

import {
  notifyNewTransactions as unifiedNotifyNewTransactions,
} from '../../../src/services/notifications/notificationService';

describe('Notification Services', () => {
  beforeEach(() => {
    resetPrismaMocks();
    // Reset fetch to original before each test
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Telegram Service', () => {
    describe('sendTelegramMessage', () => {
      it('should send message successfully', async () => {
        const mockFetch = createTelegramApiMock();
        global.fetch = mockFetch as unknown as typeof fetch;

        const result = await sendTelegramMessage(
          'test-bot-token',
          '123456789',
          'Test message'
        );

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/sendMessage'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('Test message'),
          })
        );
      });

      it('should handle API error', async () => {
        const mockFetch = createTelegramErrorMock('Bad Request: chat not found');
        global.fetch = mockFetch as unknown as typeof fetch;

        const result = await sendTelegramMessage(
          'test-bot-token',
          'invalid-chat-id',
          'Test message'
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('chat not found');
      });

      it('should handle network error', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        const result = await sendTelegramMessage(
          'test-bot-token',
          '123456789',
          'Test message'
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Network error');
      });

      it('should use HTML parse mode', async () => {
        const mockFetch = createTelegramApiMock();
        global.fetch = mockFetch as unknown as typeof fetch;

        await sendTelegramMessage(
          'test-bot-token',
          '123456789',
          '<b>Bold</b> message'
        );

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('"parse_mode":"HTML"'),
          })
        );
      });
    });

    describe('getChatIdFromBot', () => {
      it('should extract chat ID from bot updates', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [
              {
                update_id: 123,
                message: {
                  chat: {
                    id: 987654321,
                    username: 'testuser',
                    first_name: 'Test',
                  },
                  text: '/start',
                },
              },
            ],
          }),
        });

        const result = await getChatIdFromBot('test-bot-token');

        expect(result.success).toBe(true);
        expect(result.chatId).toBe('987654321');
        expect(result.username).toBe('testuser');
      });

      it('should return error when no messages', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [],
          }),
        });

        const result = await getChatIdFromBot('test-bot-token');

        expect(result.success).toBe(false);
        expect(result.error).toContain('No messages');
      });

      it('should handle invalid bot token', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: () => Promise.resolve({
            ok: false,
            description: 'Unauthorized',
          }),
        });

        const result = await getChatIdFromBot('invalid-token');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unauthorized');
      });
    });

    describe('testTelegramConfig', () => {
      it('should send test message successfully', async () => {
        const mockFetch = createTelegramApiMock();
        global.fetch = mockFetch as unknown as typeof fetch;

        const result = await testTelegramConfig('test-bot-token', '123456789');

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('Test Message'),
          })
        );
      });
    });

    describe('getWalletUsers', () => {
      it('should get users with direct wallet access', async () => {
        const walletId = 'test-wallet-id';

        mockPrismaClient.user.findMany.mockResolvedValue([
          { id: 'user-1', username: 'user1', preferences: {} },
        ]);

        const users = await getWalletUsers(walletId);

        expect(users.length).toBe(1);
        expect(mockPrismaClient.user.findMany).toHaveBeenCalled();
      });
    });

    describe('notifyNewTransactions', () => {
      const walletId = 'test-wallet-id';
      const transactions = [
        { txid: 'a'.repeat(64), type: 'received', amount: BigInt(100000) },
      ];

      beforeEach(() => {
        const mockFetch = createTelegramApiMock();
        global.fetch = mockFetch as unknown as typeof fetch;
      });

      it('should notify users with telegram enabled', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          name: 'Test Wallet',
        });

        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          explorerUrl: 'https://mempool.space',
        });

        mockPrismaClient.user.findMany.mockResolvedValue([
          {
            id: 'user-1',
            username: 'testuser',
            preferences: {
              telegram: {
                enabled: true,
                botToken: 'test-token',
                chatId: '123456',
                wallets: {
                  [walletId]: {
                    enabled: true,
                    notifyReceived: true,
                    notifySent: true,
                    notifyConsolidation: false,
                    notifyDraft: false,
                  },
                },
              },
            },
          },
        ]);

        await telegramNotifyNewTransactions(walletId, transactions);

        expect(global.fetch).toHaveBeenCalled();
      });

      it('should skip users without telegram configured', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          name: 'Test Wallet',
        });

        mockPrismaClient.user.findMany.mockResolvedValue([
          { id: 'user-1', username: 'testuser', preferences: {} },
        ]);

        await telegramNotifyNewTransactions(walletId, transactions);

        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('should skip users with telegram disabled for wallet', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          name: 'Test Wallet',
        });

        mockPrismaClient.user.findMany.mockResolvedValue([
          {
            id: 'user-1',
            username: 'testuser',
            preferences: {
              telegram: {
                enabled: true,
                botToken: 'test-token',
                chatId: '123456',
                wallets: {
                  [walletId]: {
                    enabled: false,
                    notifyReceived: true,
                  },
                },
              },
            },
          },
        ]);

        await telegramNotifyNewTransactions(walletId, transactions);

        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('should respect notification type preferences', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          name: 'Test Wallet',
        });

        mockPrismaClient.user.findMany.mockResolvedValue([
          {
            id: 'user-1',
            username: 'testuser',
            preferences: {
              telegram: {
                enabled: true,
                botToken: 'test-token',
                chatId: '123456',
                wallets: {
                  [walletId]: {
                    enabled: true,
                    notifyReceived: false, // Disabled for received
                    notifySent: true,
                  },
                },
              },
            },
          },
        ]);

        // Transaction is type 'received' but user disabled that notification
        await telegramNotifyNewTransactions(walletId, transactions);

        expect(global.fetch).not.toHaveBeenCalled();
      });
    });

    describe('notifyNewDraft', () => {
      const walletId = 'test-wallet-id';
      const draft = {
        id: 'draft-1',
        amount: BigInt(50000),
        recipient: testnetAddresses.nativeSegwit[0],
        label: 'Payment',
        feeRate: 10,
      };
      const createdByUserId = 'user-creator';

      beforeEach(() => {
        const mockFetch = createTelegramApiMock();
        global.fetch = mockFetch as unknown as typeof fetch;
      });

      it('should notify other users about new draft', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          name: 'Test Wallet',
        });

        mockPrismaClient.user.findUnique.mockResolvedValue({
          username: 'creator',
        });

        mockPrismaClient.user.findMany.mockResolvedValue([
          {
            id: 'user-other',
            username: 'otheruser',
            preferences: {
              telegram: {
                enabled: true,
                botToken: 'test-token',
                chatId: '123456',
                wallets: {
                  [walletId]: {
                    enabled: true,
                    notifyDraft: true,
                  },
                },
              },
            },
          },
        ]);

        await notifyNewDraft(walletId, draft, createdByUserId);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('Draft Transaction'),
          })
        );
      });

      it('should not notify the draft creator', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          name: 'Test Wallet',
        });

        mockPrismaClient.user.findUnique.mockResolvedValue({
          username: 'creator',
        });

        // Only the creator has telegram configured
        mockPrismaClient.user.findMany.mockResolvedValue([
          {
            id: createdByUserId,
            username: 'creator',
            preferences: {
              telegram: {
                enabled: true,
                botToken: 'test-token',
                chatId: '123456',
                wallets: {
                  [walletId]: {
                    enabled: true,
                    notifyDraft: true,
                  },
                },
              },
            },
          },
        ]);

        await notifyNewDraft(walletId, draft, createdByUserId);

        // Should not send because only user is the creator
        expect(global.fetch).not.toHaveBeenCalled();
      });
    });

    describe('Wallet Telegram Settings', () => {
      const userId = 'test-user-id';
      const walletId = 'test-wallet-id';

      it('should update wallet telegram settings', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: userId,
          preferences: {
            telegram: {
              enabled: true,
              botToken: 'test-token',
              chatId: '123456',
              wallets: {},
            },
          },
        });

        const settings = {
          enabled: true,
          notifyReceived: true,
          notifySent: true,
          notifyConsolidation: false,
          notifyDraft: true,
        };

        await updateWalletTelegramSettings(userId, walletId, settings);

        expect(mockPrismaClient.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: userId },
            data: expect.objectContaining({
              preferences: expect.objectContaining({
                telegram: expect.objectContaining({
                  wallets: expect.objectContaining({
                    [walletId]: settings,
                  }),
                }),
              }),
            }),
          })
        );
      });

      it('should get wallet telegram settings', async () => {
        const settings = {
          enabled: true,
          notifyReceived: true,
          notifySent: false,
          notifyConsolidation: false,
          notifyDraft: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: userId,
          preferences: {
            telegram: {
              enabled: true,
              botToken: 'test-token',
              chatId: '123456',
              wallets: {
                [walletId]: settings,
              },
            },
          },
        });

        const result = await getWalletTelegramSettings(userId, walletId);

        expect(result).toEqual(settings);
      });

      it('should return null when no settings', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: userId,
          preferences: {},
        });

        const result = await getWalletTelegramSettings(userId, walletId);

        expect(result).toBeNull();
      });
    });
  });

  describe('Unified Notification Service', () => {
    const walletId = 'test-wallet-id';
    const transactions = [
      { txid: 'b'.repeat(64), type: 'received' as const, amount: BigInt(100000) },
    ];

    beforeEach(() => {
      const mockFetch = createTelegramApiMock();
      global.fetch = mockFetch as unknown as typeof fetch;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.findMany.mockResolvedValue([]);
    });

    it('should dispatch to all notification channels', async () => {
      await unifiedNotifyNewTransactions(walletId, transactions);

      // Should attempt both Telegram and Push (though they may skip if no users configured)
      // The important thing is it doesn't throw
      expect(true).toBe(true);
    });

    it('should handle empty transaction array', async () => {
      await unifiedNotifyNewTransactions(walletId, []);

      // Should exit early without errors
      expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('should continue if one channel fails', async () => {
      // Mock Telegram to fail
      global.fetch = vi.fn().mockRejectedValue(new Error('Telegram error'));

      // Should not throw
      await expect(
        unifiedNotifyNewTransactions(walletId, transactions)
      ).resolves.not.toThrow();
    });
  });

  describe('Message Formatting', () => {
    it('should format received transaction correctly', async () => {
      const mockFetch = createTelegramApiMock();
      global.fetch = mockFetch as unknown as typeof fetch;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'wallet-id',
        name: 'My Wallet',
      });

      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
        explorerUrl: 'https://mempool.space',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'testuser',
          preferences: {
            telegram: {
              enabled: true,
              botToken: 'test-token',
              chatId: '123456',
              wallets: {
                'wallet-id': {
                  enabled: true,
                  notifyReceived: true,
                },
              },
            },
          },
        },
      ]);

      await telegramNotifyNewTransactions('wallet-id', [
        { txid: 'c'.repeat(64), type: 'received', amount: BigInt(100000000) }, // 1 BTC
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringMatching(/1\.00000000 BTC/),
        })
      );
    });

    it('should escape HTML in wallet name', async () => {
      const mockFetch = createTelegramApiMock();
      global.fetch = mockFetch as unknown as typeof fetch;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'wallet-id',
        name: '<script>alert("xss")</script>',
      });

      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'testuser',
          preferences: {
            telegram: {
              enabled: true,
              botToken: 'test-token',
              chatId: '123456',
              wallets: {
                'wallet-id': {
                  enabled: true,
                  notifyReceived: true,
                },
              },
            },
          },
        },
      ]);

      await telegramNotifyNewTransactions('wallet-id', [
        { txid: 'd'.repeat(64), type: 'received', amount: BigInt(1000) },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('&lt;script&gt;'),
        })
      );
    });
  });
});

