/**
 * Auth - Two-Factor Authentication Setup Routes
 *
 * Endpoints for 2FA setup and enabling
 */

import { Router } from 'express';
import { userRepository } from '../../../repositories';
import * as twoFactorService from '../../../services/twoFactorService';
import { auditService, AuditAction, AuditCategory } from '../../../services/auditService';
import { authenticate, requireAuthenticatedUser } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { asyncHandler } from '../../../errors/errorHandler';
import { NotFoundError, InvalidInputError } from '../../../errors/ApiError';
import { TwoFactorEnableSchema } from '../../schemas/auth';

/**
 * Create the 2FA setup router
 */
export function createSetupRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/auth/2fa/setup
   * Start 2FA setup - generates secret and QR code
   */
  router.post('/2fa/setup', authenticate, asyncHandler(async (req, res) => {
    const user = await userRepository.findById(requireAuthenticatedUser(req).userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.twoFactorEnabled) {
      throw new InvalidInputError('2FA is already enabled');
    }

    // Generate secret and QR code
    const { secret, qrCodeDataUrl } = await twoFactorService.generateSecret(user.username);

    // Store secret temporarily (not enabled yet)
    await userRepository.update(user.id, { twoFactorSecret: secret });

    // Audit 2FA setup started
    await auditService.logFromRequest(req, AuditAction.TWO_FACTOR_SETUP, AuditCategory.AUTH, {
      details: { userId: user.id },
    });

    res.json({ secret, qrCodeDataUrl });
  }));

  /**
   * POST /api/v1/auth/2fa/enable
   * Verify token and enable 2FA
   */
  router.post('/2fa/enable', authenticate, validate({ body: TwoFactorEnableSchema }, { message: 'Verification token is required' }), asyncHandler(async (req, res) => {
    const { token } = req.body;

    const user = await userRepository.findById(requireAuthenticatedUser(req).userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (!user.twoFactorSecret) {
      throw new InvalidInputError('Please start 2FA setup first');
    }

    if (user.twoFactorEnabled) {
      throw new InvalidInputError('2FA is already enabled');
    }

    // Verify the token
    const isValid = twoFactorService.verifyToken(user.twoFactorSecret, token);

    if (!isValid) {
      throw new InvalidInputError('Invalid verification code');
    }

    // Generate backup codes
    const backupCodes = twoFactorService.generateBackupCodes();
    const hashedBackupCodes = await twoFactorService.hashBackupCodes(backupCodes);

    // Enable 2FA
    await userRepository.update(user.id, {
      twoFactorEnabled: true,
      twoFactorBackupCodes: hashedBackupCodes,
    });

    // Audit 2FA enabled
    await auditService.logFromRequest(req, AuditAction.TWO_FACTOR_ENABLED, AuditCategory.AUTH, {
      details: { userId: user.id },
    });

    res.json({
      success: true,
      backupCodes, // Return plain-text codes for user to save (only shown once)
    });
  }));

  return router;
}
