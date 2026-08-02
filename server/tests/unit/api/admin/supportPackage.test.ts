import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? {
    userId: 'test-user-id',
    username: 'testuser',
    isAdmin: false,
  },
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

import supportPackageRouter from '../../../../src/api/admin/supportPackage';

describe('Admin Support Package Route', () => {
  it('fails closed with the fixed unavailable response and no attachment', async () => {
    const app = express();
    app.use('/api/v1/admin', supportPackageRouter);

    const response = await request(app)
      .post('/api/v1/admin/support-package')
      .expect(503);

    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers).not.toHaveProperty('content-disposition');
    expect(response.body).toEqual({
      error: 'support_package_unavailable',
      message: 'Support package downloads are temporarily unavailable while privacy-safe diagnostics are being implemented.',
    });
  });

  it('returns the same fixed response for repeated requests', async () => {
    const app = express();
    app.use('/api/v1/admin', supportPackageRouter);

    const first = await request(app).post('/api/v1/admin/support-package');
    const second = await request(app).post('/api/v1/admin/support-package');

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(second.body).toEqual(first.body);
  });
});
