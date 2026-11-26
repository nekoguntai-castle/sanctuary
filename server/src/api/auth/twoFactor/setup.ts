/**
 * Auth - Two-Factor Authentication Setup Routes
 *
 * Endpoints for 2FA setup and enabling
 */

import { Router } from 'express';
import { userRepository } from '../../../repositories';
import * as twoFactorService from '../../../services/twoFactorService';
import { verifyAndConsumeTotp } from './consumeVerifiedTotp';
import { auditService, AuditAction, AuditCategory } from '../../../services/auditService';
import { authenticate, requireAuthenticatedUser } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { asyncHandler } from '../../../errors/errorHandler';
import { ConflictError, NotFoundError, InvalidInputError } from '../../../errors/ApiError';
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
    const { manualEntrySecret, encryptedSecret, qrCodeDataUrl } =
      await twoFactorService.generateSecret(user.username);

    // Store only the encrypted secret, temporarily (not enabled yet)
    const secretStored = await userRepository.setTwoFactorSecretIfDisabled(user.id, encryptedSecret);
    if (!secretStored) {
      throw new ConflictError('2FA state changed concurrently; please retry');
    }

    // Audit 2FA setup started
    await auditService.logFromRequest(req, AuditAction.TWO_FACTOR_SETUP, AuditCategory.AUTH, {
      details: { userId: user.id },
    });

    // The base32 secret is returned only to the user starting their own setup,
    // for manual entry into an authenticator app; it is never logged.
    res.json({ secret: manualEntrySecret, qrCodeDataUrl });
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

    // Verify the token and make it single-use so the same code cannot be
    // replayed to (re-)enable 2FA.
    const isValid = await verifyAndConsumeTotp(user.id, user.twoFactorSecret, token);

    if (!isValid) {
      throw new InvalidInputError('Invalid verification code');
    }

    // Generate backup codes
    const backupCodes = twoFactorService.generateBackupCodes();
    const hashedBackupCodes = await twoFactorService.hashBackupCodes(backupCodes);

    // Enable 2FA atomically only if the verified secret is still current and disabled
    const enabled = await userRepository.enableTwoFactorIfSecretMatches(
      user.id,
      user.twoFactorSecret,
      hashedBackupCodes
    );
    if (!enabled) {
      throw new ConflictError('2FA setup changed concurrently; please restart setup');
    }

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
