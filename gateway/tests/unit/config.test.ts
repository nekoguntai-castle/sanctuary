/**
 * Gateway Configuration Tests
 *
 * Tests the gateway configuration module including environment variable
 * parsing, validation, and default values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Gateway Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache
    vi.resetModules();
    // Clone the environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('config object', () => {
    describe('server config', () => {
      it('should use default port 4000', async () => {
        delete process.env.GATEWAY_PORT;
        const { config } = await import('../../src/config');
        expect(config.port).toBe(4000);
      });

      it('should parse GATEWAY_PORT from environment', async () => {
        process.env.GATEWAY_PORT = '5000';
        const { config } = await import('../../src/config');
        expect(config.port).toBe(5000);
      });

      it('should use default NODE_ENV as development', async () => {
        delete process.env.NODE_ENV;
        const { config } = await import('../../src/config');
        expect(config.nodeEnv).toBe('development');
      });

      it('should read NODE_ENV from environment', async () => {
        process.env.NODE_ENV = 'production';
        const { config } = await import('../../src/config');
        expect(config.nodeEnv).toBe('production');
      });
    });

    describe('TLS config', () => {
      it('should disable TLS by default', async () => {
        delete process.env.TLS_ENABLED;
        const { config } = await import('../../src/config');
        expect(config.tls.enabled).toBe(false);
      });

      it('should enable TLS when TLS_ENABLED is true', async () => {
        process.env.TLS_ENABLED = 'true';
        const { config } = await import('../../src/config');
        expect(config.tls.enabled).toBe(true);
      });

      it('should not enable TLS for non-true values', async () => {
        process.env.TLS_ENABLED = 'yes';
        const { config } = await import('../../src/config');
        expect(config.tls.enabled).toBe(false);
      });

      it('should use default certificate path', async () => {
        delete process.env.TLS_CERT_PATH;
        const { config } = await import('../../src/config');
        expect(config.tls.certPath).toBe('/app/config/ssl/fullchain.pem');
      });

      it('should read TLS_CERT_PATH from environment', async () => {
        process.env.TLS_CERT_PATH = '/custom/cert.pem';
        const { config } = await import('../../src/config');
        expect(config.tls.certPath).toBe('/custom/cert.pem');
      });

      it('should use default key path', async () => {
        delete process.env.TLS_KEY_PATH;
        const { config } = await import('../../src/config');
        expect(config.tls.keyPath).toBe('/app/config/ssl/privkey.pem');
      });

      it('should read TLS_KEY_PATH from environment', async () => {
        process.env.TLS_KEY_PATH = '/custom/key.pem';
        const { config } = await import('../../src/config');
        expect(config.tls.keyPath).toBe('/custom/key.pem');
      });

      it('should have empty CA path by default', async () => {
        delete process.env.TLS_CA_PATH;
        const { config } = await import('../../src/config');
        expect(config.tls.caPath).toBe('');
      });

      it('should read TLS_CA_PATH from environment', async () => {
        process.env.TLS_CA_PATH = '/custom/ca.pem';
        const { config } = await import('../../src/config');
        expect(config.tls.caPath).toBe('/custom/ca.pem');
      });

      it('should use TLSv1.2 as default min version', async () => {
        delete process.env.TLS_MIN_VERSION;
        const { config } = await import('../../src/config');
        expect(config.tls.minVersion).toBe('TLSv1.2');
      });

      it('should read TLS_MIN_VERSION from environment', async () => {
        process.env.TLS_MIN_VERSION = 'TLSv1.3';
        const { config } = await import('../../src/config');
        expect(config.tls.minVersion).toBe('TLSv1.3');
      });
    });

    describe('backend config', () => {
      it('should use default backend URL', async () => {
        delete process.env.BACKEND_URL;
        const { config } = await import('../../src/config');
        expect(config.backendUrl).toBe('http://backend:3000');
      });

      it('should read BACKEND_URL from environment', async () => {
        process.env.BACKEND_URL = 'http://localhost:3001';
        const { config } = await import('../../src/config');
        expect(config.backendUrl).toBe('http://localhost:3001');
      });

      it('should use default backend WebSocket URL', async () => {
        delete process.env.BACKEND_WS_URL;
        const { config } = await import('../../src/config');
        expect(config.backendWsUrl).toBe('ws://backend:3000');
      });

      it('should read BACKEND_WS_URL from environment', async () => {
        process.env.BACKEND_WS_URL = 'ws://localhost:3001';
        const { config } = await import('../../src/config');
        expect(config.backendWsUrl).toBe('ws://localhost:3001');
      });
    });

    describe('JWT config', () => {
      it('should have empty JWT secret by default', async () => {
        delete process.env.JWT_SECRET;
        const { config } = await import('../../src/config');
        expect(config.jwtSecret).toBe('');
      });

      it('should read JWT_SECRET from environment', async () => {
        process.env.JWT_SECRET = 'my-super-secret-jwt-key';
        const { config } = await import('../../src/config');
        expect(config.jwtSecret).toBe('my-super-secret-jwt-key');
      });
    });

    describe('gateway secret', () => {
      it('should have empty gateway secret by default', async () => {
        delete process.env.GATEWAY_SECRET;
        const { config } = await import('../../src/config');
        expect(config.gatewaySecret).toBe('');
      });

      it('should read GATEWAY_SECRET from environment', async () => {
        process.env.GATEWAY_SECRET = 'my-gateway-secret-32-characters-long';
        const { config } = await import('../../src/config');
        expect(config.gatewaySecret).toBe('my-gateway-secret-32-characters-long');
      });
    });

    describe('CORS config', () => {
      it('should return empty array when CORS_ALLOWED_ORIGINS is not set', async () => {
        delete process.env.CORS_ALLOWED_ORIGINS;
        const { config } = await import('../../src/config');
        expect(config.corsAllowedOrigins).toEqual([]);
      });

      it('should parse comma-separated origins', async () => {
        process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000,https://app.example.com';
        const { config } = await import('../../src/config');
        expect(config.corsAllowedOrigins).toEqual(['http://localhost:3000', 'https://app.example.com']);
      });

      it('should trim whitespace from origins', async () => {
        process.env.CORS_ALLOWED_ORIGINS = ' http://a.com , http://b.com ';
        const { config } = await import('../../src/config');
        expect(config.corsAllowedOrigins).toEqual(['http://a.com', 'http://b.com']);
      });

      it('should filter empty origins', async () => {
        process.env.CORS_ALLOWED_ORIGINS = 'http://a.com,,http://b.com,';
        const { config } = await import('../../src/config');
        expect(config.corsAllowedOrigins).toEqual(['http://a.com', 'http://b.com']);
      });
    });

    describe('rate limit config', () => {
      it('should use default window of 60000ms (1 minute)', async () => {
        delete process.env.RATE_LIMIT_WINDOW_MS;
        const { config } = await import('../../src/config');
        expect(config.rateLimit.windowMs).toBe(60000);
      });

      it('should parse RATE_LIMIT_WINDOW_MS from environment', async () => {
        process.env.RATE_LIMIT_WINDOW_MS = '120000';
        const { config } = await import('../../src/config');
        expect(config.rateLimit.windowMs).toBe(120000);
      });

      it('should use default max requests of 60', async () => {
        delete process.env.RATE_LIMIT_MAX;
        const { config } = await import('../../src/config');
        expect(config.rateLimit.maxRequests).toBe(60);
      });

      it('should parse RATE_LIMIT_MAX from environment', async () => {
        process.env.RATE_LIMIT_MAX = '100';
        const { config } = await import('../../src/config');
        expect(config.rateLimit.maxRequests).toBe(100);
      });

      it('should have exponential backoff config', async () => {
        const { config } = await import('../../src/config');
        expect(config.rateLimit.backoff).toBeDefined();
        expect(config.rateLimit.backoff.baseRetryAfter).toBe(60);
        expect(config.rateLimit.backoff.maxRetryAfter).toBe(3600);
        expect(config.rateLimit.backoff.multiplier).toBe(2);
      });
    });

    describe('FCM config', () => {
      it('should have empty FCM project ID by default', async () => {
        delete process.env.FCM_PROJECT_ID;
        const { config } = await import('../../src/config');
        expect(config.fcm.projectId).toBe('');
      });

      it('should read FCM_PROJECT_ID from environment', async () => {
        process.env.FCM_PROJECT_ID = 'my-firebase-project';
        const { config } = await import('../../src/config');
        expect(config.fcm.projectId).toBe('my-firebase-project');
      });

      it('should convert escaped newlines in FCM_PRIVATE_KEY', async () => {
        process.env.FCM_PRIVATE_KEY = 'line1\\nline2\\nline3';
        const { config } = await import('../../src/config');
        expect(config.fcm.privateKey).toBe('line1\nline2\nline3');
      });

      it('should have empty FCM client email by default', async () => {
        delete process.env.FCM_CLIENT_EMAIL;
        const { config } = await import('../../src/config');
        expect(config.fcm.clientEmail).toBe('');
      });
    });

    describe('APNs config', () => {
      it('should have empty APNs key ID by default', async () => {
        delete process.env.APNS_KEY_ID;
        const { config } = await import('../../src/config');
        expect(config.apns.keyId).toBe('');
      });

      it('should read APNS_KEY_ID from environment', async () => {
        process.env.APNS_KEY_ID = 'ABC123XYZ';
        const { config } = await import('../../src/config');
        expect(config.apns.keyId).toBe('ABC123XYZ');
      });

      it('should convert escaped newlines in APNS_PRIVATE_KEY', async () => {
        process.env.APNS_PRIVATE_KEY = 'line1\\nline2';
        const { config } = await import('../../src/config');
        expect(config.apns.privateKey).toBe('line1\nline2');
      });

      it('should use default bundle ID', async () => {
        delete process.env.APNS_BUNDLE_ID;
        const { config } = await import('../../src/config');
        expect(config.apns.bundleId).toBe('com.sanctuary.app');
      });

      it('should read APNS_BUNDLE_ID from environment', async () => {
        process.env.APNS_BUNDLE_ID = 'com.example.myapp';
        const { config } = await import('../../src/config');
        expect(config.apns.bundleId).toBe('com.example.myapp');
      });

      it('should set production to true when NODE_ENV is production', async () => {
        process.env.NODE_ENV = 'production';
        const { config } = await import('../../src/config');
        expect(config.apns.production).toBe(true);
      });

      it('should set production to false when NODE_ENV is not production', async () => {
        process.env.NODE_ENV = 'development';
        const { config } = await import('../../src/config');
        expect(config.apns.production).toBe(false);
      });
    });

    describe('log level config', () => {
      it('should use default log level of info', async () => {
        delete process.env.LOG_LEVEL;
        const { config } = await import('../../src/config');
        expect(config.logLevel).toBe('info');
      });

      it('should read LOG_LEVEL from environment', async () => {
        process.env.LOG_LEVEL = 'debug';
        const { config } = await import('../../src/config');
        expect(config.logLevel).toBe('debug');
      });
    });
  });

  describe('validateConfig', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let processExitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    it('should exit when JWT_SECRET is missing', async () => {
      delete process.env.JWT_SECRET;
      const { validateConfig } = await import('../../src/config');

      validateConfig();

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should not exit when JWT_SECRET is provided', async () => {
      process.env.JWT_SECRET = 'my-secret';
      const { validateConfig } = await import('../../src/config');

      validateConfig();

      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should warn when GATEWAY_SECRET is not set', async () => {
      process.env.JWT_SECRET = 'my-secret';
      delete process.env.GATEWAY_SECRET;
      const { validateConfig } = await import('../../src/config');

      validateConfig();

      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCall = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnCall).toContain('GATEWAY_SECRET');
    });

    it('should warn when GATEWAY_SECRET is too short', async () => {
      process.env.JWT_SECRET = 'my-secret';
      process.env.GATEWAY_SECRET = 'short';
      const { validateConfig } = await import('../../src/config');

      validateConfig();

      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCall = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnCall).toContain('32 characters');
    });

    it('should not warn when GATEWAY_SECRET is long enough', async () => {
      process.env.JWT_SECRET = 'my-secret';
      process.env.GATEWAY_SECRET = 'this-is-a-32-character-secret!!!';
      const { validateConfig } = await import('../../src/config');

      validateConfig();

      const warnCalls = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnCalls).not.toContain('GATEWAY_SECRET');
    });

    it('should warn when TLS is disabled in production', async () => {
      process.env.JWT_SECRET = 'my-secret';
      process.env.GATEWAY_SECRET = 'this-is-a-32-character-secret!!!';
      process.env.NODE_ENV = 'production';
      process.env.TLS_ENABLED = 'false';
      const { validateConfig } = await import('../../src/config');

      validateConfig();

      const warnCall = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnCall).toContain('TLS is disabled');
    });

    it('should not warn about TLS in development', async () => {
      process.env.JWT_SECRET = 'my-secret';
      process.env.GATEWAY_SECRET = 'this-is-a-32-character-secret!!!';
      process.env.NODE_ENV = 'development';
      process.env.TLS_ENABLED = 'false';
      const { validateConfig } = await import('../../src/config');

      validateConfig();

      const warnCalls = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnCalls).not.toContain('TLS');
    });

    it('should exit when TLS is enabled but cert/key paths are empty', async () => {
      process.env.JWT_SECRET = 'my-secret';
      process.env.GATEWAY_SECRET = 'this-is-a-32-character-secret!!!';
      process.env.TLS_ENABLED = 'true';
      const { config, validateConfig } = await import('../../src/config');

      // These are defaulted during parsing, so force the edge-case for validation branch coverage.
      config.tls.certPath = '';
      config.tls.keyPath = '';

      validateConfig();

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const errorCall = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(errorCall).toContain('TLS_CERT_PATH');
      expect(errorCall).toContain('TLS_KEY_PATH');
    });
  });
});
