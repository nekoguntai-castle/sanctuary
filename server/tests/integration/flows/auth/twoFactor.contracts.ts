import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestUser, extractAuthTokens, getTestUser, loginTestUser } from '../../setup/helpers';
import { app, prisma } from '../authIntegrationTestHarness';

export function registerAuthTwoFactorContracts(): void {
  describe('Two-Factor Authentication', () => {
    describe('2FA Setup', () => {
      it('should initiate 2FA setup', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        const response = await request(app)
          .post('/api/v1/auth/2fa/setup')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(response.body).toHaveProperty('secret');
        expect(response.body).toHaveProperty('qrCodeDataUrl');
        expect(response.body.secret).toBeDefined();
        expect(response.body.qrCodeDataUrl).toContain('data:image/png;base64');
      });

      it('should require authentication', async () => {
        await request(app)
          .post('/api/v1/auth/2fa/setup')
          .expect(401);
      });
    });

    describe('2FA Enable', () => {
      it('should reject enable without setup', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/enable')
          .set('Authorization', `Bearer ${token}`)
          .send({ token: '123456' })
          .expect(400);
      });

      it('should require token parameter', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/enable')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(400);
      });
    });

    describe('2FA Disable', () => {
      it('should reject disable for user without 2FA', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/disable')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: testUser.password })
          .expect(400);
      });

      it('should require password', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/disable')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(400);
      });
    });

    describe('2FA Verify', () => {
      it('should reject verify without pending 2FA state', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const loginResponse = await request(app)
          .post('/api/v1/auth/login')
          .send({
            username: testUser.username,
            password: testUser.password,
          })
          .expect(200);

        const { token: accessToken } = extractAuthTokens(loginResponse);
        await request(app)
          .post('/api/v1/auth/2fa/verify')
          .send({ tempToken: accessToken, code: '123456' })
          .expect(401);
      });

      it('should reject invalid token format', async () => {
        await request(app)
          .post('/api/v1/auth/2fa/verify')
          .send({ tempToken: 'invalid-token', code: '123456' })
          .expect(401);
      });
    });

    describe('2FA Backup Codes', () => {
      it('should reject backup codes request for user without 2FA', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/backup-codes')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: testUser.password })
          .expect(400);
      });

      it('should reject regenerate for user without 2FA', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/backup-codes/regenerate')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: testUser.password })
          .expect(400);
      });
    });
  });
}
