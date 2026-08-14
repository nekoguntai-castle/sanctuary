import { describe, expect, it, vi } from 'vitest';
import { adminRoutesRequest, mockAuditService, mockPrisma } from './adminRoutesTestHarness';
import { disconnectWebSocketUser } from '../../../../src/services/websocketAuthorizationInvalidation';
import { revokeAllUserTokens } from '../../../../src/services/tokenRevocation';

const mockDisconnectWebSocketUser = vi.mocked(disconnectWebSocketUser);
const mockRevokeAllUserTokens = vi.mocked(revokeAllUserTokens);

export function registerAdminRoutesDeleteContracts(): void {
  describe('DELETE /api/v1/admin/users/:id', () => {
    it('should delete a user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-to-delete',
        username: 'deleteuser',
        isAdmin: false,
      });
      mockPrisma.user.delete.mockResolvedValue({ id: 'user-to-delete' });

      const response = await adminRoutesRequest().delete('/api/v1/admin/users/user-to-delete');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted');
      expect(mockPrisma.user.delete).toHaveBeenCalledBefore(mockDisconnectWebSocketUser);
      expect(mockDisconnectWebSocketUser).toHaveBeenCalledBefore(
        mockAuditService.logFromRequest,
      );
      expect(mockDisconnectWebSocketUser).toHaveBeenCalledWith('user-to-delete');
      expect(mockRevokeAllUserTokens).not.toHaveBeenCalled();
    });

    it('should prevent self-deletion', async () => {
      // The authenticate middleware sets userId to 'admin-user-id'
      const response = await adminRoutesRequest().delete('/api/v1/admin/users/admin-user-id');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('own account');
    });

    it('should handle non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await adminRoutesRequest().delete('/api/v1/admin/users/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should handle delete errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-to-delete',
        username: 'deleteuser',
        isAdmin: false,
      });
      mockPrisma.user.delete.mockRejectedValue(new Error('delete failed'));

      const response = await adminRoutesRequest().delete('/api/v1/admin/users/user-to-delete');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
      expect(mockDisconnectWebSocketUser).not.toHaveBeenCalled();
      expect(mockAuditService.logFromRequest).not.toHaveBeenCalled();
    });

    it('rejects deleting the final administrator without side effects', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'other-admin',
        username: 'other-admin',
        isAdmin: true,
      });
      mockPrisma.user.count.mockResolvedValue(1);

      const response = await adminRoutesRequest().delete('/api/v1/admin/users/other-admin');

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('final administrator');
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
      expect(mockDisconnectWebSocketUser).not.toHaveBeenCalled();
      expect(mockRevokeAllUserTokens).not.toHaveBeenCalled();
      expect(mockAuditService.logFromRequest).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/v1/admin/groups/:id', () => {
    it('should delete a group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'group-to-delete',
        name: 'Test Group',
        members: [{ userId: 'user-1' }],
        wallets: [{ id: 'wallet-1' }],
      });
      mockPrisma.group.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.group.delete.mockResolvedValue({ id: 'group-to-delete' });

      const response = await adminRoutesRequest().delete('/api/v1/admin/groups/group-to-delete');

      expect(response.status).toBe(200);
    });

    it('should handle non-existent group', async () => {
      mockPrisma.group.updateMany.mockResolvedValue({ count: 0 });

      const response = await adminRoutesRequest().delete('/api/v1/admin/groups/nonexistent');

      expect(response.status).toBe(404);
    });
  });
}
