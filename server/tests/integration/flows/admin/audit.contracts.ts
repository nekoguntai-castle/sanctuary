import { describe, expect, it } from 'vitest';
import {
  app,
  authHeader,
  createAdminAndLogin,
  createUserAndLogin,
  prisma,
  request,
  uniqueUsername,
} from './adminIntegrationTestHarness';

export function registerAdminAuditLoggingContracts(): void {
  // =============================================
  // AUDIT LOGGING
  // =============================================

  describe('Audit Logging', () => {
    it('should create audit log for user creation', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const newUsername = uniqueUsername('audituser');

      await request(app)
        .post('/api/v1/admin/users')
        .set(authHeader(token))
        .send({
          username: newUsername,
          password: 'Password123!',
          email: `${newUsername}@example.com`,
        })
        .expect(201);

      // Verify audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'user.create',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.category).toBe('user');
    });

    it('should create audit log for user deletion', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const { userId, username } = await createUserAndLogin();

      await request(app)
        .delete(`/api/v1/admin/users/${userId}`)
        .set(authHeader(token))
        .expect(200);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'user.delete',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
    });

    it('should create audit log for admin role grant', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const { userId } = await createUserAndLogin();

      await request(app)
        .put(`/api/v1/admin/users/${userId}`)
        .set(authHeader(token))
        .send({ isAdmin: true })
        .expect(200);

      // Verify audit log for admin grant
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'user.admin_grant',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
    });

    it('should create audit log for admin role revoke', async () => {
      const { token: superToken, adminId: superId } = await createAdminAndLogin();
      const { adminId: targetId } = await createAdminAndLogin();

      await request(app)
        .put(`/api/v1/admin/users/${targetId}`)
        .set(authHeader(superToken))
        .send({ isAdmin: false })
        .expect(200);

      // Verify audit log for admin revoke
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: superId,
          action: 'user.admin_revoke',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
    });

    it('should create audit log for group member add', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const { userId } = await createUserAndLogin();

      const group = await prisma.group.create({
        data: { name: 'Audit Member Add Group' },
      });

      await request(app)
        .post(`/api/v1/admin/groups/${group.id}/members`)
        .set(authHeader(token))
        .send({ userId })
        .expect(201);

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'admin.group_member_add',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.category).toBe('admin');
    });

    it('should create audit log for group member remove', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const { userId } = await createUserAndLogin();

      const group = await prisma.group.create({
        data: {
          name: 'Audit Member Remove Group',
          members: {
            create: { userId, role: 'member' },
          },
        },
      });

      await request(app)
        .delete(`/api/v1/admin/groups/${group.id}/members/${userId}`)
        .set(authHeader(token))
        .expect(200);

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'admin.group_member_remove',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.category).toBe('admin');
    });

    it('should create audit log for group deletion', async () => {
      const { token, adminId } = await createAdminAndLogin();

      const group = await prisma.group.create({
        data: { name: 'Audit Delete Group' },
      });

      await request(app)
        .delete(`/api/v1/admin/groups/${group.id}`)
        .set(authHeader(token))
        .expect(200);

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'admin.group_delete',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.category).toBe('admin');
    });

    it('should create audit log for group creation', async () => {
      const { token, adminId } = await createAdminAndLogin();

      await request(app)
        .post('/api/v1/admin/groups')
        .set(authHeader(token))
        .send({ name: 'Audit Test Group' })
        .expect(201);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'admin.group_create',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.category).toBe('admin');
    });
  });
}
