/**
 * Admin Backup Router
 *
 * Endpoints for backup creation, validation, and restoration (admin only)
 */

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import express from 'express';
import { authenticate, requireAuthenticatedUser, requireAdmin } from '../../middleware/auth';
import { rateLimitByUser } from '../../middleware/rateLimit';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { backupService, SanctuaryBackup } from '../../services/backupService';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { verifyAdminPassword } from '../../services/adminCredentialService';
import {
  ConfirmRestoreSchema,
  CreateBackupSchema,
  EncryptionKeysRequestSchema,
  RestoreBackupSchema,
} from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';

const router = Router();
export const ADMIN_BACKUP_STAGING_PREFIX = '.sanctuary-admin-backup-';
const log = createLogger('ADMIN_BACKUP:ROUTE');

// Large body parser for backup/restore operations (200MB for large wallets)
const largeBodyParser = express.json({ limit: '200mb' });

/**
 * POST /api/v1/admin/encryption-keys
 * Get the encryption keys needed for backup restoration (admin only)
 *
 * These keys are required to restore encrypted data (node passwords, 2FA secrets)
 * when migrating to a new instance.
 *
 * Response:
 *   - encryptionKey: string - The ENCRYPTION_KEY from environment
 *   - encryptionSalt: string - The ENCRYPTION_SALT from environment
 *   - hasEncryptionKey: boolean - Whether ENCRYPTION_KEY is set
 *   - hasEncryptionSalt: boolean - Whether ENCRYPTION_SALT is set
 */
router.post('/encryption-keys', authenticate, requireAdmin, rateLimitByUser('auth:step-up-password'), asyncHandler(async (req, res) => {
  // Require password re-authentication for this sensitive operation
  const { password } = parseAdminRequestBody(
    EncryptionKeysRequestSchema,
    req.body,
    'Password confirmation required to view encryption keys'
  );

  if (!(await verifyAdminPassword(requireAuthenticatedUser(req).userId, password))) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: ErrorCodes.STEP_UP_CREDENTIAL_INVALID,
      message: 'Incorrect password',
    });
  }

  const encryptionKey = process.env.ENCRYPTION_KEY || '';
  const encryptionSalt = process.env.ENCRYPTION_SALT || '';

  // Audit this access since it's sensitive
  await auditService.logFromRequest(req, AuditAction.ENCRYPTION_KEYS_VIEW, AuditCategory.ADMIN, {
    details: { action: 'view_encryption_keys' },
  });

  res.json({
    encryptionKey,
    encryptionSalt,
    hasEncryptionKey: encryptionKey.length > 0,
    hasEncryptionSalt: encryptionSalt.length > 0,
  });
}));

/**
 * POST /api/v1/admin/backup
 * Create a database backup (admin only)
 *
 * Request body:
 *   - includeCache: boolean (optional) - Include price/fee cache tables
 *   - description: string (optional) - Backup description
 *
 * Response: JSON file download
 */
router.post('/backup', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { includeCache, description } = parseAdminRequestBody(CreateBackupSchema, req.body);
  const adminUser = req.user?.username || 'unknown';

  log.info('Creating backup', { adminUser, includeCache });

  // Generate filename with timestamp
  const timestamp = new Date().toISOString()
    .slice(0, 19)
    .replace(/[T:]/g, '-');
  const filename = `sanctuary-backup-${timestamp}.json`;

  // Stage the backup in an owner-only temp file, then send it. Building the
  // document in memory does not fit the heap on a large install, and staging
  // (rather than streaming straight to the socket) keeps three properties: an
  // export failure still answers with an error status, nothing is sent before
  // the audit record exists, and a slow client cannot hold the snapshot
  // transaction open.
  const stagingPath = join(tmpdir(), `${ADMIN_BACKUP_STAGING_PREFIX}${randomUUID()}.json`);
  try {
    const file = await open(stagingPath, 'wx', 0o600);
    let meta;
    try {
      meta = await backupService.writeBackup(adminUser, async (chunk) => {
        await file.writeFile(chunk, 'utf8');
      }, {
        includeCache: includeCache === true,
        description,
      });
    } finally {
      await file.close();
    }

    const totalRecords = Object.values(meta.recordCounts).reduce((a, b) => a + b, 0);
    await auditService.logFromRequest(req, AuditAction.BACKUP_CREATE, AuditCategory.BACKUP, {
      details: {
        tables: Object.keys(meta.recordCounts).length,
        records: totalRecords,
        includeCache: includeCache === true,
      },
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', (await stat(stagingPath)).size);
    try {
      await pipeline(createReadStream(stagingPath), res);
    } catch (error) {
      // pipeline has already destroyed the response; the client saw a cut-off download.
      log.warn('Backup download ended before the file was sent', { adminUser, error: getErrorMessage(error) });
    }
  } finally {
    await unlink(stagingPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Could not remove staged backup', { stagingPath, error: getErrorMessage(error) });
      }
    });
  }
}));

