/**
 * Admin Policies Routes Tests
 *
 * Tests for the admin policy management API endpoints:
 * - GET /admin/policies (list system-wide policies)
 * - POST /admin/policies (create a system-wide policy)
 * - PATCH /admin/policies/:policyId (update a system-wide policy)
 * - DELETE /admin/policies/:policyId (delete a system-wide policy)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const {
  mockGetSystemPolicies,
  mockCreatePolicy,
  mockUpdatePolicy,
  mockDeletePolicy,
  mockGetPolicy,
  mockAuditLogFromRequest,
} = vi.hoisted(() => ({
  mockGetSystemPolicies: vi.fn(),
  mockCreatePolicy: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockDeletePolicy: vi.fn(),
  mockGetPolicy: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/services/vaultPolicy', () => ({
  vaultPolicyService: {
    getSystemPolicies: mockGetSystemPolicies,
    createPolicy: mockCreatePolicy,
    updatePolicy: mockUpdatePolicy,
    deletePolicy: mockDeletePolicy,
    getPolicy: mockGetPolicy,
  },
}));

vi.mock('../../../src/repositories/policyRepository', () => ({
  policyRepository: {},
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditAction: {
    POLICY_CREATE: 'wallet.policy_create',
    POLICY_UPDATE: 'wallet.policy_update',
    POLICY_DELETE: 'wallet.policy_delete',
  },
  AuditCategory: {
    ADMIN: 'admin',
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import policiesRouter from '../../../src/api/admin/policies';

/**
 * Wraps an Express Router so that async handler rejections are forwarded to
 * Express error-handling middleware (Express 4 does not do this natively).
 */
function wrapAsyncRouter(router: express.Router): express.Router {
  const stack = (router as any).stack as any[];
  for (const layer of stack) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack) {
        const original = routeLayer.handle;
        if (original.length <= 3) {
          routeLayer.handle = (req: Request, res: Response, next: NextFunction) => {
            const result = original(req, res, next);
            if (result && typeof result.catch === 'function') {
              result.catch(next);
            }
          };
        }
      }
    }
  }
  return router;
}

