import { vi } from 'vitest';
/**
 * Push Service cleanup-failure tests
 *
 * Post-send device bookkeeping (last-used update, invalid-token removal) must
 * never fail a delivered push or stop the remaining devices from being notified.
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
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import { sendPushNotification } from '../../../../src/services/push/pushService';

describe('Push Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockHasConfiguredProviders.mockReturnValue(false);
    mockGetProviderForPlatform.mockReturnValue(null);
  });

  describe('sendPushNotification cleanup failures', () => {
    const userId = 'user-123';
    const message = { title: 'T', body: 'B' };
    const deviceA = { id: 'device-a', userId, platform: 'ios', token: 'token-a', lastUsedAt: new Date() };
    const deviceB = { id: 'device-b', userId, platform: 'ios', token: 'token-b', lastUsedAt: new Date() };
    const gone = Object.assign(new Error('Record to delete does not exist'), { code: 'P2025' });

    function failDeletes(error: Error) {
      mockPrismaClient.pushDevice.delete.mockRejectedValue(error);
      mockPrismaClient.pushDevice.deleteMany.mockRejectedValue(error);
    }

    function failUpdates(error: Error) {
      mockPrismaClient.pushDevice.update.mockRejectedValue(error);
      mockPrismaClient.pushDevice.updateMany.mockRejectedValue(error);
    }

    it('keeps notifying remaining devices when removing an invalid-token device fails', async () => {
      mockPrismaClient.pushDevice.findMany.mockResolvedValue([deviceA, deviceB]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send
        .mockRejectedValueOnce(new Error('410 Gone'))
        .mockResolvedValueOnce({ success: true });
      failDeletes(gone);

      await expect(sendPushNotification(userId, message)).resolves.toBeUndefined();

      expect(mockProvider.send).toHaveBeenCalledTimes(2);
      expect(mockProvider.send).toHaveBeenLastCalledWith('token-b', message);
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Removed invalid'));
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('cleanup failed for device device-a'));
    });

    it('does not record a push failure when last-used update fails after a delivered push', async () => {
      const { recordPushFailure } = await import('../../../../src/services/deadLetterQueue');
      mockPrismaClient.pushDevice.findMany.mockResolvedValue([deviceA]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({ success: true });
      failUpdates(gone);

      await sendPushNotification(userId, message);

      expect(recordPushFailure).not.toHaveBeenCalled();
    });

    it('does not record a push failure when invalid-token removal fails on a resolved result', async () => {
      const { recordPushFailure } = await import('../../../../src/services/deadLetterQueue');
      mockPrismaClient.pushDevice.findMany.mockResolvedValue([deviceA]);
      mockGetProviderForPlatform.mockReturnValue(mockProvider);
      mockProvider.send.mockResolvedValue({
        success: false,
        error: 'generic provider message',
        errorCode: 'device_token_unregistered',
      });
      failDeletes(new Error('database unavailable'));

      await expect(sendPushNotification(userId, message)).resolves.toBeUndefined();

      expect(recordPushFailure).not.toHaveBeenCalled();
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Removed invalid'));
    });
  });
});
