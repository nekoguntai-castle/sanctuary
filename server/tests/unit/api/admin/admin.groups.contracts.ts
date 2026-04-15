import { describe, expect, it } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
} from '../../../helpers/testUtils';
import {
  getAdminRouter,
  mockAuditLogFromRequest,
} from './adminTestHarness';

export function registerAdminGroupTests(): void {
  describe('Group Management', () => {
    describe('GET /groups', () => {
      it('should list all groups with members', async () => {
        const mockGroups = [
          {
            id: 'group-1',
            name: 'Accounting',
            description: 'Finance team',
            purpose: 'accounting',
            createdAt: new Date(),
            updatedAt: new Date(),
            members: [
              {
                userId: 'user-1',
                role: 'member',
                user: { id: 'user-1', username: 'user1' },
              },
            ],
          },
        ];

        mockPrismaClient.group.findMany.mockResolvedValue(mockGroups);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(Array.isArray(response.body)).toBe(true);
        }
      });
    });

    describe('POST /groups', () => {
      it('should create a new group', async () => {
        const newGroup = {
          name: 'Engineering',
          description: 'Dev team',
          purpose: 'development',
        };

        mockPrismaClient.group.create.mockResolvedValue({
          id: 'group-new',
          ...newGroup,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        mockPrismaClient.group.findUnique.mockResolvedValue({
          id: 'group-new',
          ...newGroup,
          createdAt: new Date(),
          updatedAt: new Date(),
          members: [],
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newGroup,
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(response.body.name).toBe(newGroup.name);
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should create group with initial members', async () => {
        const newGroup = {
          name: 'Team Alpha',
          description: 'Alpha team',
          memberIds: ['user-1', 'user-2'],
        };

        mockPrismaClient.group.create.mockResolvedValue({
          id: 'group-new',
          name: newGroup.name,
          description: newGroup.description,
          purpose: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        mockPrismaClient.user.findMany.mockResolvedValue([
          { id: 'user-1' },
          { id: 'user-2' },
        ]);

        mockPrismaClient.groupMember.createMany.mockResolvedValue({ count: 2 });

        mockPrismaClient.group.findUnique.mockResolvedValue({
          id: 'group-new',
          name: newGroup.name,
          description: newGroup.description,
          purpose: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          members: [
            {
              userId: 'user-1',
              role: 'member',
              user: { id: 'user-1', username: 'user1' },
            },
            {
              userId: 'user-2',
              role: 'member',
              user: { id: 'user-2', username: 'user2' },
            },
          ],
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newGroup,
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(mockPrismaClient.groupMember.createMany).toHaveBeenCalled();
        }
      });

      it('should require group name', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { description: 'No name' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('required');
        }
      });
    });

    describe('PUT /groups/:groupId', () => {
      it('should update group details', async () => {
        const existingGroup = {
          id: 'group-1',
          name: 'Old Name',
          description: 'Old description',
          purpose: null,
          members: [],
        };

        mockPrismaClient.group.findUnique
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce({
            ...existingGroup,
            name: 'New Name',
            updatedAt: new Date(),
            members: [],
          });

        mockPrismaClient.group.update.mockResolvedValue({
          ...existingGroup,
          name: 'New Name',
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { name: 'New Name' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.name).toBe('New Name');
        }
      });

      it('should update group members', async () => {
        const existingGroup = {
          id: 'group-1',
          name: 'Team',
          description: null,
          purpose: null,
          members: [
            { userId: 'user-1', role: 'member' },
            { userId: 'user-2', role: 'member' },
          ],
        };

        mockPrismaClient.group.findUnique
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce({
            ...existingGroup,
            members: [
              {
                userId: 'user-1',
                role: 'member',
                user: { id: 'user-1', username: 'user1' },
              },
              {
                userId: 'user-3',
                role: 'member',
                user: { id: 'user-3', username: 'user3' },
              },
            ],
          });

        mockPrismaClient.group.update.mockResolvedValue(existingGroup);
        mockPrismaClient.groupMember.deleteMany.mockResolvedValue({ count: 1 });
        mockPrismaClient.user.findMany.mockResolvedValue([{ id: 'user-3' }]);
        mockPrismaClient.groupMember.createMany.mockResolvedValue({ count: 1 });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { memberIds: ['user-1', 'user-3'] },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockPrismaClient.groupMember.deleteMany).toHaveBeenCalled();
          expect(mockPrismaClient.groupMember.createMany).toHaveBeenCalled();
        }
      });

      it('should return 404 for non-existent group', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'non-existent' },
          body: { name: 'New Name' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('not found');
        }
      });
    });

    describe('DELETE /groups/:groupId', () => {
      it('should delete group', async () => {
        const groupToDelete = {
          id: 'group-1',
          name: 'Old Group',
          members: [{ userId: 'user-1' }, { userId: 'user-2' }],
        };

        mockPrismaClient.group.findUnique.mockResolvedValue(groupToDelete);
        mockPrismaClient.group.delete.mockResolvedValue(groupToDelete);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.message).toContain('deleted successfully');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should return 404 for non-existent group', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'non-existent' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
        }
      });
    });

    describe('POST /groups/:groupId/members', () => {
      it('should add member to group', async () => {
        const group = { id: 'group-1', name: 'Team' };
        const user = { id: 'user-1', username: 'user1' };

        mockPrismaClient.group.findUnique.mockResolvedValue(group);
        mockPrismaClient.user.findUnique.mockResolvedValue(user);
        mockPrismaClient.groupMember.findUnique.mockResolvedValue(null);
        mockPrismaClient.groupMember.create.mockResolvedValue({
          groupId: 'group-1',
          userId: 'user-1',
          role: 'member',
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { userId: 'user-1', role: 'member' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(response.body.userId).toBe('user-1');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should reject adding non-existent user', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1' });
        mockPrismaClient.user.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { userId: 'non-existent' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('User not found');
        }
      });

      it('should reject duplicate membership', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1' });
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mockPrismaClient.groupMember.findUnique.mockResolvedValue({
          userId: 'user-1',
          groupId: 'group-1',
          role: 'member',
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(409);
          expect(response.body.message).toContain('already a member');
        }
      });
    });

    describe('DELETE /groups/:groupId/members/:userId', () => {
      it('should remove member from group', async () => {
        mockPrismaClient.groupMember.findUnique.mockResolvedValue({
          userId: 'user-1',
          groupId: 'group-1',
          role: 'member',
        });
        mockPrismaClient.groupMember.delete.mockResolvedValue({});

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1', userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.message).toContain('removed');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should return 404 for non-existent membership', async () => {
        mockPrismaClient.groupMember.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1', userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
        }
      });
    });
  });
}
