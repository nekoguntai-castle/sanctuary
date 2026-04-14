import { describe, expect, it } from 'vitest';
import { adminRoutesRequest, mockAuditService, mockPrisma } from './adminRoutesTestHarness';

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
        .send({ email: 'new@test.com' });

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('new@test.com');
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
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        isAdmin: true,
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

    it('should handle update errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
      });
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
