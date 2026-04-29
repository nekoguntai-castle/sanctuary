/**
 * Base Push Provider Tests
 *
 * Tests for the abstract BasePushProvider class and isInvalidTokenError function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { BasePushProvider } from '../../../../../src/services/push/providers/base';
import { isInvalidTokenError } from '../../../../../src/services/push/types';
import type {
  PushMessage,
  PushResult,
  PushPlatform,
} from '../../../../../src/services/push/types';

// Concrete implementation for testing the abstract class
class TestPushProvider extends BasePushProvider {
  public configured: boolean = true;
  public shouldThrow: boolean = false;
  public throwError: Error | null = null;
  public mockResult: PushResult = { success: true, messageId: 'test-123' };

  constructor(config?: {
    name?: string;
    priority?: number;
    platform?: PushPlatform;
  }) {
    super({
      name: config?.name || 'test',
      priority: config?.priority || 50,
      platform: config?.platform || 'ios',
    });
  }

  isConfigured(): boolean {
    return this.configured;
  }

  protected async sendNotification(
    _deviceToken: string,
    _message: PushMessage,
  ): Promise<PushResult> {
    if (this.shouldThrow) {
      throw this.throwError || new Error('Test error');
    }
    return this.mockResult;
  }
}

describe('BasePushProvider', () => {
  let provider: TestPushProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TestPushProvider();
  });

  describe('constructor', () => {
    it('should set name from config', () => {
      const p = new TestPushProvider({ name: 'my-provider' });
      expect(p.name).toBe('my-provider');
    });

    it('should set priority from config', () => {
      const p = new TestPushProvider({ priority: 100 });
      expect(p.priority).toBe(100);
    });

    it('should set platform from config', () => {
      const p = new TestPushProvider({ platform: 'android' });
      expect(p.platform).toBe('android');
    });
  });

  describe('healthCheck', () => {
    it('should return true when configured', async () => {
      provider.configured = true;
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should return false when not configured', async () => {
      provider.configured = false;
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('send', () => {
    const testMessage: PushMessage = {
      title: 'Test Title',
      body: 'Test Body',
      data: { key: 'value' },
    };

    it('should return error when not configured', async () => {
      provider.configured = false;
      const result = await provider.send('token123', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
      expect(result.errorCode).toBe('provider_not_configured');
    });

    it('should call sendNotification when configured', async () => {
      provider.configured = true;
      provider.mockResult = { success: true, messageId: 'msg-123' };

      const result = await provider.send('token123', testMessage);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
    });

    it('should handle Error exceptions gracefully', async () => {
      provider.configured = true;
      provider.shouldThrow = true;
      provider.throwError = new Error('Network failure');

      const result = await provider.send('token123', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
      expect(result.errorCode).toBe('request_failed');
    });

    it('should preserve structured error codes from thrown provider errors', async () => {
      provider.configured = true;
      provider.shouldThrow = true;
      provider.throwError = Object.assign(new Error('Provider unavailable'), {
        errorCode: 'provider_unavailable',
      });

      const result = await provider.send('token123', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Provider unavailable');
      expect(result.errorCode).toBe('provider_unavailable');
    });

    it('should handle non-Error exceptions', async () => {
      provider.configured = true;
      provider.shouldThrow = true;
      provider.throwError = 'String error' as unknown as Error;

      const result = await provider.send('token123', testMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });

    it('should include provider name in error message', async () => {
      const namedProvider = new TestPushProvider({ name: 'MyProvider' });
      namedProvider.configured = false;

      const result = await namedProvider.send('token123', testMessage);

      expect(result.error).toContain('MyProvider');
    });
  });
});

describe('isInvalidTokenError', () => {
  describe('APNs errors', () => {
    it('should return true for 410 status', () => {
      expect(isInvalidTokenError('APNs 410: Gone')).toBe(true);
      expect(isInvalidTokenError(new Error('HTTP 410'))).toBe(true);
    });

    it('should return true for BadDeviceToken', () => {
      expect(isInvalidTokenError('BadDeviceToken')).toBe(true);
      expect(isInvalidTokenError(new Error('APNs error: BadDeviceToken'))).toBe(
        true,
      );
      expect(isInvalidTokenError({ errorCode: 'device_token_invalid' })).toBe(
        true,
      );
    });

    it('should return true for Unregistered', () => {
      expect(isInvalidTokenError('Unregistered')).toBe(true);
      expect(isInvalidTokenError(new Error('APNs error: Unregistered'))).toBe(
        true,
      );
      expect(
        isInvalidTokenError({ errorCode: 'device_token_unregistered' }),
      ).toBe(true);
    });
  });

  describe('FCM errors', () => {
    it('should return true for registration-token-not-registered', () => {
      expect(
        isInvalidTokenError('messaging/registration-token-not-registered'),
      ).toBe(true);
    });

    it('should return true for invalid-registration-token', () => {
      expect(isInvalidTokenError('messaging/invalid-registration-token')).toBe(
        true,
      );
    });

    it('should return true for InvalidRegistration', () => {
      expect(isInvalidTokenError('InvalidRegistration')).toBe(true);
    });
  });

  describe('valid tokens', () => {
    it('should return false for network errors', () => {
      expect(isInvalidTokenError('Network timeout')).toBe(false);
      expect(isInvalidTokenError(new Error('ECONNREFUSED'))).toBe(false);
    });

    it('should return false for server errors', () => {
      expect(isInvalidTokenError('HTTP 500 Internal Server Error')).toBe(false);
      expect(isInvalidTokenError('HTTP 503 Service Unavailable')).toBe(false);
    });

    it('should return false for authentication errors', () => {
      expect(isInvalidTokenError('HTTP 401 Unauthorized')).toBe(false);
      expect(isInvalidTokenError('HTTP 403 Forbidden')).toBe(false);
    });

    it('should return false for empty/null errors', () => {
      expect(isInvalidTokenError('')).toBe(false);
      expect(isInvalidTokenError(null)).toBe(false);
      expect(isInvalidTokenError(undefined)).toBe(false);
    });
  });
});
