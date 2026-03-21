import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const mocks = vi.hoisted(() => ({
  validatePasswordStrength: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  logFromRequest: vi.fn(),
  revokeAllUserTokens: vi.fn(),
}));

vi.mock('../../../src/repositories/db', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    db: prisma,
    default: prisma,
  };
});

vi.mock('../../../src/utils/password', () => ({
  validatePasswordStrength: mocks.validatePasswordStrength,
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hashPassword,
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mocks.logFromRequest,
  },
  AuditAction: {
    PASSWORD_CHANGE: 'password.change',
  },
  AuditCategory: {
    AUTH: 'auth',
  },
}));

vi.mock('../../../src/services/tokenRevocation', () => ({
  revokeAllUserTokens: mocks.revokeAllUserTokens,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createPasswordRouter } from '../../../src/api/auth/password';

describe('auth password routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1' };
      next();
    });
    app.use('/api/v1/auth', createPasswordRouter((_req: any, _res: any, next: any) => next()));
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mocks.validatePasswordStrength.mockReturnValue({ valid: true, errors: [] });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.hashPassword.mockResolvedValue('hashed-new-password');
    mocks.logFromRequest.mockResolvedValue(undefined);
    mocks.revokeAllUserTokens.mockResolvedValue(0);

    mockPrismaClient.systemSetting.deleteMany.mockResolvedValue({ count: 1 });
    mockPrismaClient.user.update.mockResolvedValue({ id: 'user-1' });
  });

  it('POST /auth/me/change-password updates password, clears marker, and audits', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: 'stored-hash',
    });

    const response = await request(app)
      .post('/api/v1/auth/me/change-password')
      .send({
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewStrongPass456!',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Password changed successfully' });

    expect(mocks.verifyPassword).toHaveBeenCalledWith('CurrentPass123!', 'stored-hash');
    expect(mocks.hashPassword).toHaveBeenCalledWith('NewStrongPass456!');
    expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { password: 'hashed-new-password' },
    });
    expect(mockPrismaClient.systemSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: 'initialPassword_user-1' },
    });
    expect(mocks.revokeAllUserTokens).toHaveBeenCalledWith('user-1', 'password_change');
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'password.change',
      'auth',
      { details: { userId: 'user-1' } }
    );
  });

  it('POST /auth/me/change-password returns 500 when update fails', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: 'stored-hash',
    });
    mockPrismaClient.user.update.mockRejectedValue(new Error('update failed'));

    const response = await request(app)
      .post('/api/v1/auth/me/change-password')
      .send({
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewStrongPass456!',
      });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'Failed to change password',
    });
  });
});
