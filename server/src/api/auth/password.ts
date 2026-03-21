/**
 * Auth - Password Router
 *
 * Endpoints for password management
 */

import { Router, Request, Response } from 'express';
import type { RequestHandler } from 'express';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../utils/password';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { revokeAllUserTokens } from '../../services/tokenRevocation';
import { getErrorMessage } from '../../utils/errors';

const router = Router();
const log = createLogger('AUTH:PASSWORD');

/**
 * Check if user is still using the initial generated password
 * by comparing against the marker stored during first setup
 */
export async function isUsingInitialPassword(userId: string): Promise<boolean> {
  try {
    // Check if the user's password matches the initial generated password hash
    // stored in system settings during first setup
    const initialPasswordSetting = await prisma.systemSetting.findUnique({
      where: { key: `initialPassword_${userId}` },
    });

    if (!initialPasswordSetting) {
      // No initial password marker - user was created after initial setup
      // or marker was cleared after password change
      return false;
    }

    // The setting stores the hash of the initial password
    // If the current password matches, user hasn't changed it
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });

    if (!user) return false;

    // Check if current password matches the initial password hash stored in settings
    return initialPasswordSetting.value === user.password;
  } catch (error) {
    log.error('Error checking initial password status', { error: getErrorMessage(error) });
    return false;
  }
}

/**
 * Clear the initial password marker after user changes their password
 */
export async function clearInitialPasswordMarker(userId: string): Promise<void> {
  try {
    await prisma.systemSetting.deleteMany({
      where: { key: `initialPassword_${userId}` },
    });
  } catch (error) {
    log.error('Error clearing initial password marker', { error: getErrorMessage(error) });
  }
}

/**
 * Create the change password route with rate limiter
 * Rate limiter is passed from the parent auth.ts to centralize configuration
 */
export function createPasswordRouter(passwordChangeLimiter: RequestHandler): Router {
  /**
   * POST /api/v1/auth/me/change-password
   * Change user password
   */
  router.post('/me/change-password', passwordChangeLimiter, async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;

      // Validation
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Current password and new password are required',
        });
      }

      // Validate new password strength (same requirements as registration)
      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password does not meet requirements',
          details: passwordValidation.errors,
        });
      }

      // Get user
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
      });

      if (!user) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User not found',
        });
      }

      // Verify current password
      const isValid = await verifyPassword(currentPassword, user.password);

      if (!isValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Current password is incorrect',
        });
      }

      // Hash new password
      const hashedPassword = await hashPassword(newPassword);

      // Update password
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
        },
      });

      // Clear the initial password marker since user has changed their password
      await clearInitialPasswordMarker(user.id);

      // Invalidate all existing sessions (security: prevent stolen tokens from persisting)
      await revokeAllUserTokens(user.id, 'password_change');

      // Audit password change
      await auditService.logFromRequest(req, AuditAction.PASSWORD_CHANGE, AuditCategory.AUTH, {
        details: { userId: user.id },
      });

      res.json({
        message: 'Password changed successfully',
      });
    } catch (error) {
      log.error('Change password error', { error: getErrorMessage(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to change password',
      });
    }
  });

  return router;
}

export default router;
