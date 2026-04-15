import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../../src/errors/errorHandler';

const { mockGenerateSupportPackage, mockAuditLogFromRequest } = vi.hoisted(() => ({
  mockGenerateSupportPackage: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../../src/services/supportPackage', () => ({
  generateSupportPackage: mockGenerateSupportPackage,
}));

vi.mock('../../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditAction: {
    SUPPORT_PACKAGE_GENERATE: 'admin.support_package_generate',
  },
  AuditCategory: {
    ADMIN: 'admin',
  },
}));

import supportPackageRouter from '../../../../src/api/admin/supportPackage';

describe('Admin Support Package Route', () => {
  let app: Express;

  const fakePkg = {
    version: '1.0.0',
    generatedAt: '2025-01-01T00:00:00.000Z',
    serverVersion: '1.0.0',
    collectors: {
      system: { process: {}, os: {} },
    },
    meta: {
      totalDurationMs: 150,
      succeeded: ['system', 'health'],
      failed: ['database'],
    },
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', supportPackageRouter);
    app.use(errorHandler);

    mockGenerateSupportPackage.mockReset();
    mockAuditLogFromRequest.mockReset();
    mockGenerateSupportPackage.mockResolvedValue(fakePkg);
    mockAuditLogFromRequest.mockResolvedValue(undefined);
  });

  it('generates a support package with Content-Disposition header', async () => {
    const res = await request(app)
      .post('/api/v1/admin/support-package')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="sanctuary-support-.+\.json"$/);
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.collectors.system).toEqual({ process: {}, os: {} });
  });

  it('audit logs the generate action', async () => {
    await request(app)
      .post('/api/v1/admin/support-package')
      .expect(200);

    expect(mockAuditLogFromRequest).toHaveBeenCalledTimes(1);
    const [, action, category, data] = mockAuditLogFromRequest.mock.calls[0];
    expect(action).toBe('admin.support_package_generate');
    expect(category).toBe('admin');
    expect(data.details.collectors).toBe(3); // 2 succeeded + 1 failed
    expect(data.details.succeeded).toBe(2);
    expect(data.details.failed).toBe(1);
    expect(data.details.durationMs).toBe(150);
  });

  it('returns 429 when already generating', async () => {
    // Use a deferred promise so first request stays in-flight
    let resolveFirst!: (value: typeof fakePkg) => void;
    mockGenerateSupportPackage.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    const firstPromise = request(app).post('/api/v1/admin/support-package').then((res) => res);
    await vi.waitFor(() => expect(mockGenerateSupportPackage).toHaveBeenCalledTimes(1));

    const second = await request(app).post('/api/v1/admin/support-package');
    resolveFirst(fakePkg);
    const first = await firstPromise;

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error).toBe('Support package generation already in progress');
  });

  it('resets generating flag after completion', async () => {
    await request(app)
      .post('/api/v1/admin/support-package')
      .expect(200);

    // Second request should also succeed (flag was reset)
    await request(app)
      .post('/api/v1/admin/support-package')
      .expect(200);
  });

  it('resets generating flag even on error', async () => {
    mockGenerateSupportPackage.mockRejectedValueOnce(new Error('collector crash'));

    await request(app)
      .post('/api/v1/admin/support-package')
      .expect(500);

    // After error, should be able to generate again
    mockGenerateSupportPackage.mockResolvedValueOnce(fakePkg);
    await request(app)
      .post('/api/v1/admin/support-package')
      .expect(200);
  });
});
