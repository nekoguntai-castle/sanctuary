import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockAudit, mockGenerate, mockRelease, mockLease, mockWarn } = vi.hoisted(() => ({
  mockAudit: vi.fn(),
  mockGenerate: vi.fn(),
  mockRelease: vi.fn(),
  mockLease: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user,
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock('../../../../src/services/supportPackage', () => ({
  generateSerializedSupportPackage: (...args: unknown[]) => mockGenerate(...args),
}));
vi.mock('../../../../src/services/supportPackage/generationLease', () => ({
  acquireSupportPackageGenerationLease: (...args: unknown[]) => mockLease(...args),
}));
vi.mock('../../../../src/services/auditService', () => ({
  AuditAction: { SUPPORT_PACKAGE_GENERATE: 'admin.support_package_generate' },
  AuditCategory: { ADMIN: 'admin' },
  auditService: { logFromRequest: (...args: unknown[]) => mockAudit(...args) },
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

import { errorHandler } from '../../../../src/errors/errorHandler';
import supportPackageRouter from '../../../../src/api/admin/supportPackage';

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/admin', supportPackageRouter);
  instance.use(errorHandler);
  return instance;
}

describe('Admin Support Package Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRelease.mockResolvedValue(undefined);
    mockLease.mockResolvedValue({ status: 'acquired', release: mockRelease });
    mockGenerate.mockResolvedValue(Buffer.from('{"profile":"shareable_aggregate"}'));
    mockAudit.mockResolvedValue(undefined);
  });

  it('requires explicit aggregate-activity confirmation', async () => {
    const response = await request(app()).post('/api/v1/admin/support-package').send({});

    expect(response.status).toBe(400);
    expect(response.headers).not.toHaveProperty('content-disposition');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('sends the exact validated bytes only after generation succeeds', async () => {
    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(200);

    expect(response.text).toBe('{"profile":"shareable_aggregate"}');
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="sanctuary-support-/);
    expect(response.headers['content-length']).toBe('33');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      'admin.support_package_generate',
      'admin',
      { details: { profile: 'shareable_aggregate', version: '2.0.0' } },
    );
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('fails atomically before attachment headers on privacy failure', async () => {
    mockGenerate.mockRejectedValue(new Error('postgres://private:secret@db/internal'));

    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(503);

    expect(response.headers).not.toHaveProperty('content-disposition');
    expect(response.body).toEqual({
      error: 'support_package_unavailable',
      message: 'The privacy-safe support package could not be generated.',
    });
    expect(JSON.stringify(response.body)).not.toContain('private');
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it.each([
    ['busy', 429, 'support_package_generation_in_progress'],
    ['unavailable', 503, 'support_package_unavailable'],
  ] as const)('maps %s lease state to a fixed response', async (status, expectedStatus, code) => {
    mockLease.mockResolvedValue({ status });

    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(expectedStatus);

    expect(response.body.error).toBe(code);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('does not let aggregate audit failure corrupt safe bytes', async () => {
    mockAudit.mockRejectedValue(new Error('audit unavailable'));

    await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(200);

    expect(mockRelease).toHaveBeenCalledOnce();
    expect(mockWarn).toHaveBeenCalledWith(
      'Support package audit write failed',
      { code: 'audit_unavailable' },
    );
  });

  it('does not let lease release failure corrupt safe bytes', async () => {
    mockRelease.mockRejectedValue(new Error('private redis detail'));

    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(200);

    expect(response.text).toBe('{"profile":"shareable_aggregate"}');
    expect(mockWarn).toHaveBeenCalledWith(
      'Support package generation lease release failed',
      { code: 'lease_release_failed' },
    );
  });
});
