/**
 * Mobile Permissions API Routes Tests
 *
 * Tests for mobile permissions endpoints including:
 * - GET /api/v1/mobile-permissions
 * - GET /api/v1/wallets/:id/mobile-permissions
 * - PATCH /api/v1/wallets/:id/mobile-permissions
 * - PATCH /api/v1/wallets/:id/mobile-permissions/:userId
 * - DELETE /api/v1/wallets/:id/mobile-permissions/:userId/caps
 * - DELETE /api/v1/wallets/:id/mobile-permissions
 * - POST /internal/mobile-permissions/check
 */

import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma BEFORE other imports
vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

// Mock auth middleware to bypass JWT validation
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
}));

// Mock gateway auth middleware
vi.mock('../../../src/middleware/gatewayAuth', () => ({
  verifyGatewayRequest: (req: any, res: any, next: any) => {
    next();
  },
}));

// Mock the mobilePermissionService
vi.mock('../../../src/services/mobilePermissions', () => ({
  mobilePermissionService: {
    getUserMobilePermissions: vi.fn(),
    getEffectivePermissions: vi.fn(),
    getWalletPermissions: vi.fn(),
    updateOwnPermissions: vi.fn(),
    setMaxPermissions: vi.fn(),
    clearMaxPermissions: vi.fn(),
    resetPermissions: vi.fn(),
    checkForGateway: vi.fn(),
  },
  ALL_MOBILE_ACTIONS: [
    'viewBalance',
    'viewTransactions',
    'viewUtxos',
    'createTransaction',
    'broadcast',
    'signPsbt',
    'generateAddress',
    'manageLabels',
    'manageDevices',
    'shareWallet',
    'deleteWallet',
  ],
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import request from 'supertest';
import express from 'express';
import { mobilePermissionService } from '../../../src/services/mobilePermissions';
import { errorHandler } from '../../../src/errors/errorHandler';

// Create test app - must import router AFTER mocks are set up
const createTestApp = async () => {
  const app = express();
  app.use(express.json());

  // Import router dynamically after mocks
  const mobilePermissionsModule = await import('../../../src/api/mobilePermissions');

  // Mount to match how the actual app routes
  app.use('/api/v1', mobilePermissionsModule.default);
  app.use('/internal', mobilePermissionsModule.mobilePermissionsInternalRoutes);
  app.use(errorHandler);

  return app;
};

describe('Mobile Permissions API', () => {
  let app: express.Application;

  const mockPermission = {
    id: 'perm-1',
    walletId: 'wallet-123',
    userId: 'test-user-id',
    canViewBalance: true,
    canViewTransactions: true,
    canViewUtxos: true,
    canCreateTransaction: true,
    canBroadcast: false,
    canSignPsbt: true,
    canGenerateAddress: true,
    canManageLabels: true,
    canManageDevices: false,
    canShareWallet: false,
    canDeleteWallet: false,
    ownerMaxPermissions: null,
    lastModifiedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    wallet: {
      id: 'wallet-123',
      name: 'Test Wallet',
      network: 'mainnet',
      walletUsers: [{ role: 'signer' }],
    },
  };

  const mockEffectivePermissions = {
    walletId: 'wallet-123',
    userId: 'test-user-id',
    role: 'signer',
    permissions: {
      viewBalance: true,
      viewTransactions: true,
      viewUtxos: true,
      createTransaction: true,
      broadcast: false,
      signPsbt: true,
      generateAddress: true,
      manageLabels: true,
      manageDevices: false,
      shareWallet: false,
      deleteWallet: false,
    },
    hasCustomRestrictions: true,
    hasOwnerRestrictions: false,
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('route mounting', () => {
    it('does not expose unversioned mobile permissions routes', async () => {
      const response = await request(app).get('/mobile-permissions');
      expect(response.status).toBe(404);
    });

    it('does not expose wallet-scoped routes without versioning', async () => {
      const response = await request(app).get('/wallets/wallet-123/mobile-permissions');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/v1/mobile-permissions', () => {
    it('should return all mobile permissions for user', async () => {
      vi.mocked(mobilePermissionService.getUserMobilePermissions).mockResolvedValue([
        {
          ...mockPermission,
          role: 'signer',
          effectivePermissions: mockEffectivePermissions.permissions,
        },
      ]);

      const response = await request(app).get('/api/v1/mobile-permissions');

      expect(response.status).toBe(200);
      expect(response.body.permissions).toHaveLength(1);
      expect(response.body.permissions[0].walletId).toBe('wallet-123');
      expect(response.body.permissions[0].walletName).toBe('Test Wallet');
      expect(response.body.permissions[0].role).toBe('signer');
      expect(response.body.permissions[0].effectivePermissions).toBeDefined();
    });

    it('should return empty array when no permissions exist', async () => {
      vi.mocked(mobilePermissionService.getUserMobilePermissions).mockResolvedValue([]);

      const response = await request(app).get('/api/v1/mobile-permissions');

      expect(response.status).toBe(200);
      expect(response.body.permissions).toHaveLength(0);
    });

    it('marks hasCustomRestrictions false when all capabilities are fully enabled', async () => {
      vi.mocked(mobilePermissionService.getUserMobilePermissions).mockResolvedValue([
        {
          ...mockPermission,
          role: 'owner',
          canBroadcast: true,
          canManageDevices: true,
          canShareWallet: true,
          canDeleteWallet: true,
          effectivePermissions: {
            viewBalance: true,
            viewTransactions: true,
            viewUtxos: true,
            createTransaction: true,
            broadcast: true,
            signPsbt: true,
            generateAddress: true,
            manageLabels: true,
            manageDevices: true,
            shareWallet: true,
            deleteWallet: true,
          },
        },
      ] as any);

      const response = await request(app).get('/api/v1/mobile-permissions');

      expect(response.status).toBe(200);
      expect(response.body.permissions[0].hasCustomRestrictions).toBe(false);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(mobilePermissionService.getUserMobilePermissions).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app).get('/api/v1/mobile-permissions');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /api/v1/wallets/:id/mobile-permissions', () => {
    it('should return effective permissions for wallet', async () => {
      vi.mocked(mobilePermissionService.getEffectivePermissions).mockResolvedValue(
        mockEffectivePermissions
      );

      const response = await request(app).get('/api/v1/wallets/wallet-123/mobile-permissions');

      expect(response.status).toBe(200);
      expect(response.body.walletId).toBe('wallet-123');
      expect(response.body.role).toBe('signer');
      expect(response.body.permissions).toBeDefined();
      expect(response.body.hasCustomRestrictions).toBe(true);
    });

    it('should include walletUsers when requester is owner', async () => {
      const ownerPermissions = { ...mockEffectivePermissions, role: 'owner' };
      const walletUsersList = [
        { userId: 'user-1', username: 'alice', role: 'owner', effectivePermissions: {} },
        { userId: 'user-2', username: 'bob', role: 'signer', effectivePermissions: {} },
      ];

      vi.mocked(mobilePermissionService.getEffectivePermissions).mockResolvedValue(ownerPermissions);
      vi.mocked(mobilePermissionService.getWalletPermissions).mockResolvedValue(walletUsersList);

      const response = await request(app).get('/api/v1/wallets/wallet-123/mobile-permissions');

      expect(response.status).toBe(200);
      expect(response.body.walletUsers).toHaveLength(2);
      expect(mobilePermissionService.getWalletPermissions).toHaveBeenCalledWith(
        'wallet-123',
        'test-user-id'
      );
    });

    it('should return 403 when user has no wallet access', async () => {
      vi.mocked(mobilePermissionService.getEffectivePermissions).mockRejectedValue(
        new Error('User does not have access to this wallet')
      );

      const response = await request(app).get('/api/v1/wallets/wallet-123/mobile-permissions');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should return 500 on unexpected service errors', async () => {
      vi.mocked(mobilePermissionService.getEffectivePermissions).mockRejectedValue(
        new Error('Unexpected failure')
      );

      const response = await request(app).get('/api/v1/wallets/wallet-123/mobile-permissions');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /api/v1/wallets/:id/mobile-permissions', () => {
    it('should update own permissions successfully', async () => {
      vi.mocked(mobilePermissionService.updateOwnPermissions).mockResolvedValue(
        mockEffectivePermissions
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions')
        .send({ broadcast: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.permissions).toBeDefined();
      expect(mobilePermissionService.updateOwnPermissions).toHaveBeenCalledWith(
        'wallet-123',
        'test-user-id',
        { broadcast: false },
        'test-user-id'
      );
    });

    it('should reject invalid permission key', async () => {
      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions')
        .send({ invalidKey: true });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
      expect(response.body.message).toContain('Invalid permission key');
    });

    it('should reject non-boolean value', async () => {
      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions')
        .send({ broadcast: 'false' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('must be a boolean');
    });

    it('should reject empty body', async () => {
      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('At least one permission');
    });

    it('should return 403 when trying to exceed owner max', async () => {
      vi.mocked(mobilePermissionService.updateOwnPermissions).mockRejectedValue(
        new Error('Cannot enable broadcast: owner has restricted this permission')
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions')
        .send({ broadcast: true });

      expect(response.status).toBe(500);
      // Error goes through errorHandler as INTERNAL_ERROR
    });

    it('should return 403 when user has no wallet access', async () => {
      vi.mocked(mobilePermissionService.updateOwnPermissions).mockRejectedValue(
        new Error('User does not have access to this wallet')
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions')
        .send({ broadcast: false });

      expect(response.status).toBe(500);
      // Error goes through errorHandler as INTERNAL_ERROR
    });

    it('should return 500 on unexpected update errors', async () => {
      vi.mocked(mobilePermissionService.updateOwnPermissions).mockRejectedValue(
        new Error('Unexpected update failure')
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions')
        .send({ broadcast: false });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /api/v1/wallets/:id/mobile-permissions/:userId', () => {
    it('should set max permissions for user (owner)', async () => {
      vi.mocked(mobilePermissionService.setMaxPermissions).mockResolvedValue({
        ...mockEffectivePermissions,
        hasOwnerRestrictions: true,
      });

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions/target-user-id')
        .send({ broadcast: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.hasOwnerRestrictions).toBe(true);
      expect(mobilePermissionService.setMaxPermissions).toHaveBeenCalledWith(
        'wallet-123',
        'target-user-id',
        'test-user-id',
        { broadcast: false }
      );
    });

    it('should return 403 when caller is not owner', async () => {
      vi.mocked(mobilePermissionService.setMaxPermissions).mockRejectedValue(
        new Error('Only wallet owners can set permission caps')
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions/target-user-id')
        .send({ broadcast: false });

      expect(response.status).toBe(500);
      // Error goes through errorHandler as INTERNAL_ERROR
    });

    it('should return 400 when trying to restrict owner', async () => {
      vi.mocked(mobilePermissionService.setMaxPermissions).mockRejectedValue(
        new Error('Cannot set permission restrictions on wallet owners')
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions/owner-user-id')
        .send({ broadcast: false });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should return 403 when target user has no wallet access', async () => {
      vi.mocked(mobilePermissionService.setMaxPermissions).mockRejectedValue(
        new Error('Target user does not have access to this wallet')
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions/target-user-id')
        .send({ broadcast: false });

      expect(response.status).toBe(500);
      // Error goes through errorHandler as INTERNAL_ERROR
    });

    it('should return 500 on unexpected cap update errors', async () => {
      vi.mocked(mobilePermissionService.setMaxPermissions).mockRejectedValue(
        new Error('Unexpected cap update failure')
      );

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions/target-user-id')
        .send({ broadcast: false });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should reject invalid permission input', async () => {
      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123/mobile-permissions/target-user-id')
        .send({ invalidPermission: true });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid permission key');
    });
  });

  describe('DELETE /api/v1/wallets/:id/mobile-permissions/:userId/caps', () => {
    it('should clear max permissions (owner)', async () => {
      vi.mocked(mobilePermissionService.clearMaxPermissions).mockResolvedValue({
        ...mockEffectivePermissions,
        hasOwnerRestrictions: false,
      });

      const response = await request(app).delete(
        '/api/v1/wallets/wallet-123/mobile-permissions/target-user-id/caps'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.hasOwnerRestrictions).toBe(false);
      expect(mobilePermissionService.clearMaxPermissions).toHaveBeenCalledWith(
        'wallet-123',
        'target-user-id',
        'test-user-id'
      );
    });

    it('should return 403 when caller is not owner', async () => {
      vi.mocked(mobilePermissionService.clearMaxPermissions).mockRejectedValue(
        new Error('Only wallet owners can clear permission caps')
      );

      const response = await request(app).delete(
        '/api/v1/wallets/wallet-123/mobile-permissions/target-user-id/caps'
      );

      expect(response.status).toBe(500);
      // Error goes through errorHandler as INTERNAL_ERROR
    });

    it('should return 404 when no permission record exists', async () => {
      vi.mocked(mobilePermissionService.clearMaxPermissions).mockRejectedValue(
        new Error('Mobile permission record not found')
      );

      const response = await request(app).delete(
        '/api/v1/wallets/wallet-123/mobile-permissions/non-existent-user/caps'
      );

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should return 500 on unexpected clear-cap errors', async () => {
      vi.mocked(mobilePermissionService.clearMaxPermissions).mockRejectedValue(
        new Error('Unexpected clear failure')
      );

      const response = await request(app).delete(
        '/api/v1/wallets/wallet-123/mobile-permissions/target-user-id/caps'
      );

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /api/v1/wallets/:id/mobile-permissions', () => {
    it('should reset own permissions to defaults', async () => {
      vi.mocked(mobilePermissionService.resetPermissions).mockResolvedValue(undefined);

      const response = await request(app).delete('/api/v1/wallets/wallet-123/mobile-permissions');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('reset to defaults');
      expect(mobilePermissionService.resetPermissions).toHaveBeenCalledWith(
        'wallet-123',
        'test-user-id'
      );
    });

    it('should return 500 on service error', async () => {
      vi.mocked(mobilePermissionService.resetPermissions).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app).delete('/api/v1/wallets/wallet-123/mobile-permissions');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /internal/mobile-permissions/check', () => {
    it('should return allowed: true when permission granted', async () => {
      vi.mocked(mobilePermissionService.checkForGateway).mockResolvedValue({
        allowed: true,
      });

      const response = await request(app)
        .post('/internal/mobile-permissions/check')
        .send({ walletId: 'wallet-123', userId: 'user-123', action: 'broadcast' });

      expect(response.status).toBe(200);
      expect(response.body.allowed).toBe(true);
    });

    it('should return allowed: false with reason when denied', async () => {
      vi.mocked(mobilePermissionService.checkForGateway).mockResolvedValue({
        allowed: false,
        reason: 'Mobile access denied for action: broadcast',
      });

      const response = await request(app)
        .post('/internal/mobile-permissions/check')
        .send({ walletId: 'wallet-123', userId: 'user-123', action: 'broadcast' });

      expect(response.status).toBe(200);
      expect(response.body.allowed).toBe(false);
      expect(response.body.reason).toContain('denied');
    });

    it('should return 400 when walletId is missing', async () => {
      const response = await request(app)
        .post('/internal/mobile-permissions/check')
        .send({ userId: 'user-123', action: 'broadcast' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should return 400 when userId is missing', async () => {
      const response = await request(app)
        .post('/internal/mobile-permissions/check')
        .send({ walletId: 'wallet-123', action: 'broadcast' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should return 400 when action is missing', async () => {
      const response = await request(app)
        .post('/internal/mobile-permissions/check')
        .send({ walletId: 'wallet-123', userId: 'user-123' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should return 400 for invalid action', async () => {
      const response = await request(app)
        .post('/internal/mobile-permissions/check')
        .send({ walletId: 'wallet-123', userId: 'user-123', action: 'invalidAction' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid action');
    });

    it('should return allowed: false on service error', async () => {
      vi.mocked(mobilePermissionService.checkForGateway).mockRejectedValue(
        new Error('Service error')
      );

      const response = await request(app)
        .post('/internal/mobile-permissions/check')
        .send({ walletId: 'wallet-123', userId: 'user-123', action: 'broadcast' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
