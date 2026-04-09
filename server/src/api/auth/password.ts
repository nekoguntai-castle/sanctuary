/**
 * Auth - Password Router
 *
 * Endpoints for password management
 */

import { Router } from 'express';
import type { RequestHandler } from 'express';
import { userRepository, systemSettingRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError, UnauthorizedError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../utils/password';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { revokeAllUserTokens } from '../../services/tokenRevocation';
import { getErrorMessage } from '../../utils/errors';

const router = Router();
const log = createLogger('AUTH_PASSWORD:ROUTE');

/**
 * Check if user is still using the initial generated password
 * by comparing against the marker stored during first setup
 */
export async function isUsingInitialPassword(userId: string): Promise<boolean> {
  try {
    // Check if the user's password matches the initial generated password hash
    // stored in system settings during first setup
    const initialPasswordSetting = await systemSettingRepository.get(`initialPassword_${userId}`);

    if (!initialPasswordSetting) {
      // No initial password marker - user was created after initial setup
      // or marker was cleared after password change
      return false;
    }

    // The setting stores the hash of the initial password
    // If the current password matches, user hasn't changed it
    const user = await userRepository.findById(userId);

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
    await systemSettingRepository.delete(`initialPassword_${userId}`);
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
  router.post('/me/change-password', passwordChangeLimiter, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      throw new InvalidInputError('Current password and new password are required');
    }

    // Validate new password strength (same requirements as registration)
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw new InvalidInputError('Password does not meet requirements');
    }

    // Get user
    const user = await userRepository.findById(req.user!.userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password);

    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await userRepository.updatePassword(user.id, hashedPassword);

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
  }));

  return router;
}

export default router;
