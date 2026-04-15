/**
 * Email Verification Routes
 *
 * Handles email verification, resend, and email updates.
 */

import { Router, Response } from 'express';
import type { RequestHandler } from 'express';
import { verifyEmail, resendVerification, createVerificationToken } from '../../services/email';
import { userRepository } from '../../repositories';
import { verifyPassword } from '../../utils/password';
import { VerifyEmailSchema, UpdateEmailSchema } from '../schemas/email';
import { createLogger } from '../../utils/logger';
import { authenticate, requireAuthenticatedUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError, ValidationError, UnauthorizedError, ConflictError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';

const log = createLogger('AUTH_EMAIL:ROUTE');

/**
 * Create email verification router with rate limiters
 */
export function createEmailRouter(
  verifyLimiter: RequestHandler,
  resendLimiter: RequestHandler,
  updateLimiter: RequestHandler
): Router {
  const router = Router();

  /**
   * POST /api/v1/auth/email/verify
   *
   * Verify email address using token from email link.
   * Public endpoint (no auth required).
   */
  router.post('/email/verify', verifyLimiter, validate({ body: VerifyEmailSchema }, { message: 'Invalid request' }), asyncHandler(async (req, res: Response) => {
    const { token } = req.body;
    const result = await verifyEmail(token);

    if (!result.success) {
      // Map error codes to user-friendly messages
      const errorMessages: Record<string, string> = {
        INVALID_TOKEN: 'Invalid or expired verification link',
        EXPIRED_TOKEN: 'This verification link has expired. Please request a new one.',
        ALREADY_USED: 'This email has already been verified',
        USER_NOT_FOUND: 'User account not found',
        UNKNOWN_ERROR: 'An error occurred during verification',
      };

      log.warn('Email verification failed', { error: result.error });

      // Audit failed verification
      const { ipAddress, userAgent } = getClientInfo(req);
      await auditService.log({
        userId: result.userId,
        username: 'unknown',
        action: AuditAction.AUTH_EMAIL_VERIFICATION_FAILED,
        category: AuditCategory.AUTH,
        success: false,
        errorMsg: result.error,
        details: { error: result.error },
        ipAddress,
        userAgent,
      });

      throw new ValidationError(
        errorMessages[result.error || 'UNKNOWN_ERROR'],
        undefined,
        { code: result.error }
      );
    }

    // Audit successful verification
    const user = await userRepository.findById(result.userId!);
    const clientInfo = getClientInfo(req);
    await auditService.log({
      userId: result.userId!,
      username: user?.username || 'unknown',
      action: AuditAction.AUTH_EMAIL_VERIFIED,
      category: AuditCategory.AUTH,
      success: true,
      details: { email: result.email },
      ipAddress: clientInfo.ipAddress,
      userAgent: clientInfo.userAgent,
    });

    log.info('Email verified successfully', { userId: result.userId, email: result.email });

    return res.json({
      success: true,
      message: 'Email verified successfully',
      email: result.email,
    });
  }));

  /**
   * POST /api/v1/auth/email/resend
   *
   * Resend verification email to authenticated user.
   * Requires authentication.
   */
  router.post(
    '/email/resend',
    authenticate,
    resendLimiter,
    asyncHandler(async (req, res) => {
      const userId = requireAuthenticatedUser(req).userId;

      // Get user to retrieve email
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const result = await resendVerification(userId);

      if (!result.success) {
        log.warn('Resend verification failed', { userId, error: result.error });
        throw new ValidationError(result.error || 'Failed to resend verification email');
      }

      // Audit email sent
      const { ipAddress, userAgent } = getClientInfo(req);
      await auditService.log({
        userId,
        username: requireAuthenticatedUser(req).username,
        action: AuditAction.AUTH_EMAIL_VERIFICATION_SENT,
        category: AuditCategory.AUTH,
        success: true,
        details: { email: user.email },
        ipAddress,
        userAgent,
      });

      log.info('Verification email resent', { userId });

      return res.json({
        success: true,
        message: 'Verification email sent',
        expiresAt: result.expiresAt,
      });
    })
  );

  /**
   * PUT /api/v1/auth/me/email
   *
   * Update email address. Requires password confirmation.
   * New email will need to be verified.
   */
  router.put(
    '/me/email',
    authenticate,
    updateLimiter,
    validate({ body: UpdateEmailSchema }, { message: 'Invalid request' }),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body;
      const userId = requireAuthenticatedUser(req).userId;

      // Get full user record to verify password
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }

      // Verify password
      const passwordValid = await verifyPassword(password, user.password);
      if (!passwordValid) {
        throw new UnauthorizedError('Invalid password');
      }

      // Check if email is already in use
      if (email.toLowerCase() !== user.email?.toLowerCase()) {
        const emailExists = await userRepository.emailExists(email);
        if (emailExists) {
          throw new ConflictError('This email address is already in use');
        }
      }

      // Update email (this resets verification status)
      const updatedUser = await userRepository.updateEmail(userId, email.toLowerCase());

      // Audit email update
      const { ipAddress, userAgent } = getClientInfo(req);
      await auditService.log({
        userId,
        username: user.username,
        action: AuditAction.USER_EMAIL_UPDATED,
        category: AuditCategory.USER,
        success: true,
        details: {
          oldEmail: user.email,
          newEmail: email.toLowerCase(),
        },
        ipAddress,
        userAgent,
      });

      // Send verification email to new address
      const verificationResult = await createVerificationToken(userId, email.toLowerCase(), user.username);

      log.info('Email updated', {
        userId,
        oldEmail: user.email,
        newEmail: email.toLowerCase(),
        verificationSent: verificationResult.success,
      });

      return res.json({
        success: true,
        message: 'Email updated. Please check your inbox for verification.',
        email: updatedUser.email,
        emailVerified: updatedUser.emailVerified,
        verificationSent: verificationResult.success,
      });
    })
  );

  return router;
}

export default createEmailRouter;
