import { describe, expect, it } from 'vitest';
import { adminRoutesRequest, mockPrisma } from './adminRoutesTestHarness';

export function registerAdminRoutesGroupContracts(): void {
  describe('GET /api/v1/admin/groups', () => {
    it('should return list of groups', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Admins',
          description: 'Admin group',
          purpose: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
          members: [
            { userId: 'user-1', role: 'admin', user: { id: 'user-1', username: 'admin' } },
          ],
        },
      ];
      mockPrisma.group.findMany.mockResolvedValue(mockGroups);

      const response = await adminRoutesRequest().get('/api/v1/admin/groups');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Admins');
      expect(response.body[0].members).toHaveLength(1);
    });

    it('should handle database error', async () => {
      mockPrisma.group.findMany.mockRejectedValue(new Error('DB error'));

      const response = await adminRoutesRequest().get('/api/v1/admin/groups');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/v1/admin/groups', () => {
    it('should create a new group', async () => {
      mockPrisma.group.create.mockResolvedValue({
        id: 'new-group',
        name: 'New Group',
        description: 'Test group',
        purpose: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'new-group',
        name: 'New Group',
        members: [],
      });

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/groups')
        .send({ name: 'New Group', description: 'Test group' });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('New Group');
    });

    it('should reject missing name', async () => {
      const response = await adminRoutesRequest()
        .post('/api/v1/admin/groups')
        .send({ description: 'No name' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should create group with members', async () => {
      mockPrisma.group.create.mockResolvedValue({
        id: 'new-group',
        name: 'Team',
        description: null,
        purpose: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
      mockPrisma.groupMember.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'new-group',
        name: 'Team',
        members: [
          { userId: 'user-1', user: { id: 'user-1', username: 'user1' }, role: 'member' },
          { userId: 'user-2', user: { id: 'user-2', username: 'user2' }, role: 'member' },
        ],
      });

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/groups')
        .send({ name: 'Team', memberIds: ['user-1', 'user-2'] });

      expect(response.status).toBe(201);
    });
  });
}
