import { describe, expect, it } from 'vitest';
import { adminRoutesRequest, mockPrisma } from './adminRoutesTestHarness';

export function registerAdminRoutesUserReadCreateContracts(): void {
  describe('GET /api/v1/admin/users', () => {
    it('should return list of users', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'admin', email: 'admin@test.com', isAdmin: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 'user-2', username: 'user1', email: 'user1@test.com', isAdmin: false, createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const response = await adminRoutesRequest().get('/api/v1/admin/users');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].username).toBe('admin');
    });

    it('should include email and verification status in user list', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          username: 'verified',
          email: 'verified@test.com',
          emailVerified: true,
          emailVerifiedAt: new Date(),
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'user-2',
          username: 'unverified',
          email: 'unverified@test.com',
          emailVerified: false,
          emailVerifiedAt: null,
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const response = await adminRoutesRequest().get('/api/v1/admin/users');

      expect(response.status).toBe(200);
      expect(response.body[0].email).toBe('verified@test.com');
      expect(response.body[0].emailVerified).toBe(true);
      expect(response.body[1].email).toBe('unverified@test.com');
      expect(response.body[1].emailVerified).toBe(false);
    });

    it('should handle database error', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

      const response = await adminRoutesRequest().get('/api/v1/admin/users');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /api/v1/admin/users', () => {
    it('should create a new user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        username: 'newuser',
        email: 'new@test.com',
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.username).toBe('newuser');
    });

    it('should reject missing username', async () => {
      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({ password: 'StrongPass123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject weak password', async () => {
      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: '123', email: 'new@test.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('security requirements');
    });

    it('should reject duplicate username', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({ username: 'existinguser', password: 'StrongPass123!', email: 'existing@test.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already exists');
    });

    it('should reject short username', async () => {
      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({ username: 'ab', password: 'StrongPass123!', email: 'short@test.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 3');
    });

    it('should reject missing email', async () => {
      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: 'StrongPass123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid email format', async () => {
      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: 'StrongPass123!', email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('email');
    });

    it('should reject duplicate email', async () => {
      // First call: check username not taken (null)
      // Second call: check email already exists
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)  // username check
        .mockResolvedValueOnce({ id: 'existing-user', email: 'existing@test.com' });  // email check

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: 'StrongPass123!', email: 'existing@test.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already');
    });

    it('should auto-verify email for admin-created users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        username: 'newuser',
        email: 'new@test.com',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.emailVerified).toBe(true);
      // Verify the create call included emailVerified: true
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            emailVerified: true,
            emailVerifiedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should include email in created user response', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        username: 'newuser',
        email: 'new@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.email).toBe('new@test.com');
    });

    it('should handle create errors', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.user.create.mockRejectedValue(new Error('DB error'));

      const response = await adminRoutesRequest()
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });
}
