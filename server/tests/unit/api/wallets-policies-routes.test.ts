import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const {
  mockGetWalletPolicies,
  mockGetPolicyInWallet,
  mockCreatePolicy,
  mockUpdatePolicy,
  mockDeletePolicy,
  mockEvaluatePolicies,
  mockFindPolicyEvents,
  mockFindPolicyAddresses,
  mockCreatePolicyAddress,
  mockRemovePolicyAddress,
  mockFindPolicyAddressById,
  mockFindById,
  mockLogFromRequest,
} = vi.hoisted(() => ({
  mockGetWalletPolicies: vi.fn(),
  mockGetPolicyInWallet: vi.fn(),
  mockCreatePolicy: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockDeletePolicy: vi.fn(),
  mockEvaluatePolicies: vi.fn(),
  mockFindPolicyEvents: vi.fn(),
  mockFindPolicyAddresses: vi.fn(),
  mockCreatePolicyAddress: vi.fn(),
  mockRemovePolicyAddress: vi.fn(),
  mockFindPolicyAddressById: vi.fn(),
  mockFindById: vi.fn(),
  mockLogFromRequest: vi.fn(),
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.wallet = { id: 'wallet-1', userRole: 'owner' };
    next();
  },
}));

vi.mock('../../../src/services/vaultPolicy', () => ({
  vaultPolicyService: {
    getWalletPolicies: mockGetWalletPolicies,
    getPolicyInWallet: mockGetPolicyInWallet,
    createPolicy: mockCreatePolicy,
    updatePolicy: mockUpdatePolicy,
    deletePolicy: mockDeletePolicy,
  },
  policyEvaluationEngine: {
    evaluatePolicies: mockEvaluatePolicies,
  },
}));

vi.mock('../../../src/repositories/policyRepository', () => ({
  policyRepository: {
    findPolicyEvents: mockFindPolicyEvents,
    findPolicyAddresses: mockFindPolicyAddresses,
    createPolicyAddress: mockCreatePolicyAddress,
    removePolicyAddress: mockRemovePolicyAddress,
    findPolicyAddressById: mockFindPolicyAddressById,
  },
}));

