import request from 'supertest';
import { expect, it, vi } from 'vitest';

import { app } from './auth2faTestHarness';
import { mockPrismaClient } from '../auth.testHelpers';
import { hashPassword } from '../../../../src/utils/password';

export function registerTwoFactorDisableContracts() {
  it('should return 400 when password or token is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .send({ password: 'password123' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Password and 2FA token are required');
  });

  it('should return 404 when user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
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
      .post('/api/v1/auth/2fa/disable')
      .send({ password: 'password123', token: '123456' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('2FA is not enabled');
  });

  it('should return 401 when password is wrong', async () => {
    const hashedPassword = await hashPassword('CorrectPassword123!');

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
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
      twoFactorBackupCodes: null,
    });

    const { verifyToken, verifyBackupCode } = await import('../../../../src/services/twoFactorService');
    vi.mocked(verifyToken).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({ valid: false });

    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .send({ password: correctPassword, token: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid 2FA code');
  });

  it('should allow disabling via backup code when TOTP token fails', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
      twoFactorBackupCodes: '[{"hash":"h1"}]',
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    const { verifyToken, verifyBackupCode } = await import('../../../../src/services/twoFactorService');
    vi.mocked(verifyToken).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockReset().mockResolvedValue({ valid: true, updatedCodesJson: '[]' });

    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .send({ password: correctPassword, token: 'ABCD-EFGH' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should allow disabling using backup code when 2FA secret is missing', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: null,
      twoFactorBackupCodes: '[{"hash":"h1"}]',
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    const { verifyToken, verifyBackupCode } = await import('../../../../src/services/twoFactorService');
    vi.mocked(verifyToken).mockReset().mockReturnValue(true);
    vi.mocked(verifyBackupCode).mockReset().mockResolvedValue({ valid: true, updatedCodesJson: '[]' });

    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .send({ password: correctPassword, token: 'BACKUP-CODE' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
    expect(verifyBackupCode).toHaveBeenCalledWith('[{"hash":"h1"}]', 'BACKUP-CODE');
  });

  it('should successfully disable 2FA', async () => {
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

    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .send({ password: correctPassword, token: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should handle disable errors gracefully', async () => {
    const correctPassword = 'CorrectPassword123!';
    const hashedPassword = await hashPassword(correctPassword);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
    });
    mockPrismaClient.user.update.mockRejectedValueOnce(new Error('Write failed'));

    const response = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .send({ password: correctPassword, token: '123456' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
}
