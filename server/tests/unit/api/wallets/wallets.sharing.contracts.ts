import { describe, expect, it, vi } from 'vitest';
import { mockUserRepository, mockWalletSharingRepository, request, walletRouter } from './walletsTestHarness';

export const registerWalletSharingContracts = () => {
  // ==================== Sharing Tests ====================

  describe('POST /wallets/:id/share/group', () => {
    it('should share wallet with group', async () => {
      mockWalletSharingRepository.isGroupMember.mockResolvedValue(true);
      mockWalletSharingRepository.updateWalletGroupWithResult.mockResolvedValue({
        groupId: 'group-1',
        groupRole: 'viewer',
        group: { name: 'Test Group' },
      });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ groupId: 'group-1', role: 'viewer' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.groupId).toBe('group-1');
    });

    it('should reject invalid role', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ groupId: 'group-1', role: 'admin' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('viewer, signer, or approver');
    });

    it('should reject when user is not group member', async () => {
      mockWalletSharingRepository.isGroupMember.mockResolvedValue(false);

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('member of the group');
    });

    it('should allow clearing group access when groupId is omitted', async () => {
      mockWalletSharingRepository.updateWalletGroupWithResult.mockResolvedValue({
        groupId: null,
        groupRole: 'signer',
        group: null,
      });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ role: 'signer' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        groupId: null,
        groupName: null,
        groupRole: 'signer',
      });
      expect(mockWalletSharingRepository.isGroupMember).not.toHaveBeenCalled();
      expect(mockWalletSharingRepository.updateWalletGroupWithResult).toHaveBeenCalledWith(
        'wallet-123',
        null,
        'signer'
      );
    });

    it('should handle group sharing errors', async () => {
      mockWalletSharingRepository.isGroupMember.mockResolvedValue(true);
      mockWalletSharingRepository.updateWalletGroupWithResult.mockRejectedValue(new Error('DB error'));

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ groupId: 'group-1', role: 'viewer' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /wallets/:id/share/user', () => {
    it('should share wallet with user', async () => {
      mockUserRepository.findById.mockResolvedValue({ id: 'target-user', username: 'targetuser' });
      mockWalletSharingRepository.findWalletUser.mockResolvedValue(null);
      mockWalletSharingRepository.addUserToWallet.mockResolvedValue({ id: 'wu-1' });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'viewer' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('added');
    });

    it('should update existing user access', async () => {
      mockUserRepository.findById.mockResolvedValue({ id: 'target-user', username: 'targetuser' });
      mockWalletSharingRepository.findWalletUser.mockResolvedValue({ id: 'wu-1', role: 'viewer' });
      mockWalletSharingRepository.updateUserRole.mockResolvedValue({ id: 'wu-1', role: 'signer' });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'signer' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('updated');
    });

    it('should keep owner role unchanged when user already has owner access', async () => {
      mockUserRepository.findById.mockResolvedValue({ id: 'target-user', username: 'targetuser' });
      mockWalletSharingRepository.findWalletUser.mockResolvedValue({ id: 'wu-owner', role: 'owner' });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'signer' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('updated');
      expect(mockWalletSharingRepository.updateUserRole).not.toHaveBeenCalled();
    });

    it('should reject without targetUserId', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ role: 'viewer' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('targetUserId');
    });

    it('should reject invalid role', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'admin' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('viewer, signer, or approver');
    });

    it('should return 404 for non-existent user', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'non-existent', role: 'viewer' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should include devicesToShare when user lacks access to signing devices', async () => {
      const { getDevicesToShareForWallet } = await import('../../../../src/services/deviceAccess');
      const mockGetDevicesToShareForWallet = vi.mocked(getDevicesToShareForWallet);

      mockUserRepository.findById.mockResolvedValue({ id: 'target-user', username: 'targetuser' });
      mockWalletSharingRepository.findWalletUser.mockResolvedValue(null);
      mockWalletSharingRepository.addUserToWallet.mockResolvedValue({ id: 'wu-1' });
      mockGetDevicesToShareForWallet.mockResolvedValue([
        { id: 'device-1', label: 'Signer One', role: 'owner' } as any,
      ]);

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'viewer' });

      expect(response.status).toBe(201);
      expect(response.body.devicesToShare).toHaveLength(1);
      expect(response.body.devicesToShare[0].id).toBe('device-1');
    });

    it('should handle user sharing errors', async () => {
      mockUserRepository.findById.mockRejectedValue(new Error('Lookup failed'));

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'viewer' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('DELETE /wallets/:id/share/user/:targetUserId', () => {
    it('should remove user from wallet', async () => {
      mockWalletSharingRepository.findWalletUser.mockResolvedValue({ id: 'wu-1', role: 'viewer' });
      mockWalletSharingRepository.removeUserFromWallet.mockResolvedValue({ count: 1 });

      const response = await request(walletRouter).delete('/api/v1/wallets/wallet-123/share/user/target-user');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for user without access', async () => {
      mockWalletSharingRepository.findWalletUser.mockResolvedValue(null);

      const response = await request(walletRouter).delete('/api/v1/wallets/wallet-123/share/user/target-user');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('does not have access');
    });

    it('should reject removing owner', async () => {
      mockWalletSharingRepository.findWalletUser.mockResolvedValue({ id: 'wu-1', role: 'owner' });

      const response = await request(walletRouter).delete('/api/v1/wallets/wallet-123/share/user/owner-user');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Cannot remove the owner');
    });

    it('should handle errors while removing user access', async () => {
      mockWalletSharingRepository.findWalletUser.mockRejectedValue(new Error('DB error'));

      const response = await request(walletRouter).delete('/api/v1/wallets/wallet-123/share/user/target-user');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('GET /wallets/:id/share', () => {
    it('should return sharing info', async () => {
      mockWalletSharingRepository.getWalletSharingInfo.mockResolvedValue({
        group: { id: 'group-1', name: 'Test Group' },
        groupRole: 'viewer',
        users: [
          { user: { id: 'user-1', username: 'user1' }, role: 'owner' },
          { user: { id: 'user-2', username: 'user2' }, role: 'viewer' },
        ],
      });

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/share');

      expect(response.status).toBe(200);
      expect(response.body.group).toBeDefined();
      expect(response.body.users).toHaveLength(2);
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletSharingRepository.getWalletSharingInfo.mockResolvedValue(null);

      const response = await request(walletRouter).get('/api/v1/wallets/non-existent/share');

      expect(response.status).toBe(404);
    });

    it('should return null group when wallet has no group share configured', async () => {
      mockWalletSharingRepository.getWalletSharingInfo.mockResolvedValue({
        group: null,
        groupRole: null,
        users: [{ user: { id: 'user-1', username: 'owner' }, role: 'owner' }],
      });

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/share');

      expect(response.status).toBe(200);
      expect(response.body.group).toBeNull();
      expect(response.body.users).toHaveLength(1);
    });

    it('should handle errors when loading sharing info', async () => {
      mockWalletSharingRepository.getWalletSharingInfo.mockRejectedValue(new Error('DB error'));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/share');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });
};
