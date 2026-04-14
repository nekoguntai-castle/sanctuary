import request from 'supertest';
import { expect, it, vi } from 'vitest';

import { app } from './auth2faTestHarness';
import { mockPrismaClient } from '../auth.testHelpers';
import { hashPassword } from '../../../../src/utils/password';

export function registerTwoFactorBackupCodeCountContracts() {
  it('should return 400 when password is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Password is required');
  });

  it('should return 404 when user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .send({ password: 'password123' });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('User not found');
  });

  it('should return 401 when password is invalid', async () => {
    const hashedPassword = await hashPassword('CorrectPassword123!');

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .send({ password: 'WrongPassword123!' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid password');
  });

  it('should return 400 when 2FA is not enabled', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: false,
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .send({ password: correctPassword });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('2FA is not enabled');
  });

  it('should return remaining backup code count', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorBackupCodes: '[{"hash":"h1"},{"hash":"h2"}]',
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .send({ password: correctPassword });

    expect(response.status).toBe(200);
    expect(response.body.remaining).toBe(8);
  });

  it('should handle backup-code count errors gracefully', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorBackupCodes: '[{"hash":"h1"}]',
    });

    const { getRemainingBackupCodeCount } = await import('../../../../src/services/twoFactorService');
    vi.mocked(getRemainingBackupCodeCount).mockImplementationOnce(() => {
      throw new Error('Parse failed');
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .send({ password: correctPassword });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
}

export function registerTwoFactorBackupCodeRegenerateContracts() {
  it('should return 400 when password or token is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes/regenerate')
      .send({ password: 'password123' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Password and 2FA token are required');
  });

  it('should return 404 when user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes/regenerate')
      .send({ password: 'password123', token: '123456' });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('User not found');
  });

  it('should return 400 when 2FA is not enabled', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      twoFactorEnabled: false,
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes/regenerate')
      .send({ password: 'password123', token: '123456' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('2FA is not enabled');
  });

  it('should return 401 when password is invalid', async () => {
    const hashedPassword = await hashPassword('CorrectPassword123!');

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes/regenerate')
      .send({ password: 'WrongPassword123!', token: '123456' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid password');
  });

  it('should return 401 when 2FA token is invalid', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
    });

    const { verifyToken } = await import('../../../../src/services/twoFactorService');
    vi.mocked(verifyToken).mockReturnValueOnce(false);

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes/regenerate')
      .send({ password: correctPassword, token: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid 2FA code');
  });

  it('should successfully regenerate backup codes', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    // Reset and explicitly set verifyToken to return true
    const twoFactorService = await import('../../../../src/services/twoFactorService');
    vi.mocked(twoFactorService.verifyToken).mockReset().mockReturnValue(true);

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes/regenerate')
      .send({ password: correctPassword, token: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.backupCodes).toHaveLength(8);
  });

  it('should handle regenerate backup code errors gracefully', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
    });

    const twoFactorService = await import('../../../../src/services/twoFactorService');
    vi.mocked(twoFactorService.verifyToken).mockReturnValueOnce(true);
    vi.mocked(twoFactorService.hashBackupCodes).mockRejectedValueOnce(new Error('Hash failed'));

    const response = await request(app)
      .post('/api/v1/auth/2fa/backup-codes/regenerate')
      .send({ password: correctPassword, token: '123456' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
}
