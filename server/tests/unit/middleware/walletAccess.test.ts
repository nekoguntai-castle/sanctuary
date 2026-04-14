import { vi, Mock } from 'vitest';
/**
 * Wallet Access Control Middleware Tests
 *
 * Tests for permission enforcement on wallet operations.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
} from '../../helpers/testUtils';
import { sampleWallets, sampleUsers } from '../../fixtures/bitcoin';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock wallet service
vi.mock('../../../src/services/wallet', () => ({
  checkWalletAccess: vi.fn(),
  checkWalletEditAccess: vi.fn(),
  checkWalletOwnerAccess: vi.fn(),
  checkWalletApproveAccess: vi.fn(),
  getUserWalletRole: vi.fn(),
}));

// Import after mocks
import { requireWalletAccess, getWalletAccessRole } from '../../../src/middleware/walletAccess';
import {
  checkWalletAccess,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  checkWalletApproveAccess,
  getUserWalletRole,
} from '../../../src/services/wallet';

describe('Wallet Access Middleware', () => {
  const walletId = 'test-wallet-id';
  const userId = 'test-user-id';
  const username = 'testuser';

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('requireWalletAccess - View Level', () => {
    const middleware = requireWalletAccess('view');

    it('should allow access when user has view permission', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).walletId).toBe(walletId);
      expect((req as any).walletRole).toBe('viewer');
    });

    it('should allow access for signer role', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('signer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).walletRole).toBe('signer');
    });

    it('should allow access for owner role', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('owner');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).walletRole).toBe('owner');
    });

    it('should deny access when user has no permission', async () => {
      (getUserWalletRole as Mock).mockResolvedValue(null);

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 400 when wallet ID is missing', async () => {
      const req = createMockRequest({
        params: {},
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('Wallet ID');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', async () => {
      const req = createMockRequest({
        params: { id: walletId },
        // No user attached
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireWalletAccess - Edit Level', () => {
    const middleware = requireWalletAccess('edit');

    it('should allow edit access for signer', async () => {
      (checkWalletEditAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('signer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow edit access for owner', async () => {
      (checkWalletEditAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('owner');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny edit access for viewer', async () => {
      (getUserWalletRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireWalletAccess - Owner Level', () => {
    const middleware = requireWalletAccess('owner');

    it('should allow owner access only for owner', async () => {
      (checkWalletOwnerAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('owner');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).walletRole).toBe('owner');
    });

    it('should deny owner access for signer', async () => {
      (getUserWalletRole as Mock).mockResolvedValue('signer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny owner access for viewer', async () => {
      (getUserWalletRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Parameter Handling', () => {
    it('should accept walletId from params.id', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('viewer');

      const middleware = requireWalletAccess('view');
      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect((req as any).walletId).toBe(walletId);
    });

    it('should accept walletId from params.walletId', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('viewer');

      const middleware = requireWalletAccess('view');
      const req = createMockRequest({
        params: { walletId: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect((req as any).walletId).toBe(walletId);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on database error', async () => {
      (getUserWalletRole as Mock).mockRejectedValue(new Error('Database error'));

      const middleware = requireWalletAccess('view');
      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireWalletAccess - Approve Level', () => {
    const middleware = requireWalletAccess('approve');

    it('should allow access for users with approve permission', async () => {
      (getUserWalletRole as Mock).mockResolvedValue('approver');

      const req = createMockRequest({
        params: { walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(getUserWalletRole).toHaveBeenCalledWith(walletId, userId);
      expect(next).toHaveBeenCalled();
      expect((req as any).walletId).toBe(walletId);
    });

    it('should deny access for users without approve permission', async () => {
      (getUserWalletRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { walletId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('getWalletAccessRole Helper', () => {
    it('should return user role for wallet', async () => {
      (getUserWalletRole as Mock).mockResolvedValue('signer');

      const role = await getWalletAccessRole(walletId, userId);

      expect(role).toBe('signer');
      expect(getUserWalletRole).toHaveBeenCalledWith(walletId, userId);
    });

    it('should return null for no access', async () => {
      (getUserWalletRole as Mock).mockResolvedValue(null);

      const role = await getWalletAccessRole(walletId, userId);

      expect(role).toBeNull();
    });
  });

  describe('Role Hierarchy', () => {
    it('owner should have all access levels', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (checkWalletEditAccess as Mock).mockResolvedValue(true);
      (checkWalletOwnerAccess as Mock).mockResolvedValue(true);
      (getUserWalletRole as Mock).mockResolvedValue('owner');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });

      // Test view
      let middleware = requireWalletAccess('view');
      let { res } = createMockResponse();
      let next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();

      // Test edit
      middleware = requireWalletAccess('edit');
      ({ res } = createMockResponse());
      next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();

      // Test owner
      middleware = requireWalletAccess('owner');
      ({ res } = createMockResponse());
      next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('signer should have view and edit but not owner access', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (checkWalletEditAccess as Mock).mockResolvedValue(true);
      (checkWalletOwnerAccess as Mock).mockResolvedValue(false);
      (getUserWalletRole as Mock).mockResolvedValue('signer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });

      // Test view - should pass
      let middleware = requireWalletAccess('view');
      let { res } = createMockResponse();
      let next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();

      // Test edit - should pass
      middleware = requireWalletAccess('edit');
      ({ res } = createMockResponse());
      next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();

      // Test owner - should fail
      middleware = requireWalletAccess('owner');
      const response = createMockResponse();
      next = createMockNext();
      await middleware(req as any, response.res as any, next);
      expect(response.getResponse().statusCode).toBe(403);
    });

    it('viewer should only have view access', async () => {
      (checkWalletAccess as Mock).mockResolvedValue(true);
      (checkWalletEditAccess as Mock).mockResolvedValue(false);
      (checkWalletOwnerAccess as Mock).mockResolvedValue(false);
      (getUserWalletRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { id: walletId },
        user: { userId, username, isAdmin: false },
      });

      // Test view - should pass
      let middleware = requireWalletAccess('view');
      let { res } = createMockResponse();
      let next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();

      // Test edit - should fail
      middleware = requireWalletAccess('edit');
      let response = createMockResponse();
      next = createMockNext();
      await middleware(req as any, response.res as any, next);
      expect(response.getResponse().statusCode).toBe(403);

      // Test owner - should fail
      middleware = requireWalletAccess('owner');
      response = createMockResponse();
      next = createMockNext();
      await middleware(req as any, response.res as any, next);
      expect(response.getResponse().statusCode).toBe(403);
    });
  });
});
