import { describe, expect, it, vi } from 'vitest';
import { adminRoutesRequest, mockAuditService, mockPrisma } from './adminRoutesTestHarness';
import { PASSWORD_POLICY } from '../../../../src/utils/password';
import { revokeAllUserTokens } from '../../../../src/services/tokenRevocation';

const mockRevokeAllUserTokens = vi.mocked(revokeAllUserTokens);

export function registerAdminRoutesUserUpdateDeleteContracts(): void {
  describe('PUT /api/v1/admin/users/:userId', () => {
    it('should update a user', async () => {
      // 1st call: checks user exists, 2nd call: checks if new username is taken,
      // 3rd call: checks if new email is taken
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'oldname',
          email: 'old@test.com',
          isAdmin: false,
        })
        .mockResolvedValueOnce(null)  // new username not taken
        .mockResolvedValueOnce(null); // new email not taken
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'newname',
        email: 'new@test.com',
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ username: 'newname', email: 'new@test.com' });

      expect(response.status).toBe(200);
      expect(response.body.username).toBe('newname');
    });

    it('should store mixed-case username updates as lowercase', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'oldname',
          email: null,
          isAdmin: false,
        })
        .mockResolvedValueOnce(null);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'newname',
        email: null,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ username: '  NewName  ' });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'newname',
          }),
        })
      );
    });

    it('should handle non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/nonexistent')
        .send({ username: 'newname' });

      expect(response.status).toBe(404);
    });

    it('should reject duplicate username on update', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', username: 'oldname', email: null })  // existing user
        .mockResolvedValueOnce({ id: 'user-2', username: 'takenname' });  // username check

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ username: 'takenname' });

      expect(response.status).toBe(409);
    });

    it('should reject case-only duplicate usernames on update', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', username: 'oldname', email: null })
        .mockResolvedValueOnce({ id: 'user-2', username: 'admin' });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ username: 'Admin' });

      expect(response.status).toBe(409);
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { username: 'admin' },
      });
    });

    it('should reject duplicate email on update', async () => {
      // When only sending email (no username), the username check is skipped
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', username: 'oldname', email: 'old@test.com' })  // existing user
        .mockResolvedValueOnce({ id: 'user-2', email: 'taken@test.com' });  // email check (username check skipped)

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ email: 'taken@test.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already');
    });

    it('should reject invalid email format on update', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'oldname',
        email: 'old@test.com',
        isAdmin: false,
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('email');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should update email successfully', async () => {
      // When only sending email (no username), the username check is skipped
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'old@test.com',
          emailVerified: true,
          isAdmin: false,
        })
        .mockResolvedValueOnce(null);  // email check (username check skipped)
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'new@test.com',
        emailVerified: true,  // Admin-updated emails stay verified
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ email: 'New@Test.COM' });

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('new@test.com');
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { email: 'new@test.com' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new@test.com',
            emailVerified: true,
          }),
        })
      );
    });

    it('should remove email and mark it unverified when email is cleared', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'old@test.com',
        emailVerified: true,
        isAdmin: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: null,
        emailVerified: false,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ email: '' });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            emailVerified: false,
            emailVerifiedAt: null,
          }),
        })
      );
    });

    it('should not set email fields when clearing email for user without email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: null,
        emailVerified: false,
        isAdmin: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: null,
        emailVerified: false,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ email: '' });

      expect(response.status).toBe(200);
      const updatePayload = mockPrisma.user.update.mock.calls.at(-1)?.[0];
      expect(updatePayload.data.email).toBeUndefined();
      expect(updatePayload.data.emailVerified).toBeUndefined();
      expect(updatePayload.data.emailVerifiedAt).toBeUndefined();
    });

    it('should reject weak password on update', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ password: 'weak' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('security requirements');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should reject password updates above the UTF-8 byte limit', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ password: 'A1' + 'a'.repeat(PASSWORD_POLICY.maxUtf8Bytes - 1) });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('security requirements');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should hash and update strong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        isAdmin: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ password: 'Str0ngPassw0rd!' });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            password: expect.any(String),
          }),
        })
      );

      const updatePayload = mockPrisma.user.update.mock.calls.at(-1)?.[0];
      expect(updatePayload.data.password).not.toBe('Str0ngPassw0rd!');
    });

    it('should log admin grant action when isAdmin is set to true', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'test@test.com',
          isAdmin: false,
        })
        .mockResolvedValueOnce({ isAdmin: false });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: true });

      expect(response.status).toBe(200);
      expect(mockAuditService.logFromRequest).toHaveBeenCalledWith(
        expect.any(Object),
        'user.admin_grant',
        'user',
        expect.objectContaining({
          details: expect.objectContaining({ userId: 'user-1' }),
        })
      );
    });

    it('should log admin revoke action when isAdmin is set to false', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'test@test.com',
          isAdmin: true,
        })
        .mockResolvedValueOnce({ isAdmin: true });
      mockPrisma.user.count.mockResolvedValueOnce(2);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: false });

      expect(response.status).toBe(200);
      expect(mockAuditService.logFromRequest).toHaveBeenCalledWith(
        expect.any(Object),
        'user.admin_revoke',
        'user',
        expect.objectContaining({
          details: expect.objectContaining({ userId: 'user-1' }),
        })
      );
    });

    it('uses the transactional role state when a stale preflight would allow the final demotion', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'test@test.com',
          isAdmin: false,
        })
        .mockResolvedValueOnce({ isAdmin: true });
      mockPrisma.user.count.mockResolvedValueOnce(1);

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: false });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('final administrator');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockRevokeAllUserTokens).not.toHaveBeenCalled();
      expect(mockAuditService.logFromRequest).not.toHaveBeenCalled();
    });

    it('uses a barrier-staled preflight and revokes from the committed security transitions', async () => {
      let releaseTransactionRead!: () => void;
      const transactionReadBarrier = new Promise<void>((resolve) => {
        releaseTransactionRead = resolve;
      });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'test@test.com',
          isAdmin: false,
        })
        .mockImplementationOnce(async () => {
          await transactionReadBarrier;
          return { isAdmin: true };
        });
      mockPrisma.user.count.mockResolvedValueOnce(2);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const pendingResponse = adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: false, password: 'Str0ngPassw0rd!' })
        .then((response) => response);

      await vi.waitFor(() => {
        expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
      });
      releaseTransactionRead();
      const response = await pendingResponse;

      expect(response.status).toBe(200);
      expect(mockRevokeAllUserTokens).toHaveBeenCalledWith('user-1', 'admin_security_update');
      expect(mockPrisma.user.update).toHaveBeenCalledBefore(mockRevokeAllUserTokens);
    });

    it('does not revoke when a stale preflight suggests a role transition that did not commit', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'test@test.com',
          isAdmin: true,
        })
        .mockResolvedValueOnce({ isAdmin: false });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: false });

      expect(response.status).toBe(200);
      expect(mockRevokeAllUserTokens).not.toHaveBeenCalled();
      expect(mockAuditService.logFromRequest).toHaveBeenCalledWith(
        expect.any(Object),
        'user.update',
        'user',
        expect.any(Object),
      );
    });

    it('should handle update errors', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'test@test.com',
        })
        .mockResolvedValueOnce({ isAdmin: false });
      mockPrisma.user.update.mockRejectedValue(new Error('update failed'));

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: false });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });

    // Email format is validated on update before duplicate checks.
  });
}