vi.mock('../../../src/repositories/walletRepository', () => ({
  walletRepository: {
    findById: mockFindById,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockLogFromRequest,
  },
  AuditAction: {
    POLICY_CREATE: 'wallet.policy_create',
    POLICY_UPDATE: 'wallet.policy_update',
    POLICY_DELETE: 'wallet.policy_delete',
  },
  AuditCategory: {
    WALLET: 'wallet',
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
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import policiesRouter from '../../../src/api/wallets/policies';

/**
 * Wrap all async route handlers on an Express Router so that rejected promises
 * are forwarded to `next()`. Required because Express 4.x does not natively
 * catch async errors, which would otherwise cause unhandled promise rejections
 * in tests.
 */
function wrapAsyncRouterHandlers(router: any): void {
  for (const layer of router.stack) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack) {
        const originalHandle = routeLayer.handle;
        if (originalHandle.constructor.name === 'AsyncFunction') {
          routeLayer.handle = function wrappedHandler(req: Request, res: Response, next: NextFunction) {
            return Promise.resolve(originalHandle(req, res, next)).catch(next);
          };
        }
      }
    }
  }
}

describe('Wallet Policies Routes', () => {
  let app: Express;

  beforeAll(() => {
    // Wrap the router's async handlers to forward errors to Express error middleware
    wrapAsyncRouterHandlers(policiesRouter);

    app = express();
    app.use(express.json());
    // Inject req.user for all requests (simulates authenticate middleware)
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
      next();
    });
    app.use('/api/v1/wallets', policiesRouter);
    // Error-handling middleware to capture thrown errors from async handlers
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogFromRequest.mockResolvedValue(undefined);
  });

  // ========================================
  // GET /:walletId/policies/events
  // ========================================
  describe('GET /:walletId/policies/events', () => {
    it('returns policy events with default pagination', async () => {
      const eventsResult = { events: [{ id: 'evt-1' }], total: 1 };
      mockFindPolicyEvents.mockResolvedValue(eventsResult);

      const response = await request(app).get('/api/v1/wallets/wallet-1/policies/events');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(eventsResult);
      expect(mockFindPolicyEvents).toHaveBeenCalledWith('wallet-1', {
        policyId: undefined,
        eventType: undefined,
        from: undefined,
        to: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('passes query filters to findPolicyEvents', async () => {
      mockFindPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({
          policyId: 'pol-1',
          eventType: 'trigger',
          from: '2025-01-01T00:00:00Z',
          to: '2025-12-31T23:59:59Z',
          limit: '10',
          offset: '5',
        });

      expect(response.status).toBe(200);
      expect(mockFindPolicyEvents).toHaveBeenCalledWith('wallet-1', {
        policyId: 'pol-1',
        eventType: 'trigger',
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-12-31T23:59:59Z'),
        limit: 10,
        offset: 5,
      });
    });

    it('clamps limit to MAX_PAGE_LIMIT (200)', async () => {
      mockFindPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await request(app)
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ limit: '500' });

      expect(mockFindPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ limit: 200 })
      );
    });

    it('clamps limit minimum to 1', async () => {
      mockFindPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await request(app)
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ limit: '0' });

      expect(mockFindPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ limit: 1 })
      );
    });

    it('falls back to default limit when NaN', async () => {
      mockFindPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await request(app)
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ limit: 'abc' });

      expect(mockFindPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ limit: 50 })
      );
    });

    it('falls back to default offset when NaN', async () => {
      mockFindPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await request(app)
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ offset: 'abc' });

      expect(mockFindPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ offset: 0 })
      );
    });

    it('clamps negative offset to 0', async () => {
      mockFindPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await request(app)
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ offset: '-5' });

      expect(mockFindPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ offset: 0 })
      );
    });

    it('returns 500 when findPolicyEvents throws', async () => {
      mockFindPolicyEvents.mockRejectedValue(new Error('db failure'));

      const response = await request(app).get('/api/v1/wallets/wallet-1/policies/events');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // POST /:walletId/policies/evaluate
  // ========================================
  describe('POST /:walletId/policies/evaluate', () => {
    it('evaluates policies for a valid request', async () => {
      const evalResult = { allowed: true, triggeredPolicies: [] };
      mockEvaluatePolicies.mockResolvedValue(evalResult);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 50000 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(evalResult);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith({
        walletId: 'wallet-1',
        userId: 'user-1',
        recipient: 'tb1qaddr',
        amount: BigInt(50000),
        outputs: undefined,
        preview: true,
      });
    });

    it('accepts string amount', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: '100000' });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ amount: BigInt(100000) })
      );
    });

    it('passes outputs to evaluator', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });
      const outputs = [{ address: 'tb1qout', amount: 50000 }];

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 50000, outputs });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ outputs })
      );
    });

    it('returns 400 when recipient is missing', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ amount: 50000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('recipient and amount are required');
    });

    it('returns 400 when amount is missing', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('recipient and amount are required');
    });

    it('returns 400 when amount is undefined', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('recipient and amount are required');
    });

    it('returns 400 when amount is not a valid integer string', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 'abc' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('amount must be a valid non-negative integer');
    });

    it('returns 400 when amount is a negative string', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: '-100' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('amount must be a valid non-negative integer');
    });

    it('returns 400 when amount is a boolean', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('amount must be a valid non-negative integer');
    });

    it('accepts amount of 0 (number)', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 0 });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ amount: BigInt(0) })
      );
    });

    it('accepts amount of "0" (string)', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: '0' });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ amount: BigInt(0) })
      );
    });

    it('returns 500 when evaluatePolicies throws', async () => {
      mockEvaluatePolicies.mockRejectedValue(new Error('eval failure'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 50000 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // GET /:walletId/policies
  // ========================================
  describe('GET /:walletId/policies', () => {
    it('lists policies including inherited by default', async () => {
      const policies = [{ id: 'pol-1', name: 'Spending Limit' }];
      mockFindById.mockResolvedValue({ id: 'wallet-1', groupId: 'group-1' });
      mockGetWalletPolicies.mockResolvedValue(policies);

      const response = await request(app).get('/api/v1/wallets/wallet-1/policies');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policies });
      expect(mockFindById).toHaveBeenCalledWith('wallet-1');
      expect(mockGetWalletPolicies).toHaveBeenCalledWith('wallet-1', {
        includeInherited: true,
        walletGroupId: 'group-1',
      });
    });

    it('excludes inherited when includeInherited=false', async () => {
      mockFindById.mockResolvedValue({ id: 'wallet-1', groupId: null });
      mockGetWalletPolicies.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies')
        .query({ includeInherited: 'false' });

      expect(response.status).toBe(200);
      expect(mockGetWalletPolicies).toHaveBeenCalledWith('wallet-1', {
        includeInherited: false,
        walletGroupId: null,
      });
    });

    it('handles wallet not found (null from findById)', async () => {
      mockFindById.mockResolvedValue(null);
      mockGetWalletPolicies.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/wallets/wallet-1/policies');

      expect(response.status).toBe(200);
      expect(mockGetWalletPolicies).toHaveBeenCalledWith('wallet-1', {
        includeInherited: true,
        walletGroupId: undefined,
      });
    });

    it('returns 500 when service throws', async () => {
      mockFindById.mockRejectedValue(new Error('db error'));

      const response = await request(app).get('/api/v1/wallets/wallet-1/policies');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // GET /:walletId/policies/:policyId
  // ========================================
  describe('GET /:walletId/policies/:policyId', () => {
    it('returns a specific policy', async () => {
      const policy = { id: 'pol-1', name: 'Spending Limit', walletId: 'wallet-1' };
      mockGetPolicyInWallet.mockResolvedValue(policy);

      const response = await request(app).get('/api/v1/wallets/wallet-1/policies/pol-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policy });
      expect(mockGetPolicyInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1');
    });

    it('returns 500 when getPolicyInWallet throws', async () => {
      mockGetPolicyInWallet.mockRejectedValue(new Error('not found'));

      const response = await request(app).get('/api/v1/wallets/wallet-1/policies/pol-missing');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // POST /:walletId/policies
  // ========================================
  describe('POST /:walletId/policies', () => {
    const createPayload = {
      name: 'Daily Limit',
      description: 'Max 1 BTC per day',
      type: 'spending_limit',
      config: { maxAmount: '100000000', windowType: 'rolling', windowDuration: 86400 },
      priority: 10,
      enforcement: 'block',
      enabled: true,
    };

    it('creates a new policy and logs audit event', async () => {
      const createdPolicy = {
        id: 'pol-new',
        name: 'Daily Limit',
        type: 'spending_limit',
        walletId: 'wallet-1',
      };
      mockCreatePolicy.mockResolvedValue(createdPolicy);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies')
        .send(createPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ policy: createdPolicy });
      expect(mockCreatePolicy).toHaveBeenCalledWith('user-1', {
        walletId: 'wallet-1',
        name: 'Daily Limit',
        description: 'Max 1 BTC per day',
        type: 'spending_limit',
        config: createPayload.config,
        priority: 10,
        enforcement: 'block',
        enabled: true,
      });
      expect(mockLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_create',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            policyId: 'pol-new',
            policyName: 'Daily Limit',
            policyType: 'spending_limit',
          },
        }
      );
    });

    it('creates a policy with minimal fields (undefined optional fields)', async () => {
      const createdPolicy = { id: 'pol-2', name: 'Basic', type: 'spending_limit' };
      mockCreatePolicy.mockResolvedValue(createdPolicy);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies')
        .send({ name: 'Basic', type: 'spending_limit' });

      expect(response.status).toBe(201);
      expect(mockCreatePolicy).toHaveBeenCalledWith('user-1', {
        walletId: 'wallet-1',
        name: 'Basic',
        description: undefined,
        type: 'spending_limit',
        config: undefined,
        priority: undefined,
        enforcement: undefined,
        enabled: undefined,
      });
    });

    it('returns 500 when createPolicy throws', async () => {
      mockCreatePolicy.mockRejectedValue(new Error('validation failed'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies')
        .send(createPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // PATCH /:walletId/policies/:policyId
  // ========================================
  describe('PATCH /:walletId/policies/:policyId', () => {
    it('updates a policy and logs audit event', async () => {
      const existingPolicy = { id: 'pol-1', walletId: 'wallet-1' };
      const updatedPolicy = { id: 'pol-1', name: 'Updated Name', walletId: 'wallet-1' };
      mockGetPolicyInWallet.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockResolvedValue(updatedPolicy);

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send({ name: 'Updated Name', enabled: false });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policy: updatedPolicy });
      expect(mockGetPolicyInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1');
      expect(mockUpdatePolicy).toHaveBeenCalledWith('pol-1', 'user-1', {
        name: 'Updated Name',
        enabled: false,
      });
      expect(mockLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_update',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            policyId: 'pol-1',
            updatedFields: ['name', 'enabled'],
          },
        }
      );
    });

    it('handles all updateable fields', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockUpdatePolicy.mockResolvedValue({ id: 'pol-1' });

      const patchBody = {
        name: 'New Name',
        description: 'New description',
        config: { maxAmount: '500000' },
        priority: 5,
        enforcement: 'warn',
        enabled: true,
      };

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send(patchBody);

      expect(response.status).toBe(200);
      expect(mockUpdatePolicy).toHaveBeenCalledWith('pol-1', 'user-1', patchBody);
    });

    it('sends empty input object when no fields are provided', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockUpdatePolicy.mockResolvedValue({ id: 'pol-1' });

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send({});

      expect(response.status).toBe(200);
      expect(mockUpdatePolicy).toHaveBeenCalledWith('pol-1', 'user-1', {});
    });

    it('returns 500 when getPolicyInWallet throws (policy not in wallet)', async () => {
      mockGetPolicyInWallet.mockRejectedValue(new Error('Policy not found'));

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-1/policies/pol-missing')
        .send({ name: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('returns 500 when updatePolicy throws', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockUpdatePolicy.mockRejectedValue(new Error('update error'));

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send({ name: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // DELETE /:walletId/policies/:policyId
  // ========================================
  describe('DELETE /:walletId/policies/:policyId', () => {
    it('deletes a policy and logs audit event', async () => {
      mockDeletePolicy.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockDeletePolicy).toHaveBeenCalledWith('pol-1', 'wallet-1');
      expect(mockLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_delete',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            policyId: 'pol-1',
          },
        }
      );
    });

    it('returns 500 when deletePolicy throws', async () => {
      mockDeletePolicy.mockRejectedValue(new Error('delete failed'));

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // GET /:walletId/policies/:policyId/addresses
  // ========================================
  describe('GET /:walletId/policies/:policyId/addresses', () => {
    it('lists addresses for a policy', async () => {
      const addresses = [{ id: 'addr-1', address: 'tb1qfoo', listType: 'allow' }];
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', walletId: 'wallet-1' });
      mockFindPolicyAddresses.mockResolvedValue(addresses);

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ addresses });
      expect(mockGetPolicyInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1');
      expect(mockFindPolicyAddresses).toHaveBeenCalledWith('pol-1', undefined);
    });

    it('filters by listType=allow', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockFindPolicyAddresses.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .query({ listType: 'allow' });

      expect(response.status).toBe(200);
      expect(mockFindPolicyAddresses).toHaveBeenCalledWith('pol-1', 'allow');
    });

    it('filters by listType=deny', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockFindPolicyAddresses.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .query({ listType: 'deny' });

      expect(response.status).toBe(200);
      expect(mockFindPolicyAddresses).toHaveBeenCalledWith('pol-1', 'deny');
    });

    it('ignores invalid listType values', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockFindPolicyAddresses.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .query({ listType: 'invalid' });

      expect(response.status).toBe(200);
      expect(mockFindPolicyAddresses).toHaveBeenCalledWith('pol-1', undefined);
    });

    it('returns 500 when getPolicyInWallet throws', async () => {
      mockGetPolicyInWallet.mockRejectedValue(new Error('not found'));

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('returns 500 when findPolicyAddresses throws', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockFindPolicyAddresses.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // POST /:walletId/policies/:policyId/addresses
  // ========================================
  describe('POST /:walletId/policies/:policyId/addresses', () => {
    it('adds an address to an address_control policy', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });
      const createdAddress = { id: 'addr-new', address: 'tb1qfoo', listType: 'allow', policyId: 'pol-1' };
      mockCreatePolicyAddress.mockResolvedValue(createdAddress);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'allow', label: 'My Label' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ address: createdAddress });
      expect(mockGetPolicyInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1');
      expect(mockCreatePolicyAddress).toHaveBeenCalledWith({
        policyId: 'pol-1',
        address: 'tb1qfoo',
        label: 'My Label',
        listType: 'allow',
        addedBy: 'user-1',
      });
    });

    it('adds an address with deny listType', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });
      mockCreatePolicyAddress.mockResolvedValue({ id: 'addr-new', listType: 'deny' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qbar', listType: 'deny' });

      expect(response.status).toBe(201);
      expect(mockCreatePolicyAddress).toHaveBeenCalledWith(
        expect.objectContaining({ listType: 'deny' })
      );
    });

    it('returns 400 when policy is not address_control type', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'spending_limit' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Address lists can only be managed on address_control policies');
    });

    it('returns 400 when address is missing', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('address and listType are required');
    });

    it('returns 400 when listType is missing', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('address and listType are required');
    });

    it('returns 400 when both address and listType are missing', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('address and listType are required');
    });

    it('returns 400 when address is not a string', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 12345, listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('address must be a string of 100 characters or fewer');
    });

    it('returns 400 when address exceeds 100 characters', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'a'.repeat(101), listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('address must be a string of 100 characters or fewer');
    });

    it('accepts address at exactly 100 characters', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });
      mockCreatePolicyAddress.mockResolvedValue({ id: 'addr-new' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'a'.repeat(100), listType: 'allow' });

      expect(response.status).toBe(201);
    });

    it('returns 400 when listType is invalid', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'block' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('listType must be "allow" or "deny"');
    });

    it('returns 500 when getPolicyInWallet throws', async () => {
      mockGetPolicyInWallet.mockRejectedValue(new Error('not found'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'allow' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('returns 500 when createPolicyAddress throws', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', type: 'address_control' });
      mockCreatePolicyAddress.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'allow' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ========================================
  // DELETE /:walletId/policies/:policyId/addresses/:addressId
  // ========================================
  describe('DELETE /:walletId/policies/:policyId/addresses/:addressId', () => {
    it('removes an address from a policy', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', walletId: 'wallet-1' });
      mockFindPolicyAddressById.mockResolvedValue({ id: 'addr-1', policyId: 'pol-1' });
      mockRemovePolicyAddress.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockGetPolicyInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1');
      expect(mockFindPolicyAddressById).toHaveBeenCalledWith('addr-1');
      expect(mockRemovePolicyAddress).toHaveBeenCalledWith('addr-1');
    });

    it('returns 404 when address is not found', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', walletId: 'wallet-1' });
      mockFindPolicyAddressById.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Address not found in this policy');
    });

    it('returns 404 when address belongs to a different policy', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', walletId: 'wallet-1' });
      mockFindPolicyAddressById.mockResolvedValue({ id: 'addr-1', policyId: 'pol-other' });

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Address not found in this policy');
    });

    it('returns 500 when getPolicyInWallet throws', async () => {
      mockGetPolicyInWallet.mockRejectedValue(new Error('not found'));

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('returns 500 when findPolicyAddressById throws', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', walletId: 'wallet-1' });
      mockFindPolicyAddressById.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('returns 500 when removePolicyAddress throws', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1', walletId: 'wallet-1' });
      mockFindPolicyAddressById.mockResolvedValue({ id: 'addr-1', policyId: 'pol-1' });
      mockRemovePolicyAddress.mockRejectedValue(new Error('delete error'));

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });
});
