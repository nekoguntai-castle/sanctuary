import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { app } from './auth2faTestHarness';
import { mockPrismaClient } from '../auth.testHelpers';

const STEP_UP_ROUTES = [
  { path: '/api/v1/auth/2fa/disable', body: { password: 'password123', token: '123456' } },
  { path: '/api/v1/auth/2fa/backup-codes', body: { password: 'password123' } },
  { path: '/api/v1/auth/2fa/backup-codes/regenerate', body: { password: 'password123', token: '123456' } },
];

export function registerTwoFactorStepUpRateLimitContracts() {
  describe.each(STEP_UP_ROUTES)('$path', ({ path, body }) => {
    it('consumes the per-user auth:step-up-password budget', async () => {
      const { rateLimitService } = await import('../../../../src/services/rateLimiting');
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      await request(app).post(path).send(body);

      expect(rateLimitService.consume).toHaveBeenCalledWith('auth:step-up-password', 'user:test-user-id');
    });

    it('returns 429 without verifying the password when the budget is exhausted', async () => {
      const { rateLimitService } = await import('../../../../src/services/rateLimiting');
      const { verifyPassword } = await import('../../../../src/utils/password');
      vi.mocked(rateLimitService.consume).mockResolvedValueOnce({
        allowed: false, remaining: 0, limit: 3, resetAt: Date.now() + 3_600_000, retryAfter: 3600,
      });

      const response = await request(app).post(path).send(body);

      expect(response.status).toBe(429);
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(mockPrismaClient.user.findUnique).not.toHaveBeenCalled();
    });
  });
}
