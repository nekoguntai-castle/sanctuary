/**
 * Vitest Test Setup
 *
 * Global test configuration and setup that runs before each test file.
 * Sets up environment variables, mocks, and global test utilities.
 */

import { vi, beforeAll, beforeEach, expect } from 'vitest';
import { validateEncryptionKey } from '../src/utils/encryption';

// Set test environment variables before any imports
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters';
process.env.ENCRYPTION_SALT = 'test-encryption-salt';

// Initialize encryption key asynchronously (uses async scrypt)
beforeAll(async () => {
  await validateEncryptionKey();
});

// Mock the logger to prevent console spam during tests
vi.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the requestContext
vi.mock('../src/utils/requestContext', () => ({
  requestContext: {
    run: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
    get: vi.fn(() => undefined),
    getRequestId: vi.fn(() => 'test-request-id'),
    getUserId: vi.fn(() => undefined),
    getTraceId: vi.fn(() => undefined),
    setTraceId: vi.fn(),
    setUser: vi.fn(),
    getUser: vi.fn(() => ({ userId: 'test-user-id', username: 'testuser' })),
    getDuration: vi.fn(() => 0),
    generateRequestId: vi.fn(() => 'test-request-id'),
    clear: vi.fn(),
  },
}));

// Mock rate limiting middleware to bypass Redis dependency in tests
vi.mock('../src/middleware/rateLimit', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimitByIpAndKey: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimitByUser: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Global test utilities
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
});

// Extend Vitest matchers with custom matchers
expect.extend({
  /**
   * Custom matcher to check if a value is a valid Bitcoin address format
   */
  toBeValidBitcoinAddress(received: string) {
    const mainnetP2PKH = /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const mainnetP2SH = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const mainnetBech32 = /^bc1[a-z0-9]{39,59}$/;
    const testnetP2PKH = /^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const testnetP2SH = /^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const testnetBech32 = /^tb1[a-z0-9]{39,59}$/;

    const isValid =
      mainnetP2PKH.test(received) ||
      mainnetP2SH.test(received) ||
      mainnetBech32.test(received) ||
      testnetP2PKH.test(received) ||
      testnetP2SH.test(received) ||
      testnetBech32.test(received);

    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received} not to be a valid Bitcoin address`
          : `Expected ${received} to be a valid Bitcoin address`,
    };
  },

  /**
   * Custom matcher to check if value is a valid transaction ID (64 hex chars)
   */
  toBeValidTxid(received: string) {
    const isValid = /^[a-f0-9]{64}$/i.test(received);
    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received} not to be a valid transaction ID`
          : `Expected ${received} to be a valid transaction ID (64 hex characters)`,
    };
  },

  /**
   * Custom matcher to check if value is a valid PSBT (base64 encoded)
   */
  toBeValidPsbt(received: string) {
    // PSBT starts with "cHNi" when base64 encoded (from "psbt" magic bytes)
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(received);
    const startsWithPsbtMagic = received.startsWith('cHNi');
    const isValid = isBase64 && startsWithPsbtMagic;
    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received.substring(0, 20)}... not to be a valid PSBT`
          : `Expected value to be a valid PSBT (base64 encoded starting with psbt magic bytes)`,
    };
  },
});

// Type declarations for custom matchers
declare module '@vitest/expect' {
  interface Assertion<T> {
    toBeValidBitcoinAddress(): T;
    toBeValidTxid(): T;
    toBeValidPsbt(): T;
  }
  interface AsymmetricMatchersContaining {
    toBeValidBitcoinAddress(): unknown;
    toBeValidTxid(): unknown;
    toBeValidPsbt(): unknown;
  }
}

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: vi.fn() as unknown as Console['log'],
    debug: vi.fn() as unknown as Console['debug'],
    info: vi.fn() as unknown as Console['info'],
    warn: vi.fn() as unknown as Console['warn'],
    // Keep error for debugging test failures
    error: console.error,
  };
}

export {};
