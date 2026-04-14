import { describe, expect, it } from 'vitest';
import { adminRoutesRequest, mockPrisma } from './adminRoutesTestHarness';

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
    });
  });

  describe('DELETE /api/v1/admin/groups/:id', () => {
    it('should delete a group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'group-to-delete',
        name: 'Test Group',
        members: [{ userId: 'user-1' }],
      });
      mockPrisma.group.delete.mockResolvedValue({ id: 'group-to-delete' });

      const response = await adminRoutesRequest().delete('/api/v1/admin/groups/group-to-delete');

      expect(response.status).toBe(200);
    });

    it('should handle non-existent group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);

      const response = await adminRoutesRequest().delete('/api/v1/admin/groups/nonexistent');

      expect(response.status).toBe(404);
    });
  });
}
