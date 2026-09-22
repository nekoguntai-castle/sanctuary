/**
 * Apple Push Notification Service (APNs) Tests
 *
 * Tests the APNs service for iOS push notifications.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mutable state
const { mockSend, mockShutdown, MockProvider, MockNotification, mockLogger, mockConfigRef, shouldThrowOnConstruct } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const mockShutdown = vi.fn();
  const shouldThrowOnConstruct = { value: false };

  class MockProvider {
    send = mockSend;
    shutdown = mockShutdown;
    constructor() {
      if (shouldThrowOnConstruct.value) {
        throw new Error('Invalid key format');
      }
    }
  }

  class MockNotification {
    alert: any;
    topic: string = '';
    sound: string = 'default';
    badge?: number;
    payload: any = {};
    pushType: string = 'alert';
  }

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const mockConfigRef = {
    current: {
      apns: {
        keyId: 'KEY123',
        teamId: 'TEAM456',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        production: false,
        bundleId: 'com.sanctuary.app',
      },
    },
  };

  return { mockSend, mockShutdown, MockProvider, MockNotification, mockLogger, mockConfigRef, shouldThrowOnConstruct };
});

vi.mock('@parse/node-apn', () => ({
  default: {
    Provider: MockProvider,
    Notification: MockNotification,
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/config', () => ({
  get config() {
    return mockConfigRef.current;
  },
}));

// Import after mocks
let apns: typeof import('../../../../src/services/push/apns');

describe('APNs Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset config to valid state
    mockConfigRef.current = {
      apns: {
        keyId: 'KEY123',
        teamId: 'TEAM456',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        production: false,
        bundleId: 'com.sanctuary.app',
      },
    };

    // Re-import module to reset internal state
    apns = await import('../../../../src/services/push/apns');
  });

  describe('initializeAPNs', () => {
    it('should initialize APNs provider with credentials', () => {
      const result = apns.initializeAPNs();

      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'APNs initialized successfully',
        { production: false }
      );
    });

    it('should return true when already initialized', () => {
      apns.initializeAPNs(); // First call
      mockLogger.info.mockClear();

      const result = apns.initializeAPNs(); // Second call

      expect(result).toBe(true);
      // Should not log again - already initialized
    });

    it('should return false when credentials are not configured', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        apns: {
          keyId: '',
          teamId: '',
          privateKey: '',
          production: false,
          bundleId: '',
        },
      };
      const apnsNoConfig = await import('../../../../src/services/push/apns');

      const result = apnsNoConfig.initializeAPNs();

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'APNs not configured - iOS push notifications disabled'
      );
    });

    it('should return false when missing keyId', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        apns: {
          keyId: '',
          teamId: 'TEAM',
          privateKey: 'key',
          production: false,
          bundleId: 'bundle',
        },
      };
      const apnsMissingKey = await import('../../../../src/services/push/apns');

      const result = apnsMissingKey.initializeAPNs();

      expect(result).toBe(false);
    });

    it('should return false when missing teamId', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        apns: {
          keyId: 'KEY',
          teamId: '',
          privateKey: 'key',
          production: false,
          bundleId: 'bundle',
        },
      };
      const apnsMissingTeam = await import('../../../../src/services/push/apns');

      const result = apnsMissingTeam.initializeAPNs();

      expect(result).toBe(false);
    });

    it('should return false and log error when Provider constructor throws', async () => {
      vi.resetModules();
      shouldThrowOnConstruct.value = true;

      const apnsThrowing = await import('../../../../src/services/push/apns');
      const result = apnsThrowing.initializeAPNs();

      shouldThrowOnConstruct.value = false;

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize APNs',
        { error: 'Invalid key format' }
      );
    });
  });

  describe('isAPNsAvailable', () => {
    it('should return true after successful initialization', () => {
      apns.initializeAPNs();

      expect(apns.isAPNsAvailable()).toBe(true);
    });

    it('should return false before initialization', async () => {
      vi.resetModules();
      const freshApns = await import('../../../../src/services/push/apns');

      expect(freshApns.isAPNsAvailable()).toBe(false);
    });
  });

  describe('shutdownAPNs', () => {
    it('should shutdown provider when initialized', () => {
      apns.initializeAPNs();

      apns.shutdownAPNs();

      expect(mockShutdown).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('APNs provider shutdown');
    });

    it('should do nothing when not initialized', async () => {
      vi.resetModules();
      const freshApns = await import('../../../../src/services/push/apns');

      freshApns.shutdownAPNs();

      expect(mockShutdown).not.toHaveBeenCalled();
    });

    it('should allow reinitialization after shutdown', () => {
      apns.initializeAPNs();
      apns.shutdownAPNs();

      expect(apns.isAPNsAvailable()).toBe(false);
    });
  });

  describe('sendToDevice', () => {
    beforeEach(() => {
      apns.initializeAPNs();
    });

    it('should send notification to single device', async () => {
      mockSend.mockResolvedValue({
        sent: [{ device: 'device-token' }],
        failed: [],
      });

      const result = await apns.sendToDevice('device-token', {
        title: 'Test Title',
        body: 'Test Body',
        data: { key: 'value' },
        badge: 1,
        sound: 'custom.caf',
      });

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('APNs notification sent');
    });

    it('should return error when APNs not initialized', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        apns: { keyId: '', teamId: '', privateKey: '', production: false, bundleId: '' },
      };
      const freshApns = await import('../../../../src/services/push/apns');

      const result = await freshApns.sendToDevice('token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('APNs not initialized');
    });

    it('should return invalid_token error for BadDeviceToken', async () => {
      mockSend.mockResolvedValue({
        sent: [],
        failed: [
          {
            device: 'bad-token',
            response: { reason: 'BadDeviceToken' },
          },
        ],
      });

      const result = await apns.sendToDevice('bad-token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_token');
    });

    it('should return invalid_token error for Unregistered device', async () => {
      mockSend.mockResolvedValue({
        sent: [],
        failed: [
          {
            device: 'old-token',
            response: { reason: 'Unregistered' },
          },
        ],
      });

      const result = await apns.sendToDevice('old-token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_token');
    });

    it('should return error message for other failures', async () => {
      mockSend.mockResolvedValue({
        sent: [],
        failed: [
          {
            device: 'token',
            response: { reason: 'ServiceUnavailable' },
          },
        ],
      });

      const result = await apns.sendToDevice('token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('ServiceUnavailable');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'APNs send failed',
        expect.objectContaining({
          reason: 'ServiceUnavailable',
        })
      );
    });

    it('should handle unknown failure reason', async () => {
      mockSend.mockResolvedValue({
        sent: [],
        failed: [
          {
            device: 'token',
            response: {},
          },
        ],
      });

      const result = await apns.sendToDevice('token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('unknown');
    });

    it('should handle send exception', async () => {
      mockSend.mockRejectedValue(new Error('Network error'));

      const result = await apns.sendToDevice('token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'APNs send error',
        { error: 'Network error' }
      );
    });

    it('should use default sound when not specified', async () => {
      mockSend.mockResolvedValue({
        sent: [{ device: 'token' }],
        failed: [],
      });

      await apns.sendToDevice('token', {
        title: 'Test',
        body: 'Test',
      });

      // Sound defaults to 'default' in the implementation
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('sendToDevices', () => {
    beforeEach(() => {
      apns.initializeAPNs();
    });

    it('should send notification to multiple devices', async () => {
      mockSend.mockResolvedValue({
        sent: [
          { device: 'token-1' },
          { device: 'token-2' },
          { device: 'token-3' },
        ],
        failed: [],
      });

      const result = await apns.sendToDevices(
        ['token-1', 'token-2', 'token-3'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.invalidTokens).toHaveLength(0);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'APNs multicast sent',
        { success: 3, failed: 0 }
      );
    });

    it('should return all failed when APNs not initialized', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        apns: { keyId: '', teamId: '', privateKey: '', production: false, bundleId: '' },
      };
      const freshApns = await import('../../../../src/services/push/apns');

      const result = await freshApns.sendToDevices(
        ['token-1', 'token-2'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.invalidTokens).toHaveLength(0);
    });

    it('should handle empty token list', async () => {
      const result = await apns.sendToDevices([], { title: 'Test', body: 'Test' });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.invalidTokens).toHaveLength(0);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should collect invalid tokens from failures', async () => {
      mockSend.mockResolvedValue({
        sent: [{ device: 'valid-token' }],
        failed: [
          { device: 'bad-token', response: { reason: 'BadDeviceToken' } },
          { device: 'old-token', response: { reason: 'Unregistered' } },
        ],
      });

      const result = await apns.sendToDevices(
        ['valid-token', 'bad-token', 'old-token'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.invalidTokens).toEqual(['bad-token', 'old-token']);
    });

    it('bounds provider fanout and preserves completed batches when a later batch fails', async () => {
      const tokens = Array.from({ length: 101 }, (_, index) => `token-${index}`);
      mockSend
        .mockResolvedValueOnce({
          sent: tokens.slice(0, 100).map((device) => ({ device })),
          failed: [],
        })
        .mockRejectedValueOnce(new Error('Network failure'));

      const result = await apns.sendToDevices(tokens, { title: 'Test', body: 'Test' });

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][1]).toHaveLength(100);
      expect(mockSend.mock.calls[1][1]).toEqual(['token-100']);
      expect(result).toEqual({ success: 100, failed: 1, invalidTokens: [] });
    });

    it('should not collect non-token-related errors as invalid tokens', async () => {
      mockSend.mockResolvedValue({
        sent: [],
        failed: [
          { device: 'token', response: { reason: 'ServiceUnavailable' } },
        ],
      });

      const result = await apns.sendToDevices(
        ['token'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.failed).toBe(1);
      expect(result.invalidTokens).toHaveLength(0);
    });

    it('should handle send exception', async () => {
      mockSend.mockRejectedValue(new Error('Network failure'));

      const result = await apns.sendToDevices(
        ['token-1', 'token-2'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.invalidTokens).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'APNs multicast error',
        { error: 'Network failure' }
      );
    });

    it('should include custom data payload', async () => {
      mockSend.mockResolvedValue({
        sent: [{ device: 'token' }],
        failed: [],
      });

      await apns.sendToDevices(
        ['token'],
        {
          title: 'Test',
          body: 'Test',
          data: { txid: 'abc123', type: 'transaction' },
        }
      );

      expect(mockSend).toHaveBeenCalled();
    });

    it('should include badge count when specified', async () => {
      mockSend.mockResolvedValue({
        sent: [{ device: 'token' }],
        failed: [],
      });

      await apns.sendToDevices(
        ['token'],
        {
          title: 'Test',
          body: 'Test',
          badge: 5,
        }
      );

      expect(mockSend).toHaveBeenCalled();
    });
  });
});
