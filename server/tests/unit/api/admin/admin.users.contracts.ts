import { describe, expect, it } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  createMockNext,
  createMockRequest,
  createMockResponse,
} from '../../../helpers/testUtils';
import {
  getAdminRouter,
  mockAuditLogFromRequest,
} from './adminTestHarness';

export function registerAdminUserTests(): void {
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

        mockPrismaClient.user.findUnique.mockResolvedValue(null);
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
          body: { username: 'testuser' },
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
          body: { username: 'ab', password: 'SecurePass123' },
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
          .mockResolvedValueOnce(existingUser)
          .mockResolvedValueOnce(null);
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
}
