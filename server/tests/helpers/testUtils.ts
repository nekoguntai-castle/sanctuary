import { vi } from 'vitest';
/**
 * Test Utilities
 *
 * Common helper functions for testing.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// JWT secret for testing
const TEST_JWT_SECRET = 'test-jwt-secret-key-for-testing-only';

/**
 * Create a mock Express request
 */
export function createMockRequest(options: {
  body?: Record<string, any>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  user?: {
    userId: string;
    username: string;
    isAdmin: boolean;
  };
  ip?: string;
}): Partial<Request> {
  const mockHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };

  const req = {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: mockHeaders,
    cookies: options.cookies || {},
    user: options.user,
    ip: options.ip || '127.0.0.1',
    get: vi.fn((header: string): string | undefined => {
      return mockHeaders[header.toLowerCase()];
    }),
  };

  return req as unknown as Partial<Request>;
}

/**
 * Create a mock Express response
 */
export function createMockResponse(): {
  res: Partial<Response>;
  getResponse: () => { statusCode: number; body: any };
} {
  let statusCode = 200;
  let responseBody: any = null;

  const res: Partial<Response> = {
    status: vi.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn().mockImplementation((body: any) => {
      responseBody = body;
      return res;
    }),
    send: vi.fn().mockImplementation((body: any) => {
      responseBody = body;
      return res;
    }),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
  };

  return {
    res,
    getResponse: () => ({ statusCode, body: responseBody }),
  };
}

/**
 * Create a mock next function
 */
export function createMockNext(): NextFunction {
  return vi.fn();
}

/**
 * Generate a valid JWT token for testing
 * SEC-006: Includes audience claim for proper token type identification
 */
export function generateTestToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
  pending2FA?: boolean;
}): string {
  return jwt.sign(
    { ...payload, aud: 'sanctuary:access' },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Generate an expired JWT token for testing
 */
export function generateExpiredToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
}): string {
  return jwt.sign(
    { ...payload, aud: 'sanctuary:access' },
    TEST_JWT_SECRET,
    { expiresIn: '-1h' }
  );
}

/**
 * Generate a token with invalid signature
 */
export function generateInvalidSignatureToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
}): string {
  return jwt.sign(
    { ...payload, aud: 'sanctuary:access' },
    'wrong-secret',
    { expiresIn: '1h' }
  );
}

/**
 * Generate a 2FA temporary token for testing
 */
export function generate2FATestToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
}): string {
  return jwt.sign(
    { ...payload, pending2FA: true, aud: 'sanctuary:2fa' },
    TEST_JWT_SECRET,
    { expiresIn: '5m' }
  );
}

/**
 * Generate a refresh token for testing
 */
export function generateRefreshTestToken(userId: string): string {
  return jwt.sign(
    { userId, type: 'refresh', aud: 'sanctuary:refresh' },
    TEST_JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Create a promise that resolves after the current event loop
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Wait for a fixed amount of time.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Assert that a function throws an error with a specific message
 */
export async function expectAsyncError(
  fn: () => Promise<any>,
  expectedMessage: string | RegExp
): Promise<void> {
  let error: Error | null = null;
  try {
    await fn();
  } catch (e) {
    error = e as Error;
  }

  expect(error).not.toBeNull();
  if (typeof expectedMessage === 'string') {
    expect(error!.message).toContain(expectedMessage);
  } else {
    expect(error!.message).toMatch(expectedMessage);
  }
}

/**
 * Create a spy on console methods and restore after callback
 */
export async function withSuppressedConsole<T>(
  fn: () => Promise<T>
): Promise<T> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

/**
 * Deep clone an object (for creating test fixtures)
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Seeded random number generator for deterministic tests.
 * Uses a simple mulberry32 algorithm.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number = 12345) {
    this.state = seed;
  }

  /**
   * Reset the generator with a new seed
   */
  reset(seed: number = 12345): void {
    this.state = seed;
  }

  /**
   * Generate a random number between 0 and 1
   */
  random(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate a random integer between min (inclusive) and max (exclusive)
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min)) + min;
  }

  /**
   * Generate a random hex string of specified length
   */
  randomHex(length: number): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[this.randomInt(0, chars.length)];
    }
    return result;
  }

  /**
   * Generate a random transaction ID (64 hex chars)
   */
  randomTxid(): string {
    return this.randomHex(64);
  }

  /**
   * Generate a random Bitcoin address (testnet native segwit)
   */
  randomAddress(): string {
    return 'tb1q' + this.randomHex(38);
  }
}

// Global seeded random instance for tests
export const seededRandom = new SeededRandom();

/**
 * Generate a random hex string of specified length
 * Note: Uses Math.random() - for deterministic tests, use seededRandom.randomHex()
 */
export function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate a random transaction ID
 */
export function randomTxid(): string {
  return randomHex(64);
}

/**
 * Generate a random Bitcoin address (testnet native segwit)
 */
export function randomAddress(): string {
  // This is a simplified mock, not a valid address
  return 'tb1q' + randomHex(38);
}

/**
 * Convert satoshis to BTC for display
 */
export function satsToBtc(sats: number | bigint): number {
  return Number(sats) / 100000000;
}

/**
 * Convert BTC to satoshis
 */
export function btcToSats(btc: number): number {
  return Math.round(btc * 100000000);
}

export default {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
  generateExpiredToken,
  generateInvalidSignatureToken,
  generate2FATestToken,
  generateRefreshTestToken,
  flushPromises,
  wait,
  expectAsyncError,
  withSuppressedConsole,
  deepClone,
  SeededRandom,
  seededRandom,
  randomHex,
  randomTxid,
  randomAddress,
  satsToBtc,
  btcToSats,
};
