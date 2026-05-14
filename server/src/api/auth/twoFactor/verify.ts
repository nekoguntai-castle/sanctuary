/**
 * Auth - Two-Factor Authentication Verification Route
 *
 * Endpoint for verifying 2FA code during login
 */

import { Router } from 'express';
import type { RequestHandler } from 'express';
import { userRepository } from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { verify2FAToken } from '../../../utils/jwt';
import * as twoFactorService from '../../../services/twoFactorService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../../services/auditService';
import { validate } from '../../../middleware/validate';
import { asyncHandler } from '../../../errors/errorHandler';
import { UnauthorizedError } from '../../../errors/ApiError';
import { TwoFactorVerifySchema } from '../../schemas/auth';
import { prepareAuthSession, sendAuthSessionResponse } from '../sessionResponse';

const log = createLogger('AUTH_2FA:ROUTE');

/**
 * Create the 2FA verification router
 * Rate limiter is passed from the parent auth.ts to centralize configuration
 */
export function createVerifyRouter(twoFactorLimiter: RequestHandler): Router {
  const router = Router();

  /**
   * POST /api/v1/auth/2fa/verify
   * Verify 2FA code during login (uses temporary token)
   */
  router.post('/2fa/verify', twoFactorLimiter, validate({ body: TwoFactorVerifySchema }, { message: 'Temporary token and verification code are required' }), asyncHandler(async (req, res) => {
    const { tempToken, code } = req.body;

    // SEC-006: Verify temp token with audience claim
    let decoded;
    try {
      decoded = await verify2FAToken(tempToken);
    } catch (err) {
      log.debug('2FA token verification failed', { error: (err as Error).message });
      throw new UnauthorizedError('Invalid or expired temporary token');
    }

    const user = await userRepository.findById(decoded.userId);

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedError('Invalid authentication state');
    }

    // Password, role, or logout-all changes invalidate pending 2FA login tokens too.
    if (decoded.sessionVersion !== user.sessionVersion) {
      throw new UnauthorizedError('Invalid or expired temporary token');
    }

    // Check if it's a TOTP code or backup code
    let codeValid = false;
    let usedBackupCode = false;

    if (twoFactorService.isBackupCode(code)) {
      // Try backup code
      const backupResult = await twoFactorService.verifyBackupCode(user.twoFactorBackupCodes, code);
      if (backupResult.valid) {
        codeValid = true;
        usedBackupCode = true;
        // Update backup codes (mark as used)
        if (backupResult.updatedCodesJson) {
          await userRepository.update(user.id, { twoFactorBackupCodes: backupResult.updatedCodesJson });
        }
      }
    } else {
      // Try TOTP code
      codeValid = twoFactorService.verifyToken(user.twoFactorSecret, code);
    }

    if (!codeValid) {
      // Audit failed 2FA
      const { ipAddress, userAgent } = getClientInfo(req);
      await auditService.log({
        userId: user.id,
        username: user.username,
        action: AuditAction.TWO_FACTOR_FAILED,
        category: AuditCategory.AUTH,
        ipAddress,
        userAgent,
        success: false,
        errorMsg: 'Invalid 2FA code',
      });

      throw new UnauthorizedError('Invalid verification code');
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const authSession = await prepareAuthSession(user, {
      clientInfo: { ipAddress, userAgent },
      usingDefaultPassword: decoded.usingDefaultPassword || false,
    });

    // Audit successful login with 2FA
    await auditService.log({
      userId: user.id,
      username: user.username,
      action: usedBackupCode ? AuditAction.TWO_FACTOR_BACKUP_CODE_USED : AuditAction.TWO_FACTOR_VERIFIED,
      category: AuditCategory.AUTH,
      ipAddress,
      userAgent,
      success: true,
    });

    // Also audit the login itself
    await auditService.log({
      userId: user.id,
      username: user.username,
      action: AuditAction.LOGIN,
      category: AuditCategory.AUTH,
      ipAddress,
      userAgent,
      success: true,
      details: { via2FA: true, usedBackupCode },
    });

    // ADR 0001 / 0002 — Phase 6: browser auth is cookie-only. Tokens are
    // delivered via HttpOnly cookies; the JSON body no longer carries them.
    sendAuthSessionResponse(req, res, authSession);
  }));

  return router;
}
