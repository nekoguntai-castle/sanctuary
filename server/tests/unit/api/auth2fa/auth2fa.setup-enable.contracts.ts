import request from 'supertest';
import { expect, it, vi } from 'vitest';

import { app } from './auth2faTestHarness';
import { mockPrismaClient } from '../auth.testHelpers';

export function registerTwoFactorSetupContracts() {
  it('should return 404 when user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('User not found');
  });

  it('should return 400 when 2FA is already enabled', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      twoFactorEnabled: true,
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('2FA is already enabled');
  });

  it('should successfully start 2FA setup', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      twoFactorEnabled: false,
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    const response = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.secret).toBe('mock-secret');
    expect(response.body.qrCodeDataUrl).toBeDefined();
  });

  it('should handle errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

    const response = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .send({});

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
}

export function registerTwoFactorEnableContracts() {
  it('should return 400 when token is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Verification token is required');
  });

  it('should return 404 when user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({ token: '123456' });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('User not found');
  });

  it('should return 400 when secret not set (setup not started)', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      twoFactorSecret: null,
      twoFactorEnabled: false,
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({ token: '123456' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Please start 2FA setup first');
  });

  it('should return 400 when 2FA already enabled', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      twoFactorSecret: 'some-secret',
      twoFactorEnabled: true,
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({ token: '123456' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('2FA is already enabled');
  });

  it('should return 400 when verification code is invalid', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      twoFactorSecret: 'some-secret',
      twoFactorEnabled: false,
    });

    const { verifyToken } = await import('../../../../src/services/twoFactorService');
    const mockVerifyToken = vi.mocked(verifyToken);
    mockVerifyToken.mockReturnValueOnce(false);

    const response = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({ token: '000000' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid verification code');
  });

  it('should successfully enable 2FA', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      twoFactorSecret: 'some-secret',
      twoFactorEnabled: false,
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    const response = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({ token: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.backupCodes).toHaveLength(8);
  });

  it('should handle errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

    const response = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({ token: '123456' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
}
