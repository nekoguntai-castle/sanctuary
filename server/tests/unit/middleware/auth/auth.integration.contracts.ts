import { describe, expect, it, type Mock } from 'vitest';

import { createMockRequest, createMockResponse, createMockNext } from '../../../helpers/testUtils';
import './authTestHarness';
import { authenticate, optionalAuth, requireAdmin } from '../../../../src/middleware/auth';
import { verifyToken, extractTokenFromHeader } from '../../../../src/utils/jwt';
import { adminPayload, validPayload } from './authTestHarness';

export function registerAuthIntegrationScenarioContracts() {
  describe('Integration Scenarios', () => {
    it('should allow authenticated user to pass both authenticate and requireAdmin for admin', async () => {
      const token = 'admin-token';
      (extractTokenFromHeader as Mock).mockReturnValue(token);
      (verifyToken as Mock).mockResolvedValue(adminPayload);

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: authenticate
      await authenticate(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toEqual(adminPayload);

      // Second: requireAdmin
      const { res: res2 } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      expect(next2).toHaveBeenCalled();
    });

    it('should block non-admin user at requireAdmin even after successful authentication', async () => {
      const token = 'user-token';
      (extractTokenFromHeader as Mock).mockReturnValue(token);
      (verifyToken as Mock).mockResolvedValue(validPayload);

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: authenticate
      await authenticate(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toEqual(validPayload);

      // Second: requireAdmin - should fail
      const { res: res2, getResponse } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(response.body.message).toBe('Admin access required');
      expect(next2).not.toHaveBeenCalled();
    });

    it('should handle optionalAuth followed by requireAdmin correctly', async () => {
      const token = 'admin-token';
      (extractTokenFromHeader as Mock).mockReturnValue(token);
      (verifyToken as Mock).mockResolvedValue(adminPayload);

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: optionalAuth
      await optionalAuth(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toEqual(adminPayload);

      // Second: requireAdmin
      const { res: res2 } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      expect(next2).toHaveBeenCalled();
    });

    it('should fail requireAdmin when optionalAuth did not attach user', async () => {
      (extractTokenFromHeader as Mock).mockReturnValue(null);

      const req = createMockRequest({
        headers: {},
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: optionalAuth
      await optionalAuth(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toBeUndefined();

      // Second: requireAdmin - should fail
      const { res: res2, getResponse } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      const response = getResponse();
      expect(response.statusCode).toBe(401);
      expect(response.body.message).toBe('Authentication required');
      expect(next2).not.toHaveBeenCalled();
    });
  });
}
