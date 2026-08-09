import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const mocks = vi.hoisted(() => ({
  validatePasswordStrength: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  logFromRequest: vi.fn(),
  logInfo: vi.fn(),
  revokeAllUserTokens: vi.fn(),
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
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
    info: mocks.logInfo,
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createPasswordRouter } from '../../../src/api/auth/password';
import { errorHandler } from '../../../src/errors/errorHandler';

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
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mocks.validatePasswordStrength.mockReturnValue({ valid: true, errors: [] });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.hashPassword.mockResolvedValue('hashed-new-password');
    mocks.logFromRequest.mockResolvedValue(undefined);
    mocks.revokeAllUserTokens.mockResolvedValue(0);

    mockPrismaClient.systemSetting.delete.mockResolvedValue({ key: 'initialPassword_user-1', value: '' });
    mockPrismaClient.user.updateMany.mockResolvedValue({ count: 1 });
    mockPrismaClient.refreshToken.deleteMany.mockResolvedValue({ count: 3 });
  });

  it('POST /auth/me/change-password updates password, clears marker, and audits', async () => {
    mockPrismaClient.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1', password: 'stored-hash' })
      .mockResolvedValueOnce({ sessionVersion: 7 });

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
    expect(mockPrismaClient.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', password: 'stored-hash' },
      data: {
        password: 'hashed-new-password',
        sessionVersion: { increment: 1 },
      },
    });
    expect(mockPrismaClient.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(mockPrismaClient.systemSetting.delete).toHaveBeenCalledWith({
      where: { key: 'initialPassword_user-1' },
    });
    expect(mocks.revokeAllUserTokens).not.toHaveBeenCalled();
    expect(mocks.logInfo).toHaveBeenCalledWith('Password changed and sessions revoked', {
      userId: 'user-1',
      sessionVersion: 7,
      revokedRefreshTokenCount: 3,
    });
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'password.change',
      'auth',
      { details: { userId: 'user-1' } }
    );
    expect(mockPrismaClient.refreshToken.deleteMany).toHaveBeenCalledBefore(
      mockPrismaClient.systemSetting.delete,
    );
    expect(mockPrismaClient.systemSetting.delete).toHaveBeenCalledBefore(mocks.logFromRequest);
  });

  it('POST /auth/me/change-password returns 500 without cleanup or audit when atomic revocation fails', async () => {
    mockPrismaClient.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1', password: 'stored-hash' })
      .mockResolvedValueOnce({ sessionVersion: 7 });
    mockPrismaClient.refreshToken.deleteMany.mockRejectedValue(new Error('revocation failed'));

    const response = await request(app)
      .post('/api/v1/auth/me/change-password')
      .send({
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewStrongPass456!',
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal');
    expect(mockPrismaClient.systemSetting.delete).not.toHaveBeenCalled();
    expect(mocks.logFromRequest).not.toHaveBeenCalled();
    expect(mocks.revokeAllUserTokens).not.toHaveBeenCalled();
  });

  it('POST /auth/me/change-password rejects a stale verified hash before session mutation', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      password: 'stored-hash',
    });
    mockPrismaClient.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await request(app)
      .post('/api/v1/auth/me/change-password')
      .send({
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewStrongPass456!',
      });

    expect(response.status).toBe(409);
    expect(mockPrismaClient.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.systemSetting.delete).not.toHaveBeenCalled();
    expect(mocks.logFromRequest).not.toHaveBeenCalled();
    expect(mocks.revokeAllUserTokens).not.toHaveBeenCalled();
  });

  it('allows only one of two requests that verified the same old password to commit', async () => {
    let storedPassword = 'stored-hash';
    let sessionVersion = 2;
    let refreshTokenCount = 4;
    const verificationResolvers: Array<(valid: boolean) => void> = [];

    mockPrismaClient.user.findUnique.mockImplementation(async (args: any) => (
      args.select?.sessionVersion
        ? { sessionVersion }
        : { id: 'user-1', password: storedPassword }
    ));
    mocks.verifyPassword.mockImplementation(() => new Promise<boolean>((resolve) => {
      verificationResolvers.push(resolve);
      if (verificationResolvers.length === 2) {
        verificationResolvers.forEach(resolveVerification => resolveVerification(true));
      }
    }));
    mocks.hashPassword
      .mockResolvedValueOnce('first-new-hash')
      .mockResolvedValueOnce('second-new-hash');
    mockPrismaClient.user.updateMany.mockImplementation(async (args: any) => {
      if (args.where.password !== storedPassword) return { count: 0 };
      storedPassword = args.data.password;
      sessionVersion += 1;
      return { count: 1 };
    });
    mockPrismaClient.refreshToken.deleteMany.mockImplementation(async () => {
      const count = refreshTokenCount;
      refreshTokenCount = 0;
      return { count };
    });

    const requests = [
      request(app).post('/api/v1/auth/me/change-password').send({
        currentPassword: 'CurrentPass123!',
        newPassword: 'FirstStrongPass456!',
      }),
      request(app).post('/api/v1/auth/me/change-password').send({
        currentPassword: 'CurrentPass123!',
        newPassword: 'SecondStrongPass456!',
      }),
    ];
    const responses = await Promise.all(requests);

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(2);
    expect(mocks.verifyPassword).toHaveBeenNthCalledWith(1, 'CurrentPass123!', 'stored-hash');
    expect(mocks.verifyPassword).toHaveBeenNthCalledWith(2, 'CurrentPass123!', 'stored-hash');
    expect(sessionVersion).toBe(3);
    expect(refreshTokenCount).toBe(0);
    expect(['first-new-hash', 'second-new-hash']).toContain(storedPassword);
    expect(mockPrismaClient.refreshToken.deleteMany).toHaveBeenCalledOnce();
    expect(mockPrismaClient.systemSetting.delete).toHaveBeenCalledOnce();
    expect(mocks.logFromRequest).toHaveBeenCalledOnce();
    expect(mocks.revokeAllUserTokens).not.toHaveBeenCalled();
  });
});
