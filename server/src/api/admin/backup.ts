/**
 * Admin Backup Router
 *
 * Endpoints for backup creation, validation, and restoration (admin only)
 */

import { Router, Request, Response } from 'express';
import express from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { backupService, SanctuaryBackup } from '../../services/backupService';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { db as prisma } from '../../repositories/db';
import { verifyPassword } from '../../utils/password';

const router = Router();
const log = createLogger('ADMIN:BACKUP');

// Large body parser for backup/restore operations (200MB for large wallets)
const largeBodyParser = express.json({ limit: '200mb' });

/**
 * GET /api/v1/admin/encryption-keys
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
router.post('/encryption-keys', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    // Require password re-authentication for this sensitive operation
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password confirmation required to view encryption keys',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { password: true },
    });

    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({
        error: 'Unauthorized',
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
  } catch (error) {
    log.error('Failed to get encryption keys', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve encryption keys',
    });
  }
});

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
router.post('/backup', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { includeCache, description } = req.body;
    const adminUser = req.user?.username || 'unknown';

    log.info('Creating backup', { adminUser, includeCache });

    const backup = await backupService.createBackup(adminUser, {
      includeCache: includeCache === true,
      description,
    });

    // Audit log
    const totalRecords = Object.values(backup.meta.recordCounts).reduce((a, b) => a + b, 0);
    await auditService.logFromRequest(req, AuditAction.BACKUP_CREATE, AuditCategory.BACKUP, {
      details: {
        tables: Object.keys(backup.data).length,
        records: totalRecords,
        includeCache: includeCache === true,
      },
    });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString()
      .slice(0, 19)
      .replace(/[T:]/g, '-');
    const filename = `sanctuary-backup-${timestamp}.json`;

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.json(backup);
  } catch (error) {
    log.error('Backup creation failed', { error: String(error) });
    res.status(500).json({
      error: 'Backup Failed',
      message: 'Failed to create database backup',
    });
  }
});

/**
 * POST /api/v1/admin/backup/validate
 * Validate a backup file (admin only)
 *
 * Request body:
 *   - backup: SanctuaryBackup - The backup to validate
 *
 * Response: ValidationResult
 */
router.post('/backup/validate', largeBodyParser, authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { backup } = req.body;

    if (!backup) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing backup data',
      });
    }

    const validation = await backupService.validateBackup(backup);
    res.json(validation);
  } catch (error) {
    log.error('Backup validation failed', { error: String(error) });
    res.status(400).json({
      error: 'Validation Failed',
      message: 'Failed to validate backup file',
    });
  }
});

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
router.post('/restore', largeBodyParser, authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { backup, confirmationCode } = req.body;
    const adminUser = req.user?.username || 'unknown';

    // Require explicit confirmation
    if (confirmationCode !== 'CONFIRM_RESTORE') {
      return res.status(400).json({
        error: 'Confirmation Required',
        message: 'To restore from backup, send confirmationCode: "CONFIRM_RESTORE" in the request body. WARNING: This will delete all existing data.',
      });
    }

    if (!backup) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing backup data',
      });
    }

    // Validate before restore
    const validation = await backupService.validateBackup(backup);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid Backup',
        message: 'Backup validation failed',
        issues: validation.issues,
      });
    }

    log.info('Starting restore', {
      adminUser,
      backupDate: backup.meta?.createdAt,
      backupCreatedBy: backup.meta?.createdBy,
    });

    // Perform restore
    const result = await backupService.restoreFromBackup(backup as SanctuaryBackup);

    if (!result.success) {
      log.error('Restore failed', { adminUser, error: result.error });
      return res.status(500).json({
        error: 'Restore Failed',
        message: result.error,
        warnings: result.warnings,
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
        backupDate: backup.meta?.createdAt,
        backupCreatedBy: backup.meta?.createdBy,
      },
    });

    res.json({
      success: true,
      message: 'Database restored successfully',
      tablesRestored: result.tablesRestored,
      recordsRestored: result.recordsRestored,
      warnings: result.warnings,
    });
  } catch (error) {
    log.error('Restore error', { error: String(error) });
    res.status(500).json({
      error: 'Restore Failed',
      message: 'An unexpected error occurred during restore',
    });
  }
});

export default router;
