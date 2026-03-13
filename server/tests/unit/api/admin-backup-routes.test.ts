import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockCreateBackup,
  mockValidateBackup,
  mockRestoreFromBackup,
  mockAuditLogFromRequest,
  mockVerifyPassword,
  mockPrismaUserFindUnique,
} = vi.hoisted(() => ({
  mockCreateBackup: vi.fn(),
  mockValidateBackup: vi.fn(),
  mockRestoreFromBackup: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockPrismaUserFindUnique: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    if (req.headers['x-no-user'] !== 'true') {
      req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    }
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/services/backupService', () => ({
  backupService: {
    createBackup: mockCreateBackup,
    validateBackup: mockValidateBackup,
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

vi.mock('../../../src/repositories/db', () => ({
  db: {
    user: {
      findUnique: mockPrismaUserFindUnique,
    },
  },
}));

vi.mock('../../../src/utils/password', () => ({
  verifyPassword: mockVerifyPassword,
}));

import backupRouter from '../../../src/api/admin/backup';

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
    mockPrismaUserFindUnique.mockResolvedValue({ password: 'hashed-password' });
    mockCreateBackup.mockResolvedValue(makeBackup());
    mockValidateBackup.mockResolvedValue({
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

  it('returns 400 when password is not provided', async () => {
    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Password confirmation required to view encryption keys',
    });
  });

  it('returns 401 when password is incorrect', async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/v1/admin/encryption-keys')
      .send({ password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: 'Incorrect password',
    });
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
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'Failed to retrieve encryption keys',
    });
  });

  it('creates a backup, audits creation, and returns downloadable JSON', async () => {
    const response = await request(app)
      .post('/api/v1/admin/backup')
      .send({ includeCache: true, description: 'weekly snapshot' });

    expect(response.status).toBe(200);
    expect(mockCreateBackup).toHaveBeenCalledWith('admin', {
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
  });

  it('uses unknown as backup creator when request user is unavailable', async () => {
    await request(app)
      .post('/api/v1/admin/backup')
      .set('x-no-user', 'true')
      .send({ includeCache: false });

    expect(mockCreateBackup).toHaveBeenCalledWith('unknown', {
      includeCache: false,
      description: undefined,
    });
  });

  it('returns 500 when backup creation fails', async () => {
    mockCreateBackup.mockRejectedValue(new Error('backup failed'));

    const response = await request(app)
      .post('/api/v1/admin/backup')
      .send({ includeCache: false });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Backup Failed',
      message: 'Failed to create database backup',
    });
  });

  it('rejects backup validation requests without backup payload', async () => {
    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Missing backup data',
    });
  });

  it('validates backup payloads successfully', async () => {
    const backup = makeBackup();

    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .send({ backup });

    expect(response.status).toBe(200);
    expect(mockValidateBackup).toHaveBeenCalledWith(backup);
    expect(response.body.valid).toBe(true);
  });

  it('returns validation failure when backup validation throws', async () => {
    mockValidateBackup.mockRejectedValue(new Error('invalid file'));

    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .send({ backup: makeBackup() });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Validation Failed',
      message: 'Failed to validate backup file',
    });
  });

  it('requires explicit restore confirmation code', async () => {
    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'NOPE' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Confirmation Required');
  });

  it('rejects restore without backup payload', async () => {
    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Missing backup data',
    });
  });

  it('rejects restore when validation reports issues', async () => {
    mockValidateBackup.mockResolvedValue({
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

  it('returns restore failure when backup service reports unsuccessful restore', async () => {
    mockRestoreFromBackup.mockResolvedValue({
      success: false,
      tablesRestored: 1,
      recordsRestored: 2,
      warnings: ['Some records skipped'],
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
    });
    expect(mockAuditLogFromRequest).not.toHaveBeenCalledWith(
      expect.any(Object),
      'backup_restore',
      'backup',
      expect.any(Object)
    );
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
    mockValidateBackup.mockRejectedValue(new Error('validator crashed'));

    const response = await request(app)
      .post('/api/v1/admin/restore')
      .send({ backup: makeBackup(), confirmationCode: 'CONFIRM_RESTORE' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Restore Failed',
      message: 'An unexpected error occurred during restore',
    });
  });
});
