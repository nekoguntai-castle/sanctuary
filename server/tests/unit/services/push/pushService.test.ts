import { vi } from 'vitest';
/**
 * Push Service Tests
 *
 * Tests for push notification service including:
 * - Configuration checks
 * - Sending notifications to iOS and Android devices
 * - Transaction notification logic
 * - Invalid token handling
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock dead letter queue
vi.mock('../../../../src/services/deadLetterQueue', () => ({
  recordPushFailure: vi.fn(),
}));

// Mock providers module
const mockProvider = {
  name: 'mock-provider',
  send: vi.fn(),
  isHealthy: vi.fn().mockResolvedValue(true),
};
const mockRegistry = {
  getAll: vi.fn(() => [mockProvider]),
  getHealth: vi.fn().mockResolvedValue({
    healthyProviders: 1,
    providers: [{ name: 'mock', healthy: true }],
  }),
  shutdown: vi.fn(),
};

const mockHasConfiguredProviders = vi.fn();
const mockGetProviderForPlatform = vi.fn();

vi.mock('../../../../src/services/push/providers', () => ({
  createPushProviderRegistry: vi.fn(() => mockRegistry),
  initializePushProviders: vi.fn(),
  getProviderForPlatform: (...args: unknown[]) =>
    mockGetProviderForPlatform(...args),
  hasConfiguredProviders: (...args: unknown[]) =>
    mockHasConfiguredProviders(...args),
}));

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  isPushConfigured,
  sendPushNotification,
  notifyNewTransactions,
  getPushService,
} from '../../../../src/services/push/pushService';

describe('Push Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockHasConfiguredProviders.mockReturnValue(false);
    mockGetProviderForPlatform.mockReturnValue(null);
  });

  describe('isPushConfigured', () => {
    it('should return true when providers are configured', () => {
      // isPushConfigured checks env vars directly, so we test the sync check
      // The async version uses hasConfiguredProviders
      const original = process.env;
      process.env = {
        ...original,
        APNS_KEY_ID: 'key',
        APNS_TEAM_ID: 'team',
        APNS_KEY_PATH: '/path/to/key',
        APNS_BUNDLE_ID: 'com.app',
      };

      expect(isPushConfigured()).toBe(true);

      process.env = original;
    });

    it('should return false when no providers are configured', () => {
      const original = process.env;
      process.env = { ...original };
      delete process.env.APNS_KEY_ID;
      delete process.env.FCM_SERVICE_ACCOUNT;

      expect(isPushConfigured()).toBe(false);

      process.env = original;
    });
  });

  describe('sendPushNotification', () => {
    const userId = 'user-123';
    const message = {
      title: 'Test Notification',
      body: 'This is a test message',
      data: { txid: 'abc123' },
    };

    it('should send notification to device via provider', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'apns-token-123',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({ success: true });

      await sendPushNotification(userId, message);

      expect(mockProvider.send).toHaveBeenCalledWith('apns-token-123', message);
      expect(mockPrismaClient.pushDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('should send to multiple devices', async () => {
      const devices = [
        {
          id: 'device-1',
          userId,
          platform: 'ios',
          token: 'apns-token',
          lastUsedAt: new Date(),
        },
        {
          id: 'device-2',
          userId,
          platform: 'android',
          token: 'fcm-token',
          lastUsedAt: new Date(),
        },
      ];

      mockPrismaClient.pushDevice.findMany.mockResolvedValue(devices);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({ success: true });

      await sendPushNotification(userId, message);

      expect(mockProvider.send).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.pushDevice.update).toHaveBeenCalledTimes(2);
    });

    it('should skip when user has no devices', async () => {
      mockPrismaClient.pushDevice.findMany.mockResolvedValue([]);

      await sendPushNotification(userId, message);

      expect(mockProvider.send).not.toHaveBeenCalled();
    });

    it('should not update lastUsedAt when send fails', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'apns-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({
        success: false,
        error: 'Some error',
      });

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.update).not.toHaveBeenCalled();
    });

    it('should remove device with invalid token (APNs 410)', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'expired-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockRejectedValue(new Error('410 Gone'));

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });

    it('should remove device with BadDeviceToken error', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'bad-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockRejectedValue(new Error('BadDeviceToken'));

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });

    it('should remove device with FCM registration-token-not-registered error', async () => {
      const device = {
        id: 'device-2',
        userId,
        platform: 'android',
        token: 'unregistered-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockRejectedValue(
        new Error('messaging/registration-token-not-registered'),
      );

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-2' },
      });
    });

    it('should not remove device on other errors', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockRejectedValue(new Error('Network timeout'));

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).not.toHaveBeenCalled();
    });

    it('should skip platforms without configured provider', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'windows',
        token: 'token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(null);

      await sendPushNotification(userId, message);

      expect(mockProvider.send).not.toHaveBeenCalled();
    });

    it('should remove invalid token when provider returns unsuccessful invalid-token response', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'expired-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({
        success: false,
        error: 'BadDeviceToken',
      });

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });

    it('should prefer structured invalid token error codes from provider results', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'android',
        token: 'expired-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({
        success: false,
        error: 'generic provider message',
        errorCode: 'device_token_unregistered',
      });

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });
  });

  describe('notifyNewTransactions', () => {
    const walletId = 'wallet-123';

    beforeEach(() => {
      // Configure provider
      mockHasConfiguredProviders.mockReturnValue(true);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({ success: true });
    });

    it('should skip when no transactions', async () => {
      await notifyNewTransactions(walletId, []);

      expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('should skip when push not configured', async () => {
      mockHasConfiguredProviders.mockReturnValue(false);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('should notify users with enabled notifications for received transaction', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: true,
                  notifySent: false,
                  notifyConsolidation: false,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([
        {
          id: 'd1',
          userId: 'user-1',
          platform: 'ios',
          token: 'token1',
          lastUsedAt: new Date(),
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(10000000) }, // 0.1 BTC
      ]);

      expect(mockProvider.send).toHaveBeenCalledWith(
        'token1',
        expect.objectContaining({
          title: expect.stringContaining('Received'),
          body: expect.stringContaining('My Wallet'),
        }),
      );
    });

    it('should not notify when wallet settings disabled', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: false, // Disabled
                  notifyReceived: true,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.pushDevice.findMany).not.toHaveBeenCalled();
    });

    it('should not notify when transaction type not enabled', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: false, // Not interested in received
                  notifySent: true,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      // Should not attempt to send notification
      expect(mockProvider.send).not.toHaveBeenCalled();
    });

    it('should skip users with no push devices', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: true,
                },
              },
            },
          },
          _count: { pushDevices: 0 }, // No devices
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.pushDevice.findMany).not.toHaveBeenCalled();
    });

    it('should notify for sent transactions', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: false,
                  notifySent: true,
                  notifyConsolidation: false,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([
        {
          id: 'd1',
          userId: 'user-1',
          platform: 'android',
          token: 'fcm-token',
          lastUsedAt: new Date(),
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'sent', amount: BigInt(-5000000) },
      ]);

      expect(mockProvider.send).toHaveBeenCalledWith(
        'fcm-token',
        expect.objectContaining({
          title: expect.stringContaining('Sent'),
        }),
      );
    });

    it('should notify for consolidation transactions', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: false,
                  notifySent: false,
                  notifyConsolidation: true,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([
        {
          id: 'd1',
          userId: 'user-1',
          platform: 'ios',
          token: 'token',
          lastUsedAt: new Date(),
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'consolidation', amount: BigInt(-1000) },
      ]);

      expect(mockProvider.send).toHaveBeenCalled();
    });

    it('should handle wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.user.findMany).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.wallet.findUnique.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw
      await expect(
        notifyNewTransactions(walletId, [
          { txid: 'tx1', type: 'received', amount: BigInt(100000) },
        ]),
      ).resolves.not.toThrow();
    });
  });

  describe('Invalid Token Detection', () => {
    const testCases = [
      { error: '410 Gone', shouldRemove: true, description: 'APNs 410 status' },
      {
        error: 'BadDeviceToken',
        shouldRemove: true,
        description: 'APNs BadDeviceToken',
      },
      {
        error: 'Unregistered',
        shouldRemove: true,
        description: 'APNs Unregistered',
      },
      {
        error: 'messaging/registration-token-not-registered',
        shouldRemove: true,
        description: 'FCM not registered',
      },
      {
        error: 'messaging/invalid-registration-token',
        shouldRemove: true,
        description: 'FCM invalid token',
      },
      {
        error: 'InvalidRegistration',
        shouldRemove: true,
        description: 'FCM legacy error',
      },
      {
        error: 'Network timeout',
        shouldRemove: false,
        description: 'network error',
      },
      {
        error: 'Server error',
        shouldRemove: false,
        description: 'server error',
      },
    ];

    it.each(testCases)(
      'should $shouldRemove remove device on $description',
      async ({ error, shouldRemove }) => {
        const device = {
          id: 'device-1',
          userId: 'user-1',
          platform: 'ios',
          token: 'token',
          lastUsedAt: new Date(),
        };

        mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
        mockGetProviderForPlatform.mockReturnValue(mockProvider);
        mockProvider.send.mockRejectedValue(new Error(error));

        await sendPushNotification('user-1', { title: 'Test', body: 'Test' });

        if (shouldRemove) {
          expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalled();
        } else {
          expect(mockPrismaClient.pushDevice.delete).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe('service helpers', () => {
    it('getProviders returns empty before initialization and provider names after initialization', async () => {
      const service = getPushService();
      await service.shutdown();

      expect(service.getProviders()).toEqual([]);

      await service.initialize();
      expect(service.getProviders()).toEqual(['mock-provider']);
    });

    it('healthCheck returns provider health map', async () => {
      mockRegistry.getHealth.mockResolvedValueOnce({
        healthyProviders: 1,
        providers: [
          { name: 'apns', healthy: true },
          { name: 'fcm', healthy: false },
        ],
      });

      const service = getPushService();
      const health = await service.healthCheck();

      expect(health).toEqual({
        healthy: true,
        providers: {
          apns: true,
          fcm: false,
        },
      });
    });

    it('shutdown calls registry shutdown and resets initialization state', async () => {
      const service = getPushService();
      await service.initialize();

      await service.shutdown();

      expect(mockRegistry.shutdown).toHaveBeenCalled();
      expect(service.getProviders()).toEqual([]);
    });
  });

  describe('isPushConfigured fcm file path', () => {
    it('returns true when readable FCM service account path is configured', () => {
      const fs = require('fs');
      const accessSpy = vi
        .spyOn(fs, 'accessSync')
        .mockImplementation(() => undefined);

      const original = process.env;
      process.env = { ...original };
      delete process.env.APNS_KEY_ID;
      delete process.env.APNS_TEAM_ID;
      delete process.env.APNS_KEY_PATH;
      delete process.env.APNS_BUNDLE_ID;
      process.env.FCM_SERVICE_ACCOUNT = '/tmp/fcm-service-account.json';

      expect(isPushConfigured()).toBe(true);

      accessSpy.mockRestore();
      process.env = original;
    });
  });
});
