import { describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { sampleUsers } from '../../../fixtures/bitcoin';
import {
  createMockNext,
  createMockRequest,
  createMockResponse,
} from '../../../helpers/testUtils';
import * as bcrypt from 'bcryptjs';
import {
  callHandler,
  findRouteLayer,
  getAdminRouter,
  mockAuditGetStats,
  mockAuditLogFromRequest,
  mockAuditQuery,
  mockCreateBackup,
  mockReloadElectrumServers,
  mockResetNodeClient,
  mockRestoreFromBackup,
  mockTestNodeConfig,
  mockValidateBackup,
  mockVerifyPassword,
} from './adminTestHarness';

export function registerAdminUsersGroupsTests(): void {
  describe('User Management', () => {
    describe('GET /users', () => {
      it('should list all users for admin', async () => {
        const mockUsers = [
          {
            id: 'user-1',
            username: 'user1',
            email: 'user1@example.com',
            isAdmin: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'user-2',
            username: 'user2',
            email: 'user2@example.com',
            isAdmin: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        mockPrismaClient.user.findMany.mockResolvedValue(mockUsers);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body).toEqual(mockUsers);
        }
      });

      it('should reject non-admin access', async () => {
        const req = createMockRequest({
          user: { userId: 'user-1', username: 'user', isAdmin: false },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        // Import and test requireAdmin middleware
        const { requireAdmin } = await import('../../../../src/middleware/auth');
        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe('POST /users', () => {
      it('should create a new user as admin', async () => {
        const newUser = {
          username: 'newuser',
          password: 'SecurePass123',
          email: 'newuser@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(null); // No existing user
        mockPrismaClient.user.create.mockResolvedValue({
          id: 'user-new',
          username: newUser.username,
          email: newUser.email,
          isAdmin: newUser.isAdmin,
          createdAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newUser,
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(response.body.username).toBe(newUser.username);
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should reject user creation with weak password', async () => {
        const newUser = {
          username: 'newuser',
          password: 'weak',
          email: 'newuser@example.com',
          isAdmin: false,
        };

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newUser,
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('security requirements');
        }
      });

      it('should reject duplicate username', async () => {
        const newUser = {
          username: 'existinguser',
          password: 'SecurePass123',
          email: 'new@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'existing-user',
          username: 'existinguser',
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newUser,
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(409);
          expect(response.body.message).toContain('already exists');
        }
      });

      it('should validate required fields', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { username: 'testuser' }, // Missing password
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('required');
        }
      });

      it('should validate username length', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { username: 'ab', password: 'SecurePass123' }, // Too short
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('at least 3 characters');
        }
      });
    });

    describe('PUT /users/:userId', () => {
      it('should update user details', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'oldusername',
          email: 'old@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique
          .mockResolvedValueOnce(existingUser) // First call to get user
          .mockResolvedValueOnce(null); // Second call to check if email is taken
        mockPrismaClient.user.update.mockResolvedValue({
          ...existingUser,
          email: 'new@example.com',
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { email: 'new@example.com' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.email).toBe('new@example.com');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should update user password', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'testuser',
          email: 'test@example.com',
          isAdmin: false,
          password: 'old-hash',
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(existingUser);
        mockPrismaClient.user.update.mockResolvedValue({
          ...existingUser,
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { password: 'NewSecurePass123' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockPrismaClient.user.update).toHaveBeenCalled();
        }
      });

      it('should update admin status and log appropriately', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'testuser',
          email: 'test@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(existingUser);
        mockPrismaClient.user.update.mockResolvedValue({
          ...existingUser,
          isAdmin: true,
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
            expect.anything(),
            'user.admin_grant',
            expect.anything(),
            expect.anything()
          );
        }
      });

      it('should return 404 for non-existent user', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'non-existent' },
          body: { email: 'new@example.com' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('not found');
        }
      });

      it('should reject duplicate email', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'user1',
          email: 'user1@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique
          .mockResolvedValueOnce(existingUser)
          .mockResolvedValueOnce({ id: 'other-user', email: 'taken@example.com' });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { email: 'taken@example.com' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(409);
          expect(response.body.message).toContain('already exists');
        }
      });
    });

    describe('DELETE /users/:userId', () => {
      it('should delete user', async () => {
        const userToDelete = {
          id: 'user-1',
          username: 'testuser',
          email: 'test@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(userToDelete);
        mockPrismaClient.user.delete.mockResolvedValue(userToDelete);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.message).toContain('deleted successfully');
          expect(mockPrismaClient.user.delete).toHaveBeenCalledWith({
            where: { id: 'user-1' },
          });
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should prevent self-deletion', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'admin-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('Cannot delete your own account');
        }
      });

      it('should return 404 for non-existent user', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'non-existent' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('not found');
        }
      });
    });
  });

  // ========================================
  // GROUP MANAGEMENT
  // ========================================

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
