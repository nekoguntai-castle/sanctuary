import { describe, expect, it } from 'vitest';

import { createMockRequest, createMockResponse, createMockNext } from '../../../helpers/testUtils';
import './authTestHarness';
import { requireAdmin } from '../../../../src/middleware/auth';
import { adminPayload, validPayload } from './authTestHarness';

export function registerRequireAdminMiddlewareContracts() {
  describe('requireAdmin middleware', () => {
    describe('Admin Role Checking', () => {
      it('should allow access for admin users', () => {
        const req = createMockRequest({
          user: adminPayload,
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
      });

      it('should deny access for non-admin users', () => {
        const req = createMockRequest({
          user: validPayload,
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toBe('Admin access required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when user is not authenticated', () => {
        const req = createMockRequest({
          // No user attached
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Authentication required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when user is undefined', () => {
        const req = createMockRequest({
          user: undefined,
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Authentication required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when isAdmin is false', () => {
        const req = createMockRequest({
          user: {
            userId: 'user-123',
            username: 'testuser',
            isAdmin: false,
          },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toBe('Admin access required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when isAdmin is missing', () => {
        const req = createMockRequest({
          user: {
            userId: 'user-123',
            username: 'testuser',
            isAdmin: undefined as any,
          },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(response.body.message).toBe('Admin access required');
        expect(next).not.toHaveBeenCalled();
      });
    });
  });
}