describe('Admin Policies Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/policies', wrapAsyncRouter(policiesRouter));
    // Error handler to catch re-thrown errors
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLogFromRequest.mockResolvedValue(undefined);
  });

  // =========================================================================
  // GET /api/v1/admin/policies
  // =========================================================================

  describe('GET /api/v1/admin/policies', () => {
    const url = '/api/v1/admin/policies';

    it('should return all system-wide policies', async () => {
      const mockPolicies = [
        { id: 'pol-1', name: 'Spending Limit', type: 'spending_limit', sourceType: 'system' },
        { id: 'pol-2', name: 'Approval Required', type: 'approval_required', sourceType: 'system' },
      ];
      mockGetSystemPolicies.mockResolvedValue(mockPolicies);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policies: mockPolicies });
      expect(mockGetSystemPolicies).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no policies exist', async () => {
      mockGetSystemPolicies.mockResolvedValue([]);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policies: [] });
    });

    it('should return 500 when service throws', async () => {
      mockGetSystemPolicies.mockRejectedValue(new Error('DB failure'));

      const response = await request(app).get(url);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // =========================================================================
  // POST /api/v1/admin/policies
  // =========================================================================

  describe('POST /api/v1/admin/policies', () => {
    const url = '/api/v1/admin/policies';

    const policyPayload = {
      name: 'Max Spend',
      description: 'Limit daily spending',
      type: 'spending_limit',
      config: { maxAmount: 100000, window: '24h' },
      priority: 10,
      enforcement: 'enforce',
      enabled: true,
    };

    const createdPolicy = {
      id: 'pol-new',
      name: 'Max Spend',
      description: 'Limit daily spending',
      type: 'spending_limit',
      config: { maxAmount: 100000, window: '24h' },
      priority: 10,
      enforcement: 'enforce',
      enabled: true,
      sourceType: 'system',
    };

    it('should create a system-wide policy', async () => {
      mockCreatePolicy.mockResolvedValue(createdPolicy);

      const response = await request(app)
        .post(url)
        .send(policyPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ policy: createdPolicy });
      expect(mockCreatePolicy).toHaveBeenCalledWith('admin-1', {
        name: 'Max Spend',
        description: 'Limit daily spending',
        type: 'spending_limit',
        config: { maxAmount: 100000, window: '24h' },
        priority: 10,
        enforcement: 'enforce',
        enabled: true,
      });
    });

    it('should create policy with only required fields', async () => {
      const minimalPayload = { name: 'Basic', type: 'spending_limit' };
      const minimalResult = {
        id: 'pol-min',
        name: 'Basic',
        type: 'spending_limit',
        sourceType: 'system',
      };
      mockCreatePolicy.mockResolvedValue(minimalResult);

      const response = await request(app)
        .post(url)
        .send(minimalPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ policy: minimalResult });
      expect(mockCreatePolicy).toHaveBeenCalledWith('admin-1', expect.objectContaining({
        name: 'Basic',
        type: 'spending_limit',
      }));
    });

    it('should log audit event after successful creation', async () => {
      mockCreatePolicy.mockResolvedValue(createdPolicy);

      await request(app)
        .post(url)
        .send(policyPayload);

      expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_create',
        'admin',
        {
          details: {
            scope: 'system',
            policyId: 'pol-new',
            policyName: 'Max Spend',
            policyType: 'spending_limit',
          },
        },
      );
    });

    it('should return 500 when createPolicy throws', async () => {
      mockCreatePolicy.mockRejectedValue(new Error('Validation failed'));

      const response = await request(app)
        .post(url)
        .send(policyPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should not call audit when createPolicy throws', async () => {
      mockCreatePolicy.mockRejectedValue(new Error('Validation failed'));

      await request(app)
        .post(url)
        .send(policyPayload);

      expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PATCH /api/v1/admin/policies/:policyId
  // =========================================================================

  describe('PATCH /api/v1/admin/policies/:policyId', () => {
    const url = '/api/v1/admin/policies/pol-1';

    const existingPolicy = {
      id: 'pol-1',
      name: 'Old Name',
      sourceType: 'system',
      type: 'spending_limit',
    };

    const updatedPolicy = {
      id: 'pol-1',
      name: 'New Name',
      sourceType: 'system',
      type: 'spending_limit',
    };

    it('should update a system-wide policy', async () => {
      mockGetPolicy.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockResolvedValue(updatedPolicy);

      const response = await request(app)
        .patch(url)
        .send({ name: 'New Name' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policy: updatedPolicy });
      expect(mockGetPolicy).toHaveBeenCalledWith('pol-1');
      expect(mockUpdatePolicy).toHaveBeenCalledWith(
        'pol-1',
        'admin-1',
        { name: 'New Name' },
        { isAdmin: true },
      );
    });

    it('should update multiple fields', async () => {
      mockGetPolicy.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockResolvedValue(updatedPolicy);

      const patchBody = {
        name: 'Updated',
        description: 'New description',
        config: { maxAmount: 500000 },
        priority: 5,
        enforcement: 'warn',
        enabled: false,
      };

      const response = await request(app)
        .patch(url)
        .send(patchBody);

      expect(response.status).toBe(200);
      expect(mockUpdatePolicy).toHaveBeenCalledWith(
        'pol-1',
        'admin-1',
        {
          name: 'Updated',
          description: 'New description',
          config: { maxAmount: 500000 },
          priority: 5,
          enforcement: 'warn',
          enabled: false,
        },
        { isAdmin: true },
      );
    });

    it('should only include defined fields in update input', async () => {
      mockGetPolicy.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockResolvedValue(updatedPolicy);

      await request(app)
        .patch(url)
        .send({ name: 'Only name' });

      expect(mockUpdatePolicy).toHaveBeenCalledWith(
        'pol-1',
        'admin-1',
        { name: 'Only name' },
        { isAdmin: true },
      );
    });

    it('should pass empty update when no fields provided', async () => {
      mockGetPolicy.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockResolvedValue(existingPolicy);

      await request(app)
        .patch(url)
        .send({});

      expect(mockUpdatePolicy).toHaveBeenCalledWith(
        'pol-1',
        'admin-1',
        {},
        { isAdmin: true },
      );
    });

    it('should log audit event after successful update', async () => {
      mockGetPolicy.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockResolvedValue(updatedPolicy);

      await request(app)
        .patch(url)
        .send({ name: 'New Name', priority: 5 });

      expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_update',
        'admin',
        {
          details: {
            scope: 'system',
            policyId: 'pol-1',
            updatedFields: ['name', 'priority'],
          },
        },
      );
    });

    it('should return 403 when policy is not system-level', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol-1',
        name: 'Wallet Policy',
        sourceType: 'wallet',
      });

      const response = await request(app)
        .patch(url)
        .send({ name: 'Updated' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Admin policy endpoints can only manage system-level policies');
      expect(mockUpdatePolicy).not.toHaveBeenCalled();
    });

    it('should return 403 for group-level policy', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol-1',
        name: 'Group Policy',
        sourceType: 'group',
      });

      const response = await request(app)
        .patch(url)
        .send({ name: 'Updated' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Admin policy endpoints can only manage system-level policies');
      expect(mockUpdatePolicy).not.toHaveBeenCalled();
    });

    it('should return 500 when getPolicy throws', async () => {
      mockGetPolicy.mockRejectedValue(new Error('Not found'));

      const response = await request(app)
        .patch(url)
        .send({ name: 'Updated' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should return 500 when updatePolicy throws', async () => {
      mockGetPolicy.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .patch(url)
        .send({ name: 'Updated' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should not call audit when updatePolicy throws', async () => {
      mockGetPolicy.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockRejectedValue(new Error('Update failed'));

      await request(app)
        .patch(url)
        .send({ name: 'Updated' });

      expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // DELETE /api/v1/admin/policies/:policyId
  // =========================================================================

  describe('DELETE /api/v1/admin/policies/:policyId', () => {
    const url = '/api/v1/admin/policies/pol-1';

    const systemPolicy = {
      id: 'pol-1',
      name: 'To Delete',
      sourceType: 'system',
    };

    it('should delete a system-wide policy', async () => {
      mockGetPolicy.mockResolvedValue(systemPolicy);
      mockDeletePolicy.mockResolvedValue(undefined);

      const response = await request(app).delete(url);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockGetPolicy).toHaveBeenCalledWith('pol-1');
      expect(mockDeletePolicy).toHaveBeenCalledWith('pol-1');
    });

    it('should log audit event after successful deletion', async () => {
      mockGetPolicy.mockResolvedValue(systemPolicy);
      mockDeletePolicy.mockResolvedValue(undefined);

      await request(app).delete(url);

      expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_delete',
        'admin',
        {
          details: {
            scope: 'system',
            policyId: 'pol-1',
          },
        },
      );
    });

    it('should return 403 when policy is not system-level', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol-1',
        name: 'Wallet Policy',
        sourceType: 'wallet',
      });

      const response = await request(app).delete(url);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Admin policy endpoints can only manage system-level policies');
      expect(mockDeletePolicy).not.toHaveBeenCalled();
    });

    it('should return 403 for group-level policy', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol-1',
        name: 'Group Policy',
        sourceType: 'group',
      });

      const response = await request(app).delete(url);

      expect(response.status).toBe(403);
      expect(mockDeletePolicy).not.toHaveBeenCalled();
    });

    it('should return 500 when getPolicy throws', async () => {
      mockGetPolicy.mockRejectedValue(new Error('Not found'));

      const response = await request(app).delete(url);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should return 500 when deletePolicy throws', async () => {
      mockGetPolicy.mockResolvedValue(systemPolicy);
      mockDeletePolicy.mockRejectedValue(new Error('Delete failed'));

      const response = await request(app).delete(url);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should not call audit when deletePolicy throws', async () => {
      mockGetPolicy.mockResolvedValue(systemPolicy);
      mockDeletePolicy.mockRejectedValue(new Error('Delete failed'));

      await request(app).delete(url);

      expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
    });
  });
});
