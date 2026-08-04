/**
 * Firebase Cloud Messaging (FCM) Service Tests
 *
 * Tests the FCM service for Android push notifications.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mutable state
const { mockApp, mockSend, mockSendEachForMulticast, mockMessaging, mockCert, mockInitializeApp, mockLogger, mockConfigRef } = vi.hoisted(() => {
  const mockApp = { name: 'mock-app' };
  const mockSend = vi.fn();
  const mockSendEachForMulticast = vi.fn();
  const mockMessaging = vi.fn(() => ({
    send: mockSend,
    sendEachForMulticast: mockSendEachForMulticast,
  }));
  const mockCert = vi.fn(() => 'mock-credential');
  const mockInitializeApp = vi.fn(() => mockApp);
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  const mockConfigRef = {
    current: {
      fcm: {
        projectId: 'test-project',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        clientEmail: 'test@test.iam.gserviceaccount.com',
      },
    },
  };
  return { mockApp, mockSend, mockSendEachForMulticast, mockMessaging, mockCert, mockInitializeApp, mockLogger, mockConfigRef };
});

vi.mock('firebase-admin/app', () => ({
  cert: mockCert,
  initializeApp: mockInitializeApp,
}));

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: mockMessaging,
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
let fcm: typeof import('../../../../src/services/push/fcm');

describe('FCM Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset config to valid state
    mockConfigRef.current = {
      fcm: {
        projectId: 'test-project',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        clientEmail: 'test@test.iam.gserviceaccount.com',
      },
    };

    // Re-import module to reset internal state
    fcm = await import('../../../../src/services/push/fcm');
  });

  describe('initializeFCM', () => {
    it('should initialize Firebase Admin SDK with credentials', () => {
      const result = fcm.initializeFCM();

      expect(result).toBe(true);
      expect(mockInitializeApp).toHaveBeenCalled();
      expect(mockMessaging).toHaveBeenCalledWith(mockApp);
      expect(mockCert).toHaveBeenCalledWith({
        projectId: 'test-project',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        clientEmail: 'test@test.iam.gserviceaccount.com',
      });
      expect(mockLogger.info).toHaveBeenCalledWith('FCM initialized successfully');
    });

    it('should return true when already initialized', () => {
      fcm.initializeFCM(); // First call
      mockInitializeApp.mockClear();

      const result = fcm.initializeFCM(); // Second call

      expect(result).toBe(true);
      expect(mockInitializeApp).not.toHaveBeenCalled();
    });

    it('should return false when credentials are not configured', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        fcm: {
          projectId: '',
          privateKey: '',
          clientEmail: '',
        },
      };
      const fcmNoConfig = await import('../../../../src/services/push/fcm');

      const result = fcmNoConfig.initializeFCM();

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'FCM not configured - Android push notifications disabled'
      );
    });

    it('should return false when missing projectId', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        fcm: {
          projectId: '',
          privateKey: 'key',
          clientEmail: 'email',
        },
      };
      const fcmNoProject = await import('../../../../src/services/push/fcm');

      const result = fcmNoProject.initializeFCM();

      expect(result).toBe(false);
    });

    it('should return false when Firebase initialization throws', async () => {
      vi.resetModules();
      mockInitializeApp.mockImplementationOnce(() => {
        throw new Error('Firebase init error');
      });

      const fcmWithError = await import('../../../../src/services/push/fcm');
      const result = fcmWithError.initializeFCM();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize FCM',
        { error: 'Firebase init error' }
      );
    });
  });

  describe('isFCMAvailable', () => {
    it('should return true after successful initialization', () => {
      fcm.initializeFCM();

      expect(fcm.isFCMAvailable()).toBe(true);
    });

    it('should return false before initialization', async () => {
      vi.resetModules();
      const freshFcm = await import('../../../../src/services/push/fcm');

      expect(freshFcm.isFCMAvailable()).toBe(false);
    });
  });

  describe('sendToDevice', () => {
    beforeEach(() => {
      fcm.initializeFCM();
    });

    it('should send notification to single device', async () => {
      mockSend.mockResolvedValue('message-id-123');

      const result = await fcm.sendToDevice('device-token', {
        title: 'Test Title',
        body: 'Test Body',
        data: { key: 'value' },
      });

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith({
        token: 'device-token',
        notification: {
          title: 'Test Title',
          body: 'Test Body',
        },
        data: { key: 'value' },
        android: {
          priority: 'high',
          notification: {
            channelId: 'sanctuary_transactions',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'FCM notification sent',
        { messageId: 'message-id-123' }
      );
    });

    it('should return error when FCM not initialized', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        fcm: { projectId: '', privateKey: '', clientEmail: '' },
      };
      const freshFcm = await import('../../../../src/services/push/fcm');

      const result = await freshFcm.sendToDevice('token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FCM not initialized');
    });

    it('should return invalid_token error for invalid registration token', async () => {
      const firebaseError = new Error('Invalid token') as any;
      firebaseError.code = 'messaging/invalid-registration-token';
      mockSend.mockRejectedValue(firebaseError);

      const result = await fcm.sendToDevice('invalid-token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_token');
    });

    it('should return invalid_token error for unregistered token', async () => {
      const firebaseError = new Error('Token not registered') as any;
      firebaseError.code = 'messaging/registration-token-not-registered';
      mockSend.mockRejectedValue(firebaseError);

      const result = await fcm.sendToDevice('old-token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_token');
    });

    it('should return error message for other errors', async () => {
      const firebaseError = new Error('Network error') as any;
      firebaseError.code = 'messaging/server-unavailable';
      mockSend.mockRejectedValue(firebaseError);

      const result = await fcm.sendToDevice('token', {
        title: 'Test',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'FCM send error',
        expect.objectContaining({
          error: 'Network error',
          code: 'messaging/server-unavailable',
        })
      );
    });
  });

  describe('sendToDevices', () => {
    beforeEach(() => {
      fcm.initializeFCM();
    });

    it('should send notification to multiple devices', async () => {
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 3,
        failureCount: 0,
        responses: [
          { success: true },
          { success: true },
          { success: true },
        ],
      });

      const result = await fcm.sendToDevices(
        ['token-1', 'token-2', 'token-3'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.invalidTokens).toHaveLength(0);
      expect(mockSendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['token-1', 'token-2', 'token-3'],
        notification: { title: 'Test', body: 'Test' },
        data: undefined,
        android: expect.objectContaining({
          priority: 'high',
        }),
      });
    });

    it('should return all failed when FCM not initialized', async () => {
      vi.resetModules();
      mockConfigRef.current = {
        fcm: { projectId: '', privateKey: '', clientEmail: '' },
      };
      const freshFcm = await import('../../../../src/services/push/fcm');

      const result = await freshFcm.sendToDevices(
        ['token-1', 'token-2'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.invalidTokens).toHaveLength(0);
    });

    it('should handle empty token list', async () => {
      const result = await fcm.sendToDevices([], { title: 'Test', body: 'Test' });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.invalidTokens).toHaveLength(0);
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should collect invalid tokens from responses', async () => {
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 2,
        responses: [
          { success: true },
          {
            success: false,
            error: { code: 'messaging/invalid-registration-token' },
          },
          {
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          },
        ],
      });

      const result = await fcm.sendToDevices(
        ['valid-token', 'invalid-token', 'unregistered-token'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.invalidTokens).toEqual(['invalid-token', 'unregistered-token']);
    });

    it('should not collect non-token-related errors as invalid tokens', async () => {
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [
          {
            success: false,
            error: { code: 'messaging/server-unavailable' },
          },
        ],
      });

      const result = await fcm.sendToDevices(
        ['token'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.failed).toBe(1);
      expect(result.invalidTokens).toHaveLength(0);
    });

    it('should handle multicast error', async () => {
      mockSendEachForMulticast.mockRejectedValue(new Error('Network failure'));

      const result = await fcm.sendToDevices(
        ['token-1', 'token-2'],
        { title: 'Test', body: 'Test' }
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.invalidTokens).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'FCM multicast error',
        { error: 'Network failure' }
      );
    });

    it('should log debug info on success', async () => {
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 2,
        failureCount: 1,
        responses: [
          { success: true },
          { success: true },
          { success: false, error: { code: 'messaging/quota-exceeded' } },
        ],
      });

      await fcm.sendToDevices(
        ['t1', 't2', 't3'],
        { title: 'Test', body: 'Test' }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'FCM multicast sent',
        { success: 2, failed: 1 }
      );
    });
  });
});
