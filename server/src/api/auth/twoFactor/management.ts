/**
 * Auth - Two-Factor Authentication Management Routes
 *
 * Endpoints for disabling 2FA and managing backup codes
 */

import { Router } from 'express';
import { userRepository } from '../../../repositories';
import { verifyPassword } from '../../../utils/password';
import * as twoFactorService from '../../../services/twoFactorService';
import { auditService, AuditAction, AuditCategory } from '../../../services/auditService';
import { authenticate, requireAuthenticatedUser } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { asyncHandler } from '../../../errors/errorHandler';
import { NotFoundError, InvalidInputError, UnauthorizedError } from '../../../errors/ApiError';
import {
  BackupCodesRegenerateSchema,
  BackupCodesRequestSchema,
  TwoFactorDisableSchema,
} from '../../schemas/auth';

/**
 * Create the 2FA management router
 */
export function createManagementRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/auth/2fa/disable
   * Disable 2FA (requires password and current 2FA token)
   */
  router.post('/2fa/disable', authenticate, validate({ body: TwoFactorDisableSchema }, { message: 'Password and 2FA token are required' }), asyncHandler(async (req, res) => {
    const { password, token } = req.body;

    const user = await userRepository.findById(requireAuthenticatedUser(req).userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (!user.twoFactorEnabled) {
      throw new InvalidInputError('2FA is not enabled');
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedError('Invalid password');
    }

    // Verify 2FA token (allow backup code too)
    let tokenValid = false;
    if (user.twoFactorSecret) {
      tokenValid = twoFactorService.verifyToken(user.twoFactorSecret, token);
    }

    if (!tokenValid && user.twoFactorBackupCodes) {
      const backupResult = await twoFactorService.verifyBackupCode(user.twoFactorBackupCodes, token);
      tokenValid = backupResult.valid;
    }

    if (!tokenValid) {
      throw new UnauthorizedError('Invalid 2FA code');
    }

    // Disable 2FA
    await userRepository.update(user.id, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    });

    // Audit 2FA disabled
    await auditService.logFromRequest(req, AuditAction.TWO_FACTOR_DISABLED, AuditCategory.AUTH, {
      details: { userId: user.id },
    });

    res.json({ success: true });
  }));

  /**
   * POST /api/v1/auth/2fa/backup-codes
   * Get remaining backup codes count (requires password verification)
   * Changed from GET to POST to prevent password exposure in URL/logs
   */
  router.post('/2fa/backup-codes', authenticate, validate({ body: BackupCodesRequestSchema }, { message: 'Password is required' }), asyncHandler(async (req, res) => {
    const { password } = req.body;

    const user = await userRepository.findById(requireAuthenticatedUser(req).userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedError('Invalid password');
    }

    if (!user.twoFactorEnabled) {
      throw new InvalidInputError('2FA is not enabled');
    }

    const remaining = twoFactorService.getRemainingBackupCodeCount(user.twoFactorBackupCodes);

    res.json({ remaining });
  }));

  /**
   * POST /api/v1/auth/2fa/backup-codes/regenerate
   * Generate new backup codes (requires password and 2FA token)
   */
  router.post('/2fa/backup-codes/regenerate', authenticate, validate({ body: BackupCodesRegenerateSchema }, { message: 'Password and 2FA token are required' }), asyncHandler(async (req, res) => {
    const { password, token } = req.body;

    const user = await userRepository.findById(requireAuthenticatedUser(req).userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new InvalidInputError('2FA is not enabled');
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedError('Invalid password');
    }

    // Verify 2FA token
    const tokenValid = twoFactorService.verifyToken(user.twoFactorSecret, token);
    if (!tokenValid) {
      throw new UnauthorizedError('Invalid 2FA code');
    }

    // Generate new backup codes
    const backupCodes = twoFactorService.generateBackupCodes();
    const hashedBackupCodes = await twoFactorService.hashBackupCodes(backupCodes);

    await userRepository.update(user.id, { twoFactorBackupCodes: hashedBackupCodes });

    // Audit backup codes regenerated
    await auditService.logFromRequest(
      req,
      AuditAction.TWO_FACTOR_BACKUP_CODES_REGENERATED,
      AuditCategory.AUTH,
      { details: { userId: user.id } }
    );

    res.json({
      success: true,
      backupCodes,
    });
  }));

  return router;
}
