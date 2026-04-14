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

export function registerAdminUserManagementContracts(): void {
  // =============================================
  // USER MANAGEMENT
  // =============================================

  describe('User Management', () => {
    describe('GET /api/v1/admin/users', () => {
      it('should return all users for admin', async () => {
        const { token } = await createAdminAndLogin();

        // Create some test users
        await prisma.user.createMany({
          data: [
            { username: uniqueUsername('test1'), password: 'hash1' },
            { username: uniqueUsername('test2'), password: 'hash2' },
          ],
        });

        const response = await request(app)
          .get('/api/v1/admin/users')
          .set(authHeader(token))
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThanOrEqual(3); // admin + 2 test users
        expect(response.body[0]).toHaveProperty('id');
        expect(response.body[0]).toHaveProperty('username');
        expect(response.body[0]).not.toHaveProperty('password'); // Should not expose password
      });

      it('should deny access to non-admin users', async () => {
        const { token } = await createUserAndLogin();

        await request(app)
          .get('/api/v1/admin/users')
          .set(authHeader(token))
          .expect(403);
      });

      it('should deny access without authentication', async () => {
        await request(app)
          .get('/api/v1/admin/users')
          .expect(401);
      });
    });

    describe('POST /api/v1/admin/users', () => {
      it('should create a new user as admin', async () => {
        const { token } = await createAdminAndLogin();
        const newUsername = uniqueUsername('newuser');

        const response = await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: newUsername,
            password: 'NewUserPass123!',
            email: `${newUsername}@example.com`,
            isAdmin: false,
          })
          .expect(201);

        expect(response.body.username).toBe(newUsername);
        expect(response.body.isAdmin).toBe(false);
        expect(response.body).not.toHaveProperty('password');

        // Verify user exists in database
        const user = await prisma.user.findUnique({
          where: { username: newUsername },
        });
        expect(user).not.toBeNull();
      });

      it('should create admin user when isAdmin is true', async () => {
        const { token } = await createAdminAndLogin();
        const newUsername = uniqueUsername('newadmin');

        const response = await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: newUsername,
            password: 'AdminPass123!',
            email: `${newUsername}@example.com`,
            isAdmin: true,
          })
          .expect(201);

        expect(response.body.isAdmin).toBe(true);

        // Verify admin flag in database
        const user = await prisma.user.findUnique({
          where: { username: newUsername },
        });
        expect(user?.isAdmin).toBe(true);
      });

      it('should reject duplicate username', async () => {
        const { token } = await createAdminAndLogin();
        const existingUsername = uniqueUsername('existing');

        // Create existing user
        await prisma.user.create({
          data: {
            username: existingUsername,
            password: 'hash',
            email: `${existingUsername}@example.com`,
          },
        });

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: existingUsername,
            password: 'Password123!',
            email: `${existingUsername}2@example.com`,
          })
          .expect(409);
      });

      it('should reject weak password', async () => {
        const { token } = await createAdminAndLogin();
        const newUsername = uniqueUsername('weakpass');

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: newUsername,
            password: 'weak', // Too short, no uppercase, no number
            email: `${newUsername}@example.com`,
          })
          .expect(400);
      });

      it('should reject username shorter than 3 characters', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: 'ab',
            password: 'ValidPass123!',
            email: 'shortuser@example.com',
          })
          .expect(400);
      });

      it('should reject duplicate email', async () => {
        const { token } = await createAdminAndLogin();
        const uniqueEmail = `duplicate_${Date.now()}@example.com`;

        // Create user with email
        await prisma.user.create({
          data: {
            username: uniqueUsername('first'),
            password: 'hash',
            email: uniqueEmail,
          },
        });

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: uniqueUsername('second'),
            password: 'Password123!',
            email: uniqueEmail,
          })
          .expect(409);
      });

      it('should deny non-admin from creating users', async () => {
        const { token } = await createUserAndLogin();
        const newUsername = uniqueUsername('test');

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: newUsername,
            password: 'Password123!',
            email: `${newUsername}@example.com`,
          })
          .expect(403);
      });
    });

    describe('PUT /api/v1/admin/users/:userId', () => {
      it('should update user username', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username: oldUsername } = await createUserAndLogin();
        const newUsername = uniqueUsername('updated');

        const response = await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ username: newUsername })
          .expect(200);

        expect(response.body.username).toBe(newUsername);

        // Verify old username no longer exists
        const oldUser = await prisma.user.findUnique({
          where: { username: oldUsername },
        });
        expect(oldUser).toBeNull();
      });

      it('should update user email', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();
        const newEmail = `newemail_${Date.now()}@example.com`;

        const response = await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ email: newEmail })
          .expect(200);

        expect(response.body.email).toBe(newEmail);
      });

      it('should update user password', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();
        const newPassword = 'NewPassword123!';

        await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ password: newPassword })
          .expect(200);

        // Verify new password works
        await request(app)
          .post('/api/v1/auth/login')
          .send({ username, password: newPassword })
          .expect(200);
      });

      it('should promote user to admin', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const response = await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ isAdmin: true })
          .expect(200);

        expect(response.body.isAdmin).toBe(true);

        // Verify in database
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user?.isAdmin).toBe(true);
      });

      it('should demote admin to regular user', async () => {
        const { token: superAdminToken } = await createAdminAndLogin();
        const { adminId } = await createAdminAndLogin(); // Another admin

        const response = await request(app)
          .put(`/api/v1/admin/users/${adminId}`)
          .set(authHeader(superAdminToken))
          .send({ isAdmin: false })
          .expect(200);

        expect(response.body.isAdmin).toBe(false);
      });

      it('should return 404 for non-existent user', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .put('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .send({ username: 'test' })
          .expect(404);
      });

      it('should reject duplicate username on update', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();
        const existingUsername = uniqueUsername('existing');

        // Create another user with the target username
        await prisma.user.create({
          data: { username: existingUsername, password: 'hash' },
        });

        await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ username: existingUsername })
          .expect(409);
      });
    });

    describe('DELETE /api/v1/admin/users/:userId', () => {
      it('should delete a user', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();

        await request(app)
          .delete(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .expect(200);

        // Verify user is deleted
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user).toBeNull();

        // Verify can't login anymore
        await request(app)
          .post('/api/v1/auth/login')
          .send({ username, password: 'UserPass123!' })
          .expect(401);
      });

      it('should cascade delete wallet user associations', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        // Create wallet for user
        const wallet = await prisma.wallet.create({
          data: {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: { userId, role: 'owner' },
            },
          },
        });

        // Verify user-wallet association exists
        const associationBefore = await prisma.walletUser.findUnique({
          where: { walletId_userId: { userId, walletId: wallet.id } },
        });
        expect(associationBefore).not.toBeNull();

        await request(app)
          .delete(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .expect(200);

        // Verify user-wallet association is deleted (cascade)
        const associationAfter = await prisma.walletUser.findUnique({
          where: { walletId_userId: { userId, walletId: wallet.id } },
        });
        expect(associationAfter).toBeNull();
      });

      it('should prevent self-deletion', async () => {
        const { adminId, token } = await createAdminAndLogin();

        await request(app)
          .delete(`/api/v1/admin/users/${adminId}`)
          .set(authHeader(token))
          .expect(400);
      });

      it('should return 404 for non-existent user', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .delete('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .expect(404);
      });
    });
  });
}