/**
 * POST /api/v1/admin/backup/validate
 * Validate a backup file (admin only)
 *
 * Request body:
 *   - backup: SanctuaryBackup - The backup to validate
 *
 * Response: ValidationResult
 */
router.post('/backup/validate', authenticate, requireAdmin, largeBodyParser, asyncHandler(async (req, res) => {
  const { backup } = parseAdminRequestBody(RestoreBackupSchema, req.body, 'Missing backup data');

  const validation = await backupService.validateBackupForRestore(backup);
  res.json(validation);
}));

/**
 * POST /api/v1/admin/restore
 * Restore database from backup (admin only)
 *
 * WARNING: This will DELETE ALL existing data and replace with backup data.
 *
 * Request body:
 *   - backup: SanctuaryBackup - The backup to restore
 *   - confirmationCode: string - Must be "CONFIRM_RESTORE" to proceed
 *
 * Response: RestoreResult
 */
router.post('/restore', authenticate, requireAdmin, largeBodyParser, asyncHandler(async (req, res) => {
  const { backup } = parseAdminRequestBody(
    ConfirmRestoreSchema,
    req.body,
    (issues) => issues.some((issue) => issue.path[0] === 'confirmationCode')
      ? 'To restore from backup, send confirmationCode: "CONFIRM_RESTORE" in the request body. WARNING: This will delete all existing data.'
      : 'Missing backup data'
  );
  const adminUser = req.user?.username || 'unknown';
  const backupToRestore = backup as unknown as SanctuaryBackup;

  // Validate before restore
  const validation = await backupService.validateBackupForRestore(backupToRestore);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Invalid Backup',
      message: 'Backup validation failed',
      issues: validation.issues,
    });
  }

  log.info('Starting restore', {
    adminUser,
    backupDate: backupToRestore.meta?.createdAt,
    backupCreatedBy: backupToRestore.meta?.createdBy,
  });

  // Perform restore
  const result = await backupService.restoreFromBackup(backupToRestore);

  if (!result.success) {
    log.error('Restore failed', { adminUser, error: result.error });
    return res.status(500).json({
      error: 'Restore Failed',
      message: result.error,
      warnings: result.warnings,
      committed: result.committed,
      cacheInvalidated: result.cacheInvalidated,
      accessCacheReconciled: result.accessCacheReconciled,
      featureRuntimeReconciled: result.featureRuntimeReconciled,
    });
  }

  log.info('Restore completed', {
    adminUser,
    tablesRestored: result.tablesRestored,
    recordsRestored: result.recordsRestored,
  });

  // Audit log (note: this creates a new audit log in the restored DB)
  await auditService.logFromRequest(req, AuditAction.BACKUP_RESTORE, AuditCategory.BACKUP, {
    details: {
      tablesRestored: result.tablesRestored,
      recordsRestored: result.recordsRestored,
      backupDate: backupToRestore.meta?.createdAt,
      backupCreatedBy: backupToRestore.meta?.createdBy,
    },
  });

  res.json({
    success: true,
    message: 'Database restored successfully',
    tablesRestored: result.tablesRestored,
    recordsRestored: result.recordsRestored,
    warnings: result.warnings,
    accessCacheReconciled: result.accessCacheReconciled,
    featureRuntimeReconciled: result.featureRuntimeReconciled,
  });
}));

export default router;
