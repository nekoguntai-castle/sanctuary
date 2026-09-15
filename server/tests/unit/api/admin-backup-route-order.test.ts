/**
 * Regression tests for `admin-backup-large-body-parse-before-auth`.
 *
 * `POST /api/v1/admin/restore` and `POST /api/v1/admin/backup/validate` are
 * the only two routes the global default JSON parser (`bodyParsing.ts`'s
 * `largeJsonBodyRoutes` table) bypasses entirely — the route-level 200 MB
 * `largeBodyParser` in `backup.ts` is the only parser that ever touches
 * their bodies. Wiring the parser before `authenticate`/`requireAdmin` means
 * an unauthenticated caller's request body is fully parsed (up to 200 MB)
 * before any auth check runs, which is an unauthenticated large-body
 * parsing surface.
 *
 * These tests mount the real `defaultJsonParser()` ahead of the router, the
 * same as `server/src/index.ts`, and a realistic (non-passthrough) mock of
 * `authenticate`/`requireAdmin` that actually rejects requests without a
 * recognized Authorization header. The sentinel for "did the route-level
 * parser run before auth" is a syntactically invalid JSON body: if the
 * parser runs first it throws a SyntaxError that the error handler reports
 * as a 500, which is distinguishable from the 401 an auth-first order
 * produces without ever looking at the body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';
import { defaultJsonParser } from '../../../src/middleware/bodyParsing';

const {
  mockValidateBackupForRestore,
  mockRestoreFromBackup,
  mockAuditLogFromRequest,
} = vi.hoisted(() => ({
  mockValidateBackupForRestore: vi.fn(),
  mockRestoreFromBackup: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
}));

const ADMIN_AUTH_HEADER = 'Bearer valid-admin-token';

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, res: any, next: any) => {
    if (req.headers['authorization'] !== ADMIN_AUTH_HEADER) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided',
      });
    }
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    return next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    }
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }
    return next();
  },
}));

vi.mock('../../../src/services/backupService', () => ({
  backupService: {
    createBackup: vi.fn(),
    validateBackupForRestore: mockValidateBackupForRestore,
    restoreFromBackup: mockRestoreFromBackup,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditAction: {
    BACKUP_RESTORE: 'backup_restore',
  },
  AuditCategory: {
    BACKUP: 'backup',
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import backupRouter from '../../../src/api/admin/backup';

function makeBackup(padding = '') {
  return {
    meta: {
      version: '1.0.0',
      appVersion: '1.2.3',
      schemaVersion: 12,
      createdAt: '2025-01-01T00:00:00.000Z',
      createdBy: 'admin',
    },
    data: {
      user: [{ id: 'u1' }],
      padding,
    },
  };
}

describe('Admin backup routes authenticate before the route-level body parser runs', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mirrors server/src/index.ts: the global default JSON parser is mounted
    // ahead of the router and bypasses these two routes entirely, leaving
    // the route-level `largeBodyParser` as the only parser in play.
    app = express();
    app.use(defaultJsonParser());
    app.use('/api/v1/admin', backupRouter);
    app.use(errorHandler);

    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockValidateBackupForRestore.mockResolvedValue({
      valid: true,
      issues: [],
      warnings: [],
      info: {
        createdAt: '2025-01-01T00:00:00.000Z',
        appVersion: '1.2.3',
        schemaVersion: 12,
        totalRecords: 1,
        tables: ['user'],
      },
    });
    mockRestoreFromBackup.mockResolvedValue({
      success: true,
      tablesRestored: 1,
      recordsRestored: 1,
      warnings: [],
      accessCacheReconciled: true,
      featureRuntimeReconciled: true,
    });
  });

  it('rejects an unauthenticated POST /api/v1/admin/restore with 401 without ever parsing the body', async () => {
    const response = await request(app)
      .post('/api/v1/admin/restore')
      .set('Content-Type', 'application/json')
      // Syntactically invalid JSON: if the route-level parser ran before
      // auth it would throw, surfacing as a 500 via the error handler
      // instead of the 401 an auth-first order produces.
      .send('{not valid json');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
    expect(mockValidateBackupForRestore).not.toHaveBeenCalled();
    expect(mockRestoreFromBackup).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated POST /api/v1/admin/backup/validate with 401 without ever parsing the body', async () => {
    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
    expect(mockValidateBackupForRestore).not.toHaveBeenCalled();
  });

  it('lets an authenticated admin with a large body reach the /restore handler', async () => {
    // ~11MB padding: bigger than the 10MB default body limit these routes
    // are exempt from, well under the route-level 200MB limit.
    const backup = makeBackup('x'.repeat(11 * 1024 * 1024));

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .set('Authorization', ADMIN_AUTH_HEADER)
      .send({ backup, confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(200);
    expect(mockValidateBackupForRestore).toHaveBeenCalledWith(backup);
    expect(mockRestoreFromBackup).toHaveBeenCalledWith(backup);
  });

  it('lets an authenticated admin with a large body reach the /backup/validate handler', async () => {
    const backup = makeBackup('x'.repeat(11 * 1024 * 1024));

    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .set('Authorization', ADMIN_AUTH_HEADER)
      .send({ backup });

    expect(response.status).toBe(200);
    expect(mockValidateBackupForRestore).toHaveBeenCalledWith(backup);
    expect(response.body.valid).toBe(true);
  });
});
