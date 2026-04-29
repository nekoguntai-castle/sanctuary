/**
 * Apple Push Notification Service Provider Tests
 *
 * Tests for the APNs push notification provider.
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
const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
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
  APNsPushProvider,
  isAPNsConfigured,
} from '../../../../../src/services/push/providers/apns';
import type { PushMessage } from '../../../../../src/services/push/types';

describe('APNsPushProvider', () => {
  let provider: APNsPushProvider;
  const originalEnv = { ...process.env };

  const mockPrivateKey = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIDYHOxgLfR...mock...key
-----END EC PRIVATE KEY-----`;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv };

    // Default configured state
    process.env.APNS_KEY_ID = 'KEYID123';
    process.env.APNS_TEAM_ID = 'TEAMID456';
    process.env.APNS_KEY_PATH = '/path/to/key.p8';
    process.env.APNS_BUNDLE_ID = 'com.example.app';

    mockReadFileSync.mockReturnValue(mockPrivateKey);
    mockJwtSign.mockReturnValue('mock-jwt-token');

    provider = new APNsPushProvider();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should have correct name', () => {
      expect(provider.name).toBe('apns');
    });

    it('should have correct priority', () => {
      expect(provider.priority).toBe(100);
    });

    it('should have iOS platform', () => {
      expect(provider.platform).toBe('ios');
    });

    it('should tolerate unreadable key files at construction', () => {
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error('permission denied');
      });

      const instance = new APNsPushProvider();
      expect(instance.name).toBe('apns');
    });

    it('should skip key file loading when APNS_KEY_PATH is not set', () => {
      vi.clearAllMocks();
      delete process.env.APNS_KEY_PATH;

      const instance = new APNsPushProvider();
      expect(instance.name).toBe('apns');
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });
  });

  describe('isConfigured', () => {
    it('should return true when all env vars are set', () => {
      expect(provider.isConfigured()).toBe(true);
    });

    it('should return false when APNS_KEY_ID is missing', () => {
      delete process.env.APNS_KEY_ID;
      expect(provider.isConfigured()).toBe(false);
    });

    it('should return false when APNS_TEAM_ID is missing', () => {
      delete process.env.APNS_TEAM_ID;
      expect(provider.isConfigured()).toBe(false);
    });

    it('should return false when APNS_KEY_PATH is missing', () => {
      delete process.env.APNS_KEY_PATH;
      expect(provider.isConfigured()).toBe(false);
    });

    it('should return false when APNS_BUNDLE_ID is missing', () => {
      delete process.env.APNS_BUNDLE_ID;
      expect(provider.isConfigured()).toBe(false);
    });

    it('should return false when all env vars are missing', () => {
      delete process.env.APNS_KEY_ID;
      delete process.env.APNS_TEAM_ID;
      delete process.env.APNS_KEY_PATH;
      delete process.env.APNS_BUNDLE_ID;
      expect(provider.isConfigured()).toBe(false);
    });
  });

  describe('send', () => {
    const testMessage: PushMessage = {
      title: 'Test Notification',
      body: 'This is a test',
      data: { transactionId: 'tx-123' },
    };

    it('should return error when not configured', async () => {
      delete process.env.APNS_KEY_ID;
      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('getToken throws when required env vars are missing', () => {
      delete process.env.APNS_KEY_ID;

      expect(() => (provider as any).getToken()).toThrow(
        'APNs not configured: missing APNS_KEY_ID, APNS_TEAM_ID, or APNS_KEY_PATH',
      );
    });

    it('sendNotification returns explicit config error when bundle ID is missing', async () => {
      delete process.env.APNS_BUNDLE_ID;

      const result = await (provider as any).sendNotification(
        'device-token',
        testMessage,
      );

      expect(result).toEqual({
        success: false,
        error: 'APNs not configured (missing APNS_BUNDLE_ID)',
        errorCode: 'provider_not_configured',
      });
    });

    it('should send notification successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'notification-id-123']]),
      });

      const result = await provider.send('device-token-abc', testMessage);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should use sandbox host by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      await provider.send('device-token', testMessage);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.sandbox.push.apple.com'),
        expect.any(Object),
      );
    });

    it('should use production host when APNS_PRODUCTION is true', async () => {
      process.env.APNS_PRODUCTION = 'true';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      await provider.send('device-token', testMessage);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.push.apple.com'),
        expect.any(Object),
      );
    });

    it('should include device token in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      await provider.send('my-device-token-xyz', testMessage);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/3/device/my-device-token-xyz'),
        expect.any(Object),
      );
    });

    it('should include authorization header with bearer token', async () => {
      mockJwtSign.mockReturnValue('test-jwt-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      await provider.send('device-token', testMessage);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers.authorization).toBe('bearer test-jwt-token');
    });

    it('should include apns-topic header with bundle ID', async () => {
      process.env.APNS_BUNDLE_ID = 'com.test.myapp';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      await provider.send('device-token', testMessage);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers['apns-topic']).toBe('com.test.myapp');
    });

    it('should include correct payload structure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      await provider.send('device-token', {
        title: 'My Title',
        body: 'My Body',
        data: { key: 'value' },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.aps.alert.title).toBe('My Title');
      expect(body.aps.alert.body).toBe('My Body');
      expect(body.aps.sound).toBe('default');
      expect(body.key).toBe('value'); // Custom data at root level
    });

    it('should handle APNs error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ reason: 'BadDeviceToken' }),
      });

      const result = await provider.send('invalid-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('BadDeviceToken');
      expect(result.errorCode).toBe('device_token_invalid');
    });

    it('normalizes APNs unregistered responses to stable error codes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        text: async () => JSON.stringify({ reason: 'Unregistered' }),
      });

      const result = await provider.send('expired-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('device_token_unregistered');
    });

    it('normalizes APNs auth and throttling responses to stable error codes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ reason: 'Forbidden' }),
      });
      const authResult = await provider.send('device-token', testMessage);
      expect(authResult.errorCode).toBe('provider_auth_failed');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ reason: 'TooManyRequests' }),
      });
      const rateLimitedResult = await provider.send(
        'device-token',
        testMessage,
      );
      expect(rateLimitedResult.errorCode).toBe('provider_rate_limited');
    });

    it('should handle non-JSON error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
      expect(result.errorCode).toBe('provider_unavailable');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await provider.send('device-token', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should cache JWT token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      // Send two notifications
      await provider.send('token1', testMessage);
      await provider.send('token2', testMessage);

      // JWT should only be generated once (cached)
      expect(mockJwtSign).toHaveBeenCalledTimes(1);
    });

    it('should generate JWT with correct options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      await provider.send('device-token', testMessage);

      expect(mockJwtSign).toHaveBeenCalledWith(
        {},
        mockPrivateKey,
        expect.objectContaining({
          algorithm: 'ES256',
          keyid: 'KEYID123',
          issuer: 'TEAMID456',
          expiresIn: '55m',
        }),
      );
    });

    it('should read key file during token generation when constructor cache is unavailable', async () => {
      vi.clearAllMocks();
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error('read denied at startup');
      });
      const uncachedProvider = new APNsPushProvider();

      mockReadFileSync.mockImplementation(() => mockPrivateKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['apns-id', 'msg-id']]),
      });

      const result = await uncachedProvider.send(
        'device-token-uncached',
        testMessage,
      );
      expect(result.success).toBe(true);
      expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });

    it('falls back to HTTP status text when APNs error body is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '',
      });

      const result = await provider.send('device-token', testMessage);
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 429');
    });

    it('returns success with undefined messageId when APNs response omits apns-id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
      });

      const result = await provider.send('device-token', testMessage);
      expect(result).toEqual({
        success: true,
        messageId: undefined,
      });
    });
  });
});

describe('isAPNsConfigured', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return true when all env vars are set', () => {
    process.env.APNS_KEY_ID = 'key';
    process.env.APNS_TEAM_ID = 'team';
    process.env.APNS_KEY_PATH = '/path';
    process.env.APNS_BUNDLE_ID = 'bundle';

    expect(isAPNsConfigured()).toBe(true);
  });

  it('should return false when any env var is missing', () => {
    process.env.APNS_KEY_ID = 'key';
    // Missing other vars

    expect(isAPNsConfigured()).toBe(false);
  });
});
