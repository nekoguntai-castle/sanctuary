/**
 * Wallet Approvals Routes Tests
 *
 * Tests for the wallet-scoped approval API endpoints:
 * - GET /:walletId/drafts/:draftId/approvals (list approvals for a draft)
 * - POST /:walletId/drafts/:draftId/approvals/:requestId/vote (cast a vote)
 * - POST /:walletId/drafts/:draftId/override (owner force-approve)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const {
  mockGetApprovalsForDraft,
  mockCastVote,
  mockOwnerOverride,
  mockAuditLogFromRequest,
} = vi.hoisted(() => ({
  mockGetApprovalsForDraft: vi.fn(),
  mockCastVote: vi.fn(),
  mockOwnerOverride: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId;
    next();
  },
}));

vi.mock('../../../src/services/vaultPolicy/approvalService', () => ({
  approvalService: {
    getApprovalsForDraft: mockGetApprovalsForDraft,
    castVote: mockCastVote,
    ownerOverride: mockOwnerOverride,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditAction: {
    POLICY_APPROVAL_VOTE: 'wallet.policy_approval_vote',
    POLICY_OVERRIDE: 'wallet.policy_override',
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
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import approvalsRouter from '../../../src/api/wallets/approvals';

/**
 * Wraps an Express Router so that async handler rejections are forwarded to
 * Express error-handling middleware (Express 4 does not do this natively).
 */
