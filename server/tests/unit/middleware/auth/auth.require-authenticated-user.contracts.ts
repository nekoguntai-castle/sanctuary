import { describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../../src/errors/ApiError';
import { requireAuthenticatedUser } from '../../../../src/middleware/auth';
import { createMockRequest } from '../../../helpers/testUtils';
import { validPayload } from './authTestHarness';

export function registerRequireAuthenticatedUserContracts() {
  describe('requireAuthenticatedUser helper', () => {
    it('returns the authenticated user payload', () => {
      const req = createMockRequest({
        user: validPayload,
      });

      expect(requireAuthenticatedUser(req as any)).toBe(validPayload);
    });

    it('throws UnauthorizedError when the request has no user', () => {
      const req = createMockRequest({});

      expect(() => requireAuthenticatedUser(req as any)).toThrow(UnauthorizedError);
      expect(() => requireAuthenticatedUser(req as any)).toThrow('Authentication required');
    });
  });
}
