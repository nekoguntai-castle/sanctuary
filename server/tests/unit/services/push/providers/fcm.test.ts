/**
 * Firebase Cloud Messaging Provider Tests
 *
 * Tests for the FCM push notification provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock fs
const mockAccessSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({
  accessSync: mockAccessSync,
  readFileSync: mockReadFileSync,
  constants: { R_OK: 4 },
}));

// Mock jsonwebtoken
const mockJwtSign = vi.hoisted(() => vi.fn());
vi.mock('jsonwebtoken', () => ({
  sign: mockJwtSign,
}));

// Mock fetch
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import {
  FCMPushProvider,
  isFCMConfigured,
  _resetFCMConfiguredCache,
} from '../../../../../src/services/push/providers/fcm';
import type { PushMessage } from '../../../../../src/services/push/types';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_URL =
  'https://fcm.googleapis.com/v1/projects/test-project-123/messages:send';

describe('FCMPushProvider', () => {
  let provider: FCMPushProvider;
  const originalEnv = { ...process.env };

  const mockServiceAccount = {
    client_email: 'firebase@project.iam.gserviceaccount.com',
    private_key:
      '-----BEGIN RSA PRIVATE KEY-----\nMockKey\n-----END RSA PRIVATE KEY-----',
    project_id: 'test-project-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv };

    // Default configured state
    process.env.FCM_SERVICE_ACCOUNT = '/path/to/service-account.json';

    mockAccessSync.mockReturnValue(undefined); // File exists
    mockReadFileSync.mockReturnValue(JSON.stringify(mockServiceAccount));
    mockJwtSign.mockReturnValue('mock-jwt-assertion');

    provider = new FCMPushProvider();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should have correct name', () => {
      expect(provider.name).toBe('fcm');
    });

    it('should have correct priority', () => {
      expect(provider.priority).toBe(100);
    });

    it('should have Android platform', () => {
      expect(provider.platform).toBe('android');
    });
  });

  describe('isConfigured', () => {
    it('should return true when service account file exists', () => {
      // Provider was constructed with valid env/mocks in beforeEach
      expect(provider.isConfigured()).toBe(true);
    });

    it('should return false when FCM_SERVICE_ACCOUNT is missing', () => {
      delete process.env.FCM_SERVICE_ACCOUNT;
      // Must create new provider after changing env, since config is cached at construction
      const unconfiguredProvider = new FCMPushProvider();
      expect(unconfiguredProvider.isConfigured()).toBe(false);
    });

    it('should return false when service account file does not exist', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      // Must create new provider after changing mock, since config is cached at construction
      const unconfiguredProvider = new FCMPushProvider();
      expect(unconfiguredProvider.isConfigured()).toBe(false);
    });

    it('should throw when cached service account is missing', () => {
      (provider as any).serviceAccountCache = null;
      expect(() => (provider as any).getServiceAccount()).toThrow(
        'FCM not configured: missing or unreadable FCM_SERVICE_ACCOUNT',
      );
    });
  });

  describe('send', () => {
    const testMessage: PushMessage = {
      title: 'Test Notification',
      body: 'This is a test',
      data: { transactionId: 'tx-123' },
    };

    beforeEach(() => {
      // Mock OAuth token response
      mockFetch.mockImplementation(async (url: string) => {
        if (url === OAUTH_TOKEN_URL) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'mock-access-token',
              expires_in: 3600,
            }),
          };
        }
        // FCM API response
        return {
          ok: true,
          json: async () => ({ name: 'projects/test/messages/msg-123' }),
        };
      });
    });

    it('should return error when not configured', async () => {
      delete process.env.FCM_SERVICE_ACCOUNT;
      // Must create new provider after removing env, since config is cached at construction
      const unconfiguredProvider = new FCMPushProvider();
      const result = await unconfiguredProvider.send(
        'device-token',
        testMessage,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should send notification successfully', async () => {
      const result = await provider.send('device-token-abc', testMessage);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('projects/test/messages/msg-123');
    });

    it('should use correct FCM API URL with project ID', async () => {
      await provider.send('device-token', testMessage);

      // Find the FCM API call (not OAuth)
      const fcmCall = mockFetch.mock.calls.find(
        (call) => call[0] === FCM_SEND_URL,
      );
      expect(fcmCall?.[0]).toBe(FCM_SEND_URL);
    });

    it('should reject invalid service account project IDs before sending', async () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          ...mockServiceAccount,
          project_id: '../metadata',
        }),
      );
      const invalidProjectProvider = new FCMPushProvider();

      const result = await invalidProjectProvider.send(
        'device-token',
        testMessage,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('project_id is invalid');
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('fcm.googleapis.com'),
        expect.anything(),
      );
    });

    it('should include authorization header with access token', async () => {
      await provider.send('device-token', testMessage);

      const fcmCall = mockFetch.mock.calls.find(
        (call) => call[0] === FCM_SEND_URL,
      );
      expect(fcmCall?.[1].headers.Authorization).toBe(
        'Bearer mock-access-token',
      );
    });

    it('should include correct payload structure', async () => {
      await provider.send('device-token-xyz', {
        title: 'My Title',
        body: 'My Body',
        data: { key: 'value' },
      });

      const fcmCall = mockFetch.mock.calls.find(
        (call) => call[0] === FCM_SEND_URL,
      );
      const body = JSON.parse(fcmCall?.[1].body);

      expect(body.message.token).toBe('device-token-xyz');
      expect(body.message.notification.title).toBe('My Title');
      expect(body.message.notification.body).toBe('My Body');
      expect(body.message.data.key).toBe('value');
      expect(body.message.android.priority).toBe('high');
    });

    it('should handle empty data gracefully', async () => {
      await provider.send('device-token', {
        title: 'Title',
        body: 'Body',
      });

      const fcmCall = mockFetch.mock.calls.find(
        (call) => call[0] === FCM_SEND_URL,
      );
      const body = JSON.parse(fcmCall?.[1].body);

      expect(body.message.data).toEqual({});
    });

    it('should handle OAuth error', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url === OAUTH_TOKEN_URL) {
          return {
            ok: false,
            status: 401,
            text: async () => 'Invalid credentials',
          };
        }
        return { ok: true };
      });

      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('OAuth failed');
    });

    it('should handle FCM API error response', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url === OAUTH_TOKEN_URL) {
          return {
            ok: true,
            json: async () => ({ access_token: 'token', expires_in: 3600 }),
          };
        }
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: { message: 'Invalid registration token' },
            }),
        };
      });

      const result = await provider.send('invalid-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid registration token');
      expect(result.errorCode).toBe('device_token_invalid');
    });

    it('normalizes FCM unregistered detail errors to stable error codes', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url === OAUTH_TOKEN_URL) {
          return {
            ok: true,
            json: async () => ({ access_token: 'token', expires_in: 3600 }),
          };
        }
        return {
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({
              error: {
                message: 'Requested entity was not found.',
                details: [{ errorCode: 'UNREGISTERED' }],
              },
            }),
        };
      });

      const result = await provider.send('expired-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('device_token_unregistered');
    });

    it('does not treat generic FCM invalid argument responses as invalid tokens', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url === OAUTH_TOKEN_URL) {
          return {
            ok: true,
            json: async () => ({ access_token: 'token', expires_in: 3600 }),
          };
        }
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: {
                message: 'Invalid data payload',
                details: [{ errorCode: 'INVALID_ARGUMENT' }],
              },
            }),
        };
      });

      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('provider_rejected');
    });

    it('should handle non-JSON FCM error response', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url === OAUTH_TOKEN_URL) {
          return {
            ok: true,
            json: async () => ({ access_token: 'token', expires_in: 3600 }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        };
      });

      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
      expect(result.errorCode).toBe('provider_unavailable');
    });

    it('should fall back to HTTP status message when FCM error body is empty', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url === OAUTH_TOKEN_URL) {
          return {
            ok: true,
            json: async () => ({ access_token: 'token', expires_in: 3600 }),
          };
        }
        return {
          ok: false,
          status: 404,
          text: async () => '',
        };
      });

      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 404');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });

    it('should cache access token', async () => {
      // Send two notifications
      await provider.send('token1', testMessage);
      await provider.send('token2', testMessage);

      // OAuth should only be called once
      const oauthCalls = mockFetch.mock.calls.filter(
        (call) => call[0] === OAUTH_TOKEN_URL,
      );
      expect(oauthCalls).toHaveLength(1);
    });

    it('should cache service account', async () => {
      await provider.send('token1', testMessage);
      await provider.send('token2', testMessage);

      // File should only be read once
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it('should generate OAuth JWT with correct claims', async () => {
      await provider.send('device-token', testMessage);

      expect(mockJwtSign).toHaveBeenCalledWith(
        expect.objectContaining({
          iss: 'firebase@project.iam.gserviceaccount.com',
          scope: 'https://www.googleapis.com/auth/firebase.messaging',
          aud: 'https://oauth2.googleapis.com/token',
        }),
        mockServiceAccount.private_key,
        { algorithm: 'RS256' },
      );
    });
  });
});

describe('isFCMConfigured', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    _resetFCMConfiguredCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return true when service account file exists', () => {
    process.env.FCM_SERVICE_ACCOUNT = '/path/to/file.json';
    mockAccessSync.mockReturnValue(undefined);

    expect(isFCMConfigured()).toBe(true);
  });

  it('returns cached result on repeated calls without re-checking file access', () => {
    process.env.FCM_SERVICE_ACCOUNT = '/path/to/file.json';
    mockAccessSync.mockReturnValue(undefined);

    expect(isFCMConfigured()).toBe(true);
    expect(isFCMConfigured()).toBe(true);
    expect(mockAccessSync).toHaveBeenCalledTimes(1);
  });

  it('should return false when FCM_SERVICE_ACCOUNT is missing', () => {
    delete process.env.FCM_SERVICE_ACCOUNT;

    expect(isFCMConfigured()).toBe(false);
  });

  it('should return false when service account file does not exist', () => {
    process.env.FCM_SERVICE_ACCOUNT = '/nonexistent/file.json';
    mockAccessSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(isFCMConfigured()).toBe(false);
  });
});
