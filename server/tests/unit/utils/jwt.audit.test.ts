/**
 * JWT Audit Non-Regression Tests
 *
 * Audit: tasks/audit-2026-05-12/04-utils.md
 * Finding: CRITICAL — server/src/utils/jwt.ts:242
 *
 * Bare `catch` around `isTokenRevoked()` used to mask Redis/DB outages as auth
 * failures. When the revocation store was unreachable (e.g. Redis connection
 * refused, DB timeout), the catch swallowed the infrastructure error and
 * re-threw `Error('Invalid or expired token')` — indistinguishable from a
 * legitimately forged token.
 *
 * Expected behavior:
 *   verifyToken() distinguishes "isTokenRevoked threw an infra error" from
 *   "isTokenRevoked returned true". The infra failure surfaces as a distinct
 *   outage signal — NOT the generic 401 message.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  jwtSecret: 'test-secret-key-for-audit-non-regression-test',
  jwtExpiresIn: '1h',
  jwtRefreshExpiresIn: '7d',
}));

vi.mock('../../../src/config', () => ({
  default: mockConfig,
}));

const mockIsTokenRevoked = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/tokenRevocation', () => ({
  isTokenRevoked: mockIsTokenRevoked,
}));

import { generateToken, verifyToken, TokenAudience } from '../../../src/utils/jwt';

describe('JWT audit: revocation-check error handling (jwt.ts:242)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test(
    'verifyToken should NOT mask Redis connection failures as "Invalid or expired token"',
    async () => {
      // Arrange: a perfectly valid, signed, unexpired token...
      const token = generateToken({
        userId: 'user-abc',
        username: 'auditor',
        isAdmin: false,
      });

      // ...but the revocation store is having an outage.
      const infraError = new Error('redis: connection refused');
      mockIsTokenRevoked.mockRejectedValueOnce(infraError);

      // Act + Assert:
      // Post-fix behavior — the infra error propagates (or surfaces as a
      // distinct outage error). Either way it MUST NOT be flattened to the
      // generic 401 string "Invalid or expired token", because that masks
      // the outage as a credential problem.
      //
      // We accept either:
      //   (a) the original error propagating, or
      //   (b) a new distinct error class/message containing "redis" /
      //       "revocation" / "unavailable" / "outage".
      await expect(verifyToken(token, TokenAudience.ACCESS)).rejects.toThrow(
        /redis|revocation (store|check) unavailable|outage|infrastructure/i,
      );

    },
  );
});
