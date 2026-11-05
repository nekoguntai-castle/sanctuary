import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorHandler } from '../../../src/errors/errorHandler';

const {
  mockWriteBackup,
  mockValidateBackupForRestore,
  mockRestoreFromBackup,
  mockAuditLogFromRequest,
  mockVerifyPassword,
  mockPrismaUserFindUnique,
  mockRateLimitConsume,
} = vi.hoisted(() => ({
  mockWriteBackup: vi.fn(),
  mockValidateBackupForRestore: vi.fn(),
  mockRestoreFromBackup: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockPrismaUserFindUnique: vi.fn(),
  mockRateLimitConsume: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({ open: vi.fn(), unlink: vi.fn() }));

// Real filesystem, with seams to fail staging-file creation and removal.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  fsMocks.open.mockImplementation(actual.open);
  fsMocks.unlink.mockImplementation(actual.unlink);
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => fsMocks.open(...args),
    unlink: (...args: Parameters<typeof actual.unlink>) => fsMocks.unlink(...args),
  };
});

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: () => void) => {
    if (req.headers['x-no-user'] !== 'true') {
      req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    }
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

// The global setup stubs the rate-limit middleware; use the real one here and
// stub the service it consumes (it fails closed with 503 without Redis).
vi.mock('../../../src/middleware/rateLimit', () => vi.importActual('../../../src/middleware/rateLimit'));

vi.mock('../../../src/services/rateLimiting', () => ({
  rateLimitService: {
    consume: mockRateLimitConsume,
    getPolicy: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('../../../src/services/backupService', () => ({
  backupService: {
    writeBackup: mockWriteBackup,
    validateBackupForRestore: mockValidateBackupForRestore,
    restoreFromBackup: mockRestoreFromBackup,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditAction: {
    ENCRYPTION_KEYS_VIEW: 'encryption_keys_view',
    BACKUP_CREATE: 'backup_create',
    BACKUP_RESTORE: 'backup_restore',
  },
  AuditCategory: {
    ADMIN: 'admin',
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

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockPrismaUserFindUnique,
    },
  },
}));

vi.mock('../../../src/utils/password', () => ({
  verifyPassword: mockVerifyPassword,
}));

import backupRouter, { ADMIN_BACKUP_STAGING_PREFIX } from '../../../src/api/admin/backup';

async function stagedBackups(): Promise<string[]> {
  return (await readdir(tmpdir())).filter(file => file.startsWith(ADMIN_BACKUP_STAGING_PREFIX));
}

function makeBackup() {
  return {
    meta: {
      version: '1.0.0',
      appVersion: '1.2.3',
      schemaVersion: 12,
      createdAt: '2025-01-01T00:00:00.000Z',
      createdBy: 'admin',
      includesCache: true,
      recordCounts: {
        user: 2,
        wallet: 3,
      },
    },
    data: {
      user: [{ id: 'u1' }, { id: 'u2' }],
      wallet: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
    },
  };
}

/** Stream a backup the way writeBackup does: data first, one table per write, meta last. */
function streamBackup(backup: ReturnType<typeof makeBackup>) {
  return async (_admin: string, write: (chunk: string) => Promise<void>) => {
    await write('{"data":{');
    const tables = Object.entries(backup.data);
    for (const [index, [table, rows]] of tables.entries()) {
      await write(`${index === 0 ? '' : ','}${JSON.stringify(table)}:${JSON.stringify(rows)}`);
    }
    await write(`},"meta":${JSON.stringify(backup.meta)}}`);
    return backup.meta;
  };
}

describe('Admin Backup Routes', () => {
  let app: Express;
  let originalEncryptionKey: string | undefined;
  let originalEncryptionSalt: string | undefined;

  beforeAll(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    originalEncryptionSalt = process.env.ENCRYPTION_SALT;

    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', backupRouter);
    app.use(errorHandler);
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }

    if (originalEncryptionSalt === undefined) {
      delete process.env.ENCRYPTION_SALT;
    } else {
      process.env.ENCRYPTION_SALT = originalEncryptionSalt;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    process.env.ENCRYPTION_SALT = 'test-encryption-salt';

    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockVerifyPassword.mockResolvedValue(true);
    mockRateLimitConsume.mockResolvedValue({ allowed: true, remaining: 2, limit: 3, resetAt: Date.now() + 3_600_000 });
    mockPrismaUserFindUnique.mockResolvedValue({ password: 'hashed-password' });
    mockWriteBackup.mockImplementation(streamBackup(makeBackup()));
    mockValidateBackupForRestore.mockResolvedValue({
      valid: true,
      issues: [],
      warnings: [],
      info: {
        createdAt: '2025-01-01T00:00:00.000Z',
        appVersion: '1.2.3',
        schemaVersion: 12,
        totalRecords: 5,
        tables: ['user', 'wallet'],
      },
    });
    mockRestoreFromBackup.mockResolvedValue({
      success: true,
      tablesRestored: 2,
      recordsRestored: 5,
      warnings: [],
      accessCacheReconciled: true,
      featureRuntimeReconciled: true,
    });
  });

  it('returns encryption keys after password verification and audits access', async () => {
    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({ password: 'admin-password' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      encryptionKey: 'test-encryption-key',
      encryptionSalt: 'test-encryption-salt',
      hasEncryptionKey: true,
      hasEncryptionSalt: true,
    });
    expect(mockVerifyPassword).toHaveBeenCalledWith('admin-password', 'hashed-password');
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'encryption_keys_view',
      'admin',
      expect.objectContaining({ details: { action: 'view_encryption_keys' } })
    );
  });

  it('consumes the per-user auth:step-up-password budget before verifying the password', async () => {
    await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({ password: 'admin-password' });

    expect(mockRateLimitConsume).toHaveBeenCalledWith('auth:step-up-password', 'user:admin-1');
  });

  it('returns 429 without verifying the password when the step-up budget is exhausted', async () => {
    mockRateLimitConsume.mockResolvedValue({
      allowed: false, remaining: 0, limit: 3, resetAt: Date.now() + 3_600_000, retryAfter: 3600,
    });

    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({ password: 'admin-password' });

    expect(response.status).toBe(429);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
  });

  it('returns 400 when password is not provided', async () => {
    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
  });

  it('returns 401 when password is incorrect', async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({ password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
    expect(response.body.code).toBe('STEP_UP_CREDENTIAL_INVALID');
  });

  it('returns empty encryption values when environment variables are missing', async () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_SALT;

    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({ password: 'admin-password' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      encryptionKey: '',
      encryptionSalt: '',
      hasEncryptionKey: false,
      hasEncryptionSalt: false,
    });
  });

  it('returns 500 when encryption key lookup auditing fails', async () => {
    mockAuditLogFromRequest.mockRejectedValue(new Error('audit failure'));

    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({ password: 'admin-password' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('creates a backup, audits creation, and returns downloadable JSON', async () => {
    const response = await request(app)
      .post('/api/v1/admin/backup')
      .send({ includeCache: true, description: 'weekly snapshot' });

    expect(response.status).toBe(200);
    expect(mockWriteBackup).toHaveBeenCalledWith('admin', expect.any(Function), {
      includeCache: true,
      description: 'weekly snapshot',
    });
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'backup_create',
      'backup',
      expect.objectContaining({
        details: {
          tables: 2,
          records: 5,
          includeCache: true,
        },
      })
    );
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="sanctuary-backup-.*\.json"/);
    expect(response.body.meta.createdBy).toBe('admin');
    expect(response.body).toEqual(makeBackup());
  });

  it('uses unknown as backup creator when request user is unavailable', async () => {
    await request(app)
      .post('/api/v1/admin/backup')
      .set('x-no-user', 'true')
      .send({ includeCache: false });

    expect(mockWriteBackup).toHaveBeenCalledWith('unknown', expect.any(Function), {
      includeCache: false,
      description: undefined,
    });
  });

  it('returns 500 when backup creation fails before anything is streamed', async () => {
    mockWriteBackup.mockRejectedValue(new Error('backup failed'));

    const response = await request(app)
      .post('/api/v1/admin/backup')
      .send({ includeCache: false });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
  });

  it('answers 500 and removes the staged file when the export fails midway', async () => {
    mockWriteBackup.mockImplementation(async (_admin: string, write: (chunk: string) => Promise<void>) => {
      await write('{"data":{');
      throw new Error('export failed midway');
    });

    const response = await request(app).post('/api/v1/admin/backup').send({ includeCache: false });

    expect(response.status).toBe(500);
    expect(mockAuditLogFromRequest).not.toHaveBeenCalled();
    expect(await stagedBackups()).toEqual([]);
  });

  it('sends nothing when the audit record cannot be written', async () => {
    mockAuditLogFromRequest.mockRejectedValue(new Error('audit unavailable'));

    const response = await request(app).post('/api/v1/admin/backup').send({ includeCache: false });

    expect(response.status).toBe(500);
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body.data).toBeUndefined();
    expect(await stagedBackups()).toEqual([]);
  });

  it('sends the staged file with its length and removes it afterwards', async () => {
    const response = await request(app).post('/api/v1/admin/backup').send({ includeCache: false });

    expect(response.status).toBe(200);
    expect(Number(response.headers['content-length'])).toBe(JSON.stringify(makeBackup()).length);
    // The body can reach the client before the handler's cleanup runs.
    await vi.waitFor(async () => expect(await stagedBackups()).toEqual([]));
  });

  it('removes the staged file when the client hangs up mid-download', async () => {
    const large = 'x'.repeat(8 * 1024 * 1024);
    mockWriteBackup.mockImplementation(async (_admin: string, write: (chunk: string) => Promise<void>) => {
      await write(`{"data":{"blob":["${large}"]},"meta":{"recordCounts":{"blob":1}}}`);
      return { recordCounts: { blob: 1 } };
    });

    const server: Server = await new Promise(resolve => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const closed = new Promise<void>(resolve => {
      server.on('connection', socket => socket.on('close', () => resolve()));
    });
    try {
      const { port } = server.address() as AddressInfo;
      const client = httpRequest({
        port,
        method: 'POST',
        path: '/api/v1/admin/backup',
        headers: { 'content-type': 'application/json' },
      }, () => client.destroy());
      client.on('error', () => undefined);
      client.end(JSON.stringify({ includeCache: false }));
      await closed;
      await vi.waitFor(async () => expect(await stagedBackups()).toEqual([]));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
    expect(mockAuditLogFromRequest).toHaveBeenCalledOnce();
  });

  it('keeps the original error when the staged file cannot be created', async () => {
    fsMocks.open.mockRejectedValueOnce(Object.assign(new Error('EACCES: staging'), { code: 'EACCES' }));

    const response = await request(app).post('/api/v1/admin/backup').send({ includeCache: false });

    expect(response.status).toBe(500);
    expect(mockWriteBackup).not.toHaveBeenCalled();
  });

  it('still answers when the staged file cannot be removed', async () => {
    fsMocks.unlink.mockRejectedValueOnce(Object.assign(new Error('EBUSY: staging'), { code: 'EBUSY' }));

    const response = await request(app).post('/api/v1/admin/backup').send({ includeCache: false });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(fsMocks.unlink).toHaveBeenCalled());
    for (const file of await stagedBackups()) await unlink(join(tmpdir(), file));
  });

  it('rejects backup validation requests without backup payload', async () => {
    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
  });

  it('validates backup payloads successfully', async () => {
    const backup = makeBackup();

    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .send({ backup });

    expect(response.status).toBe(200);
    expect(mockValidateBackupForRestore).toHaveBeenCalledWith(backup);
    expect(response.body.valid).toBe(true);
  });

  it('returns validation failure when backup validation throws', async () => {
    mockValidateBackupForRestore.mockRejectedValue(new Error('invalid file'));

    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .send({ backup: makeBackup() });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('requires explicit restore confirmation code', async () => {
    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'NOPE' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
  });

  it('rejects restore without backup payload', async () => {
    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
  });

  it('rejects restore when validation reports issues', async () => {
    mockValidateBackupForRestore.mockResolvedValue({
      valid: false,
      issues: ['Missing user table'],
      warnings: [],
      info: {
        createdAt: '2025-01-01T00:00:00.000Z',
        appVersion: '1.2.3',
        schemaVersion: 12,
        totalRecords: 0,
        tables: [],
      },
    });

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Invalid Backup',
      message: 'Backup validation failed',
      issues: ['Missing user table'],
    });
  });

  it('rejects destructive restore when strict restore validation reports a partial backup', async () => {
    mockValidateBackupForRestore.mockResolvedValue({
      valid: false,
      issues: ['Missing required restore table: wallet'],
      warnings: ['Missing table: wallet'],
      info: {
        createdAt: '2025-01-01T00:00:00.000Z',
        appVersion: '1.2.3',
        schemaVersion: 12,
        totalRecords: 2,
        tables: ['user'],
      },
    });

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(400);
    expect(response.body.issues).toContain('Missing required restore table: wallet');
    expect(mockRestoreFromBackup).not.toHaveBeenCalled();
  });

  it('returns restore failure when backup service reports unsuccessful restore', async () => {
    mockRestoreFromBackup.mockResolvedValue({
      success: false,
      tablesRestored: 1,
      recordsRestored: 2,
      warnings: ['Some records skipped'],
      committed: false,
      cacheInvalidated: false,
      accessCacheReconciled: false,
      featureRuntimeReconciled: false,
      error: 'constraint violation',
    });

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Restore Failed',
      message: 'constraint violation',
      warnings: ['Some records skipped'],
      committed: false,
      cacheInvalidated: false,
      accessCacheReconciled: false,
      featureRuntimeReconciled: false,
    });
    expect(mockAuditLogFromRequest).not.toHaveBeenCalledWith(
      expect.any(Object),
      'backup_restore',
      'backup',
      expect.any(Object)
    );
  });

  it('reports committed restore feature runtime failures distinctly', async () => {
    mockRestoreFromBackup.mockResolvedValue({
      success: false,
      tablesRestored: 5,
      recordsRestored: 100,
      warnings: [],
      committed: true,
      cacheInvalidated: true,
      accessCacheReconciled: true,
      featureRuntimeReconciled: false,
      error: 'Restore committed but feature runtime reconciliation failed: worker acknowledgement missing',
    });

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Restore Failed',
      message: 'Restore committed but feature runtime reconciliation failed: worker acknowledgement missing',
      warnings: [],
      accessCacheReconciled: true,
      featureRuntimeReconciled: false,
      committed: true,
      cacheInvalidated: true,
    });
  });

  it('restores backup successfully and audits completion', async () => {
    const backup = makeBackup();

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup, confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(200);
    expect(mockRestoreFromBackup).toHaveBeenCalledWith(backup);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Database restored successfully',
      tablesRestored: 2,
      recordsRestored: 5,
      warnings: [],
      accessCacheReconciled: true,
      featureRuntimeReconciled: true,
    });
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'backup_restore',
      'backup',
      expect.objectContaining({
        details: expect.objectContaining({
          tablesRestored: 2,
          recordsRestored: 5,
          backupCreatedBy: 'admin',
        }),
      })
    );
  });

  it('uses unknown as restore admin when request user is unavailable', async () => {
    const backup = makeBackup();

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .set('x-no-user', 'true')
      .send({ backup, confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(200);
    expect(mockRestoreFromBackup).toHaveBeenCalledWith(backup);
  });

  it('returns 500 when restore flow throws unexpectedly', async () => {
    mockValidateBackupForRestore.mockRejectedValue(new Error('validator crashed'));

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
