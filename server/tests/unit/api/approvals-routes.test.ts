/**
 * Global Approvals Routes Tests
 *
 * Tests for the cross-wallet approval API endpoint:
 * - GET /api/v1/approvals/pending (list all pending approvals for current user)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const {
  mockGetPendingApprovalsForUser,
  mockFindManyWalletUser,
} = vi.hoisted(() => ({
  mockGetPendingApprovalsForUser: vi.fn(),
  mockFindManyWalletUser: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
    next();
  },
}));

vi.mock('../../../src/services/vaultPolicy/approvalService', () => ({
  approvalService: {
    getPendingApprovalsForUser: mockGetPendingApprovalsForUser,
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    walletUser: {
      findMany: mockFindManyWalletUser,
    },
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

import approvalsRouter from '../../../src/api/approvals';

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

describe('Global Approvals Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', wrapAsyncRouter(approvalsRouter));
    // Error handler to catch re-thrown errors
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // GET /api/v1/approvals/pending
  // =========================================================================

  describe('GET /api/v1/approvals/pending', () => {
    const url = '/api/v1/approvals/pending';

    it('should return pending approvals for wallets the user can approve', async () => {
      mockFindManyWalletUser.mockResolvedValue([
        { walletId: 'wallet-1' },
        { walletId: 'wallet-2' },
      ]);

      const mockPending = [
        {
          id: 'req-1',
          draftTransactionId: 'draft-1',
          draftTransaction: { walletId: 'wallet-1', recipient: 'tb1qrecipient1', amount: BigInt(50000) },
          status: 'pending',
          requiredApprovals: 2,
          votes: [{ decision: 'approve' }],
          expiresAt: '2026-04-01T00:00:00Z',
          createdAt: '2026-03-17T00:00:00Z',
        },
        {
          id: 'req-2',
          draftTransactionId: 'draft-2',
          draftTransaction: { walletId: 'wallet-2', recipient: 'tb1qrecipient2', amount: BigInt(100000) },
          status: 'pending',
          requiredApprovals: 3,
          votes: [{ decision: 'approve' }, { decision: 'reject' }],
          expiresAt: '2026-04-02T00:00:00Z',
          createdAt: '2026-03-18T00:00:00Z',
        },
      ];
      mockGetPendingApprovalsForUser.mockResolvedValue(mockPending);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(mockFindManyWalletUser).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          role: { in: ['owner', 'approver'] },
        },
        select: { walletId: true },
      });
      expect(mockGetPendingApprovalsForUser).toHaveBeenCalledWith(['wallet-1', 'wallet-2']);
      expect(response.body.total).toBe(2);
      expect(response.body.approvals).toHaveLength(2);
      expect(response.body.approvals[0]).toEqual({
        id: 'req-1',
        draftTransactionId: 'draft-1',
        walletId: 'wallet-1',
        status: 'pending',
        requiredApprovals: 2,
        currentApprovals: 1,
        totalVotes: 1,
        recipient: 'tb1qrecipient1',
        amount: '50000',
        expiresAt: '2026-04-01T00:00:00Z',
        createdAt: '2026-03-17T00:00:00Z',
      });
      expect(response.body.approvals[1]).toEqual({
        id: 'req-2',
        draftTransactionId: 'draft-2',
        walletId: 'wallet-2',
        status: 'pending',
        requiredApprovals: 3,
        currentApprovals: 1,
        totalVotes: 2,
        recipient: 'tb1qrecipient2',
        amount: '100000',
        expiresAt: '2026-04-02T00:00:00Z',
        createdAt: '2026-03-18T00:00:00Z',
      });
    });

    it('should return empty results when user has no approve-capable roles', async () => {
      mockFindManyWalletUser.mockResolvedValue([]);
      mockGetPendingApprovalsForUser.mockResolvedValue([]);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ approvals: [], total: 0 });
      expect(mockGetPendingApprovalsForUser).toHaveBeenCalledWith([]);
    });

    it('should return empty results when no pending approvals exist', async () => {
      mockFindManyWalletUser.mockResolvedValue([
        { walletId: 'wallet-1' },
      ]);
      mockGetPendingApprovalsForUser.mockResolvedValue([]);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ approvals: [], total: 0 });
    });

    it('should correctly count approvals vs total votes', async () => {
      mockFindManyWalletUser.mockResolvedValue([{ walletId: 'wallet-1' }]);

      const mockPending = [
        {
          id: 'req-1',
          draftTransactionId: 'draft-1',
          draftTransaction: { walletId: 'wallet-1', recipient: 'tb1q1', amount: BigInt(10000) },
          status: 'pending',
          requiredApprovals: 3,
          votes: [
            { decision: 'approve' },
            { decision: 'reject' },
            { decision: 'approve' },
          ],
          expiresAt: null,
          createdAt: '2026-03-17T00:00:00Z',
        },
      ];
      mockGetPendingApprovalsForUser.mockResolvedValue(mockPending);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body.approvals[0].currentApprovals).toBe(2);
      expect(response.body.approvals[0].totalVotes).toBe(3);
    });

    it('should handle approval with zero votes', async () => {
      mockFindManyWalletUser.mockResolvedValue([{ walletId: 'wallet-1' }]);

      const mockPending = [
        {
          id: 'req-1',
          draftTransactionId: 'draft-1',
          draftTransaction: { walletId: 'wallet-1', recipient: 'tb1q1', amount: BigInt(5000) },
          status: 'pending',
          requiredApprovals: 2,
          votes: [],
          expiresAt: null,
          createdAt: '2026-03-17T00:00:00Z',
        },
      ];
      mockGetPendingApprovalsForUser.mockResolvedValue(mockPending);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body.approvals[0].currentApprovals).toBe(0);
      expect(response.body.approvals[0].totalVotes).toBe(0);
    });

    it('should convert BigInt amount to string', async () => {
      mockFindManyWalletUser.mockResolvedValue([{ walletId: 'wallet-1' }]);

      const mockPending = [
        {
          id: 'req-1',
          draftTransactionId: 'draft-1',
          draftTransaction: { walletId: 'wallet-1', recipient: 'tb1q1', amount: BigInt(2100000000000000) },
          status: 'pending',
          requiredApprovals: 1,
          votes: [],
          expiresAt: null,
          createdAt: '2026-03-17T00:00:00Z',
        },
      ];
      mockGetPendingApprovalsForUser.mockResolvedValue(mockPending);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body.approvals[0].amount).toBe('2100000000000000');
    });

    it('should return 500 when walletUser.findMany throws', async () => {
      mockFindManyWalletUser.mockRejectedValue(new Error('DB connection failed'));

      const response = await request(app).get(url);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should return 500 when getPendingApprovalsForUser throws', async () => {
      mockFindManyWalletUser.mockResolvedValue([{ walletId: 'wallet-1' }]);
      mockGetPendingApprovalsForUser.mockRejectedValue(new Error('Service error'));

      const response = await request(app).get(url);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should query only owner and approver roles', async () => {
      mockFindManyWalletUser.mockResolvedValue([]);
      mockGetPendingApprovalsForUser.mockResolvedValue([]);

      await request(app).get(url);

      expect(mockFindManyWalletUser).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: { in: ['owner', 'approver'] },
          }),
        }),
      );
    });

    it('should pass the authenticated user ID to the query', async () => {
      mockFindManyWalletUser.mockResolvedValue([]);
      mockGetPendingApprovalsForUser.mockResolvedValue([]);

      await request(app).get(url);

      expect(mockFindManyWalletUser).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
          }),
        }),
      );
    });
  });
});
