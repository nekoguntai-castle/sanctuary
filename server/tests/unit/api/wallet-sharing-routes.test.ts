/**
 * Wallet Sharing Routes Unit Tests
 *
 * Tests for wallet sharing API endpoints:
 * - POST /:id/share/group (share with group)
 * - POST /:id/share/user (share with user)
 * - DELETE /:id/share/user/:targetUserId (remove user)
 * - GET /:id/share (get sharing info)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';

const {
  mockFindById,
  mockFindWalletUser,
  mockAddUserToWallet,
  mockUpdateUserRole,
  mockRemoveUserFromWallet,
  mockIsGroupMember,
  mockUpdateWalletGroupWithResult,
  mockGetWalletSharingInfo,
  mockGetDevicesToShareForWallet,
  mockInvalidateWebSocketWalletAccess,
} = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockFindWalletUser: vi.fn(),
  mockAddUserToWallet: vi.fn(),
  mockUpdateUserRole: vi.fn(),
  mockRemoveUserFromWallet: vi.fn(),
  mockIsGroupMember: vi.fn(),
  mockUpdateWalletGroupWithResult: vi.fn(),
  mockGetWalletSharingInfo: vi.fn(),
  mockGetDevicesToShareForWallet: vi.fn(),
  mockInvalidateWebSocketWalletAccess: vi.fn(),
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'owner-1', username: 'owner' };
    req.walletId = req.params.id;
    next();
  },
}));

vi.mock('../../../src/repositories', () => ({
  userRepository: {
    findById: mockFindById,
  },
  walletSharingRepository: {
    findWalletUser: mockFindWalletUser,
    addUserToWallet: mockAddUserToWallet,
    updateUserRole: mockUpdateUserRole,
    removeUserFromWallet: mockRemoveUserFromWallet,
    isGroupMember: mockIsGroupMember,
    updateWalletGroupWithResult: mockUpdateWalletGroupWithResult,
    getWalletSharingInfo: mockGetWalletSharingInfo,
  },
}));

vi.mock('../../../src/services/deviceAccess', () => ({
  getDevicesToShareForWallet: mockGetDevicesToShareForWallet,
}));

vi.mock('../../../src/services/websocketAuthorizationInvalidation', () => ({
  invalidateWebSocketWalletAccess: mockInvalidateWebSocketWalletAccess,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import sharingRouter from '../../../src/api/wallets/sharing';

describe('Wallet Sharing Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/wallets', sharingRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateWebSocketWalletAccess.mockResolvedValue(undefined);
  });

  // =============================================
  // POST /:id/share/group
  // =============================================

  describe('POST /:id/share/group', () => {
    it('shares wallet with group successfully', async () => {
      mockIsGroupMember.mockResolvedValue(true);
      mockUpdateWalletGroupWithResult.mockResolvedValue({
        groupId: 'group-1',
        groupRole: 'viewer',
        group: { name: 'Team A' },
      });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(200);
      expect(mockIsGroupMember).toHaveBeenCalledWith('group-1', 'owner-1');
      expect(mockUpdateWalletGroupWithResult).toHaveBeenCalledWith('wallet-1', 'group-1', 'viewer');
      expect(mockInvalidateWebSocketWalletAccess).toHaveBeenCalledWith('wallet-1');
      expect(response.body).toEqual({
        success: true,
        groupId: 'group-1',
        groupName: 'Team A',
        groupRole: 'viewer',
      });
    });

    it('shares wallet with group using custom role', async () => {
      mockIsGroupMember.mockResolvedValue(true);
      mockUpdateWalletGroupWithResult.mockResolvedValue({
        groupId: 'group-1',
        groupRole: 'signer',
        group: { name: 'Team A' },
      });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/group')
        .send({ groupId: 'group-1', role: 'signer' });

      expect(response.status).toBe(200);
      expect(mockUpdateWalletGroupWithResult).toHaveBeenCalledWith('wallet-1', 'group-1', 'signer');
    });

    it('rejects invalid role', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/group')
        .send({ groupId: 'group-1', role: 'owner' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid role. Must be viewer, signer, or approver');
    });

    it('rejects non-member of group', async () => {
      mockIsGroupMember.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('You must be a member of the group to share with it');
    });

    it('unshares wallet from group with null groupId', async () => {
      mockUpdateWalletGroupWithResult.mockResolvedValue({
        groupId: null,
        groupRole: 'viewer',
        group: null,
      });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/group')
        .send({ groupId: null });

      expect(response.status).toBe(200);
      expect(mockIsGroupMember).not.toHaveBeenCalled();
      expect(mockUpdateWalletGroupWithResult).toHaveBeenCalledWith('wallet-1', null, 'viewer');
      expect(response.body.groupId).toBeNull();
      expect(response.body.groupName).toBeNull();
    });

    it('returns 500 when service throws', async () => {
      mockIsGroupMember.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(500);
    });
  });

  // =============================================
  // POST /:id/share/user
  // =============================================

  describe('POST /:id/share/user', () => {
    it('shares wallet with new user successfully', async () => {
      mockFindById.mockResolvedValue({ id: 'user-1', username: 'alice' });
      mockFindWalletUser.mockResolvedValue(null);
      mockAddUserToWallet.mockResolvedValue({ id: 'wu-1' });
      mockGetDevicesToShareForWallet.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1' });

      expect(response.status).toBe(201);
      expect(mockAddUserToWallet).toHaveBeenCalledWith('wallet-1', 'user-1', 'viewer');
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User added to wallet');
    });

    it('shares wallet with user as signer', async () => {
      mockFindById.mockResolvedValue({ id: 'user-1', username: 'alice' });
      mockFindWalletUser.mockResolvedValue(null);
      mockAddUserToWallet.mockResolvedValue({ id: 'wu-1' });
      mockGetDevicesToShareForWallet.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1', role: 'signer' });

      expect(response.status).toBe(201);
      expect(mockAddUserToWallet).toHaveBeenCalledWith('wallet-1', 'user-1', 'signer');
    });

    it('includes devicesToShare when devices need sharing', async () => {
      mockFindById.mockResolvedValue({ id: 'user-1', username: 'alice' });
      mockFindWalletUser.mockResolvedValue(null);
      mockAddUserToWallet.mockResolvedValue({ id: 'wu-1' });
      mockGetDevicesToShareForWallet.mockResolvedValue([
        { id: 'dev-1', label: 'Trezor', fingerprint: 'abc123' },
      ]);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1' });

      expect(response.status).toBe(201);
      expect(response.body.devicesToShare).toHaveLength(1);
      expect(response.body.devicesToShare[0].id).toBe('dev-1');
    });

    it('updates existing user role', async () => {
      mockFindById.mockResolvedValue({ id: 'user-1', username: 'alice' });
      mockFindWalletUser.mockResolvedValue({ id: 'wu-1', role: 'viewer' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1', role: 'signer' });

      expect(response.status).toBe(200);
      expect(mockUpdateUserRole).toHaveBeenCalledWith('wu-1', 'signer');
      expect(response.body.message).toBe('User access updated');
    });

    it('does not update owner role', async () => {
      mockFindById.mockResolvedValue({ id: 'user-1', username: 'alice' });
      mockFindWalletUser.mockResolvedValue({ id: 'wu-1', role: 'owner' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1', role: 'viewer' });

      expect(response.status).toBe(200);
      expect(mockUpdateUserRole).not.toHaveBeenCalled();
      expect(response.body.message).toBe('User access updated');
    });

    it('does not update when role unchanged', async () => {
      mockFindById.mockResolvedValue({ id: 'user-1', username: 'alice' });
      mockFindWalletUser.mockResolvedValue({ id: 'wu-1', role: 'viewer' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1', role: 'viewer' });

      expect(response.status).toBe(200);
      expect(mockUpdateUserRole).not.toHaveBeenCalled();
    });

    it('requires targetUserId', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('targetUserId is required');
    });

    it('rejects invalid role', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1', role: 'owner' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('role must be viewer, signer, or approver');
    });

    it('returns 404 when target user not found', async () => {
      mockFindById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'nonexistent' });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('User not found');
    });

    it('returns 500 when service throws', async () => {
      mockFindById.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/share/user')
        .send({ targetUserId: 'user-1' });

      expect(response.status).toBe(500);
    });
  });

  // =============================================
  // DELETE /:id/share/user/:targetUserId
  // =============================================

  describe('DELETE /:id/share/user/:targetUserId', () => {
    it('removes user from wallet successfully', async () => {
      mockFindWalletUser.mockResolvedValue({ id: 'wu-1', role: 'viewer' });
      mockRemoveUserFromWallet.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/share/user/user-1');

      expect(response.status).toBe(200);
      expect(mockRemoveUserFromWallet).toHaveBeenCalledWith('wu-1');
      expect(response.body).toEqual({
        success: true,
        message: 'User removed from wallet',
      });
      expect(mockInvalidateWebSocketWalletAccess).toHaveBeenCalledWith('wallet-1');
    });

    it('returns 404 when user has no access', async () => {
      mockFindWalletUser.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/share/user/user-1');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('User does not have access to this wallet');
    });

    it('returns 400 when trying to remove owner', async () => {
      mockFindWalletUser.mockResolvedValue({ id: 'wu-1', role: 'owner' });

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/share/user/owner-1');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot remove the owner from the wallet');
    });

    it('returns 500 when service throws', async () => {
      mockFindWalletUser.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/share/user/user-1');

      expect(response.status).toBe(500);
    });
  });

  // =============================================
  // GET /:id/share
  // =============================================

  describe('GET /:id/share', () => {
    it('returns sharing info with group and users', async () => {
      mockGetWalletSharingInfo.mockResolvedValue({
        group: { id: 'group-1', name: 'Team A' },
        groupRole: 'viewer',
        users: [
          { user: { id: 'owner-1', username: 'owner' }, role: 'owner' },
          { user: { id: 'user-1', username: 'alice' }, role: 'viewer' },
        ],
      });

      const response = await request(app).get('/api/v1/wallets/wallet-1/share');

      expect(response.status).toBe(200);
      expect(mockGetWalletSharingInfo).toHaveBeenCalledWith('wallet-1');
      expect(response.body.group).toEqual({
        id: 'group-1',
        name: 'Team A',
        role: 'viewer',
      });
      expect(response.body.users).toHaveLength(2);
      expect(response.body.users[0]).toEqual({
        id: 'owner-1',
        username: 'owner',
        role: 'owner',
      });
    });

    it('returns null group when not shared with group', async () => {
      mockGetWalletSharingInfo.mockResolvedValue({
        group: null,
        groupRole: 'viewer',
        users: [
          { user: { id: 'owner-1', username: 'owner' }, role: 'owner' },
        ],
      });

      const response = await request(app).get('/api/v1/wallets/wallet-1/share');

      expect(response.status).toBe(200);
      expect(response.body.group).toBeNull();
    });

    it('returns 404 when wallet not found', async () => {
      mockGetWalletSharingInfo.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallets/wallet-1/share');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('returns 500 when service throws', async () => {
      mockGetWalletSharingInfo.mockRejectedValue(new Error('db error'));

      const response = await request(app).get('/api/v1/wallets/wallet-1/share');

      expect(response.status).toBe(500);
    });
  });
});