function wrapAsyncRouter(
  router: express.Router,
): express.Router {
  const wrapped = express.Router();
  const stack = (router as any).stack as any[];
  for (const layer of stack) {
    if (layer.route) {
      const route = layer.route;
      for (const routeLayer of route.stack) {
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

describe('Wallet Approvals Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Simulate authenticated user
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.user = { userId: 'user-1', username: 'alice', isAdmin: false } as any;
      next();
    });
    app.use('/api/v1/wallets', wrapAsyncRouter(approvalsRouter));
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
  // GET /:walletId/drafts/:draftId/approvals
  // =========================================================================

  describe('GET /api/v1/wallets/:walletId/drafts/:draftId/approvals', () => {
    const url = '/api/v1/wallets/wallet-1/drafts/draft-1/approvals';

    it('should return approvals for a draft', async () => {
      const mockApprovals = [
        { id: 'req-1', status: 'pending', requiredApprovals: 2 },
        { id: 'req-2', status: 'approved', requiredApprovals: 1 },
      ];
      mockGetApprovalsForDraft.mockResolvedValue(mockApprovals);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ approvals: mockApprovals });
      expect(mockGetApprovalsForDraft).toHaveBeenCalledWith('draft-1');
    });

    it('should return empty array when no approvals exist', async () => {
      mockGetApprovalsForDraft.mockResolvedValue([]);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ approvals: [] });
    });

    it('should return 500 when service throws', async () => {
      mockGetApprovalsForDraft.mockRejectedValue(new Error('DB failure'));

      const response = await request(app).get(url);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // =========================================================================
  // POST /:walletId/drafts/:draftId/approvals/:requestId/vote
  // =========================================================================

  describe('POST /api/v1/wallets/:walletId/drafts/:draftId/approvals/:requestId/vote', () => {
    const url = '/api/v1/wallets/wallet-1/drafts/draft-1/approvals/req-1/vote';

    const mockVoteResult = {
      vote: {
        id: 'vote-1',
        decision: 'approve',
        reason: 'Looks good',
        createdAt: '2026-01-01T00:00:00Z',
      },
      request: {
        id: 'req-1',
        status: 'approved',
        requiredApprovals: 2,
        votes: [
          { decision: 'approve' },
          { decision: 'approve' },
        ],
      },
    };

    it('should cast an approve vote successfully', async () => {
      mockCastVote.mockResolvedValue(mockVoteResult);

      const response = await request(app)
        .post(url)
        .send({ decision: 'approve', reason: 'Looks good' });

      expect(response.status).toBe(200);
      expect(mockCastVote).toHaveBeenCalledWith('req-1', 'user-1', 'approve', 'Looks good');
      expect(response.body.vote).toEqual({
        id: 'vote-1',
        decision: 'approve',
        reason: 'Looks good',
        createdAt: '2026-01-01T00:00:00Z',
      });
      expect(response.body.request).toEqual({
        id: 'req-1',
        status: 'approved',
        requiredApprovals: 2,
        currentApprovals: 2,
        totalVotes: 2,
      });
    });

    it('should cast a reject vote successfully', async () => {
      const rejectResult = {
        vote: {
          id: 'vote-2',
          decision: 'reject',
          reason: 'Too high',
          createdAt: '2026-01-01T00:00:00Z',
        },
        request: {
          id: 'req-1',
          status: 'pending',
          requiredApprovals: 2,
          votes: [
            { decision: 'approve' },
            { decision: 'reject' },
          ],
        },
      };
      mockCastVote.mockResolvedValue(rejectResult);

      const response = await request(app)
        .post(url)
        .send({ decision: 'reject', reason: 'Too high' });

      expect(response.status).toBe(200);
      expect(mockCastVote).toHaveBeenCalledWith('req-1', 'user-1', 'reject', 'Too high');
      expect(response.body.request.currentApprovals).toBe(1);
      expect(response.body.request.totalVotes).toBe(2);
    });

    it('should cast a veto vote successfully', async () => {
      const vetoResult = {
        vote: {
          id: 'vote-3',
          decision: 'veto',
          reason: 'Suspicious',
          createdAt: '2026-01-01T00:00:00Z',
        },
        request: {
          id: 'req-1',
          status: 'rejected',
          requiredApprovals: 2,
          votes: [{ decision: 'veto' }],
        },
      };
      mockCastVote.mockResolvedValue(vetoResult);

      const response = await request(app)
        .post(url)
        .send({ decision: 'veto', reason: 'Suspicious' });

      expect(response.status).toBe(200);
      expect(mockCastVote).toHaveBeenCalledWith('req-1', 'user-1', 'veto', 'Suspicious');
    });

    it('should accept vote without reason', async () => {
      mockCastVote.mockResolvedValue(mockVoteResult);

      const response = await request(app)
        .post(url)
        .send({ decision: 'approve' });

      expect(response.status).toBe(200);
      expect(mockCastVote).toHaveBeenCalledWith('req-1', 'user-1', 'approve', undefined);
    });

    it('should log audit event after successful vote', async () => {
      mockCastVote.mockResolvedValue(mockVoteResult);

      await request(app)
        .post(url)
        .send({ decision: 'approve', reason: 'LGTM' });

      expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_approval_vote',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            draftId: 'draft-1',
            requestId: 'req-1',
            decision: 'approve',
            reason: 'LGTM',
            requestStatus: 'approved',
          },
        },
      );
    });

    it('should log audit with null reason when reason not provided', async () => {
      mockCastVote.mockResolvedValue(mockVoteResult);

      await request(app)
        .post(url)
        .send({ decision: 'approve' });

      expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_approval_vote',
        'wallet',
        expect.objectContaining({
          details: expect.objectContaining({
            reason: null,
          }),
        }),
      );
    });

    it('should return 400 when decision is missing', async () => {
      const response = await request(app)
        .post(url)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('decision is required and must be one of: approve, reject, veto');
      expect(mockCastVote).not.toHaveBeenCalled();
    });

    it('should return 400 when decision is invalid', async () => {
      const response = await request(app)
        .post(url)
        .send({ decision: 'maybe' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('decision is required and must be one of: approve, reject, veto');
      expect(mockCastVote).not.toHaveBeenCalled();
    });

    it('should return 400 when decision is empty string', async () => {
      const response = await request(app)
        .post(url)
        .send({ decision: '' });

      expect(response.status).toBe(400);
      expect(mockCastVote).not.toHaveBeenCalled();
    });

    it('should return 500 when castVote throws', async () => {
      mockCastVote.mockRejectedValue(new Error('Vote failed'));

      const response = await request(app)
        .post(url)
        .send({ decision: 'approve' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should not call audit when castVote throws', async () => {
      mockCastVote.mockRejectedValue(new Error('Vote failed'));

      await request(app)
        .post(url)
        .send({ decision: 'approve' });

      expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // POST /:walletId/drafts/:draftId/override
  // =========================================================================

  describe('POST /api/v1/wallets/:walletId/drafts/:draftId/override', () => {
    const url = '/api/v1/wallets/wallet-1/drafts/draft-1/override';

    it('should override approvals successfully', async () => {
      mockOwnerOverride.mockResolvedValue(undefined);

      const response = await request(app)
        .post(url)
        .send({ reason: 'Urgent payment needed' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'All pending approvals have been force-approved',
      });
      expect(mockOwnerOverride).toHaveBeenCalledWith(
        'draft-1',
        'wallet-1',
        'user-1',
        'Urgent payment needed',
      );
    });

    it('should trim the reason before passing to service', async () => {
      mockOwnerOverride.mockResolvedValue(undefined);

      await request(app)
        .post(url)
        .send({ reason: '  Urgent payment  ' });

      expect(mockOwnerOverride).toHaveBeenCalledWith(
        'draft-1',
        'wallet-1',
        'user-1',
        'Urgent payment',
      );
    });

    it('should log audit event after successful override', async () => {
      mockOwnerOverride.mockResolvedValue(undefined);

      await request(app)
        .post(url)
        .send({ reason: 'Emergency' });

      expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_override',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            draftId: 'draft-1',
            reason: 'Emergency',
          },
        },
      );
    });

    it('should log audit with trimmed reason', async () => {
      mockOwnerOverride.mockResolvedValue(undefined);

      await request(app)
        .post(url)
        .send({ reason: '  Trimmed reason  ' });

      expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_override',
        'wallet',
        expect.objectContaining({
          details: expect.objectContaining({
            reason: 'Trimmed reason',
          }),
        }),
      );
    });

    it('should return 400 when reason is missing', async () => {
      const response = await request(app)
        .post(url)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('A reason is required for owner override');
      expect(mockOwnerOverride).not.toHaveBeenCalled();
    });

    it('should return 400 when reason is empty string', async () => {
      const response = await request(app)
        .post(url)
        .send({ reason: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('A reason is required for owner override');
      expect(mockOwnerOverride).not.toHaveBeenCalled();
    });

    it('should return 400 when reason is only whitespace', async () => {
      const response = await request(app)
        .post(url)
        .send({ reason: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('A reason is required for owner override');
      expect(mockOwnerOverride).not.toHaveBeenCalled();
    });

    it('should return 400 when reason is not a string', async () => {
      const response = await request(app)
        .post(url)
        .send({ reason: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('A reason is required for owner override');
      expect(mockOwnerOverride).not.toHaveBeenCalled();
    });

    it('should return 500 when ownerOverride throws', async () => {
      mockOwnerOverride.mockRejectedValue(new Error('Override failed'));

      const response = await request(app)
        .post(url)
        .send({ reason: 'Valid reason' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should not call audit when ownerOverride throws', async () => {
      mockOwnerOverride.mockRejectedValue(new Error('Override failed'));

      await request(app)
        .post(url)
        .send({ reason: 'Valid reason' });

      expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
    });
  });
});
