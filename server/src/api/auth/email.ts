/**
 * Email Verification Routes
 *
 * Handles email verification, resend, and email updates.
 */

import { randomBytes } from 'node:crypto';
import { Router, Response } from 'express';
import type { Request, RequestHandler } from 'express';
import {
  verifyEmail,
  resendVerification,
  updateEmailWithVerification,
  isVerificationRequired,
  assertEmailChangeDeliverable,
} from '../../services/email';
import { userRepository } from '../../repositories';
import type { User } from '../../generated/prisma/client';
import { rateLimitService } from '../../services/rateLimiting';
import { normalizeEmail } from '../../utils/email';
import { normalizeUsername } from '../../utils/username';
import { hashPassword, verifyPassword } from '../../utils/password';
import { VerifyEmailSchema, UpdateEmailSchema, ResendPendingVerificationSchema } from '../schemas/email';
import { createLogger } from '../../utils/logger';
import { authenticate, requireAuthenticatedUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError, ValidationError, StepUpCredentialInvalidError, ConflictError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import { getErrorMessage, isUniqueConstraintError } from '../../utils/errors';

const log = createLogger('AUTH_EMAIL:ROUTE');

/** Limiters for the credentialed pre-auth resend route. */
export interface ResendPendingLimiters {
  /** Same ip+username bucket as POST /auth/login. */
  login: RequestHandler;
  resendPending: RequestHandler;
}

// Compared against when the user does not exist, so the response time does not
// reveal whether the account does. Hashed at runtime (same cost as real
// passwords, no committed hash) and only once per process.
let dummyPasswordHash: Promise<string> | undefined;
const getDummyPasswordHash = (): Promise<string> =>
  (dummyPasswordHash ??= hashPassword(randomBytes(16).toString('hex')).catch((error: unknown) => {
    dummyPasswordHash = undefined; // retry next time rather than failing forever
    throw error;
  }));

// Identical for every outcome: no account or password oracle.
const RESEND_PENDING_RESPONSE = {
  success: true,
  message: 'If the account needs verification, a new email has been sent.',
};

/**
 * Consume the same per-user bucket the authenticated resend uses. Never
 * signals the caller: exhaustion or limiter failure only suppresses the send,
 * because a 429/500 here would appear only for a correct password.
 */
async function consumeResendBucket(userId: string): Promise<boolean> {
  try {
    const result = await rateLimitService.consume('auth:email-resend', `user:${userId}`);
    return result.allowed;
  } catch (error) {
    log.warn('Pre-auth resend skipped: rate limiter unavailable', { userId, error: getErrorMessage(error) });
    return false;
  }
}

/** Send a fresh link to a credential-verified user, when one is actually owed. */
async function sendPendingVerification(req: Request, user: User): Promise<void> {
  if (!user.email || user.emailVerified || !(await isVerificationRequired())) return;
  if (!(await consumeResendBucket(user.id))) return;

  const result = await resendVerification(user.id);
  if (!result.success) {
    log.warn('Pre-auth resend failed', { userId: user.id, error: result.error });
    return;
  }

  const { ipAddress, userAgent } = getClientInfo(req);
  await auditService.log({
    userId: user.id,
    username: user.username,
    action: AuditAction.AUTH_EMAIL_VERIFICATION_SENT,
    category: AuditCategory.AUTH,
    success: true,
    details: { email: user.email, preAuth: true },
    ipAddress,
    userAgent,
  });
}

/**
 * Create email verification router with rate limiters
 */
export function createEmailRouter(
  verifyLimiter: RequestHandler,
  resendLimiter: RequestHandler,
  updateLimiter: RequestHandler,
  pendingLimiters: ResendPendingLimiters
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
   * POST /api/v1/auth/email/resend-pending
   *
   * Resend the verification email using username and password, for users who
   * cannot log in yet because their email is unverified. Public, always 202.
   */
  router.post(
    '/email/resend-pending',
    pendingLimiters.login,
    pendingLimiters.resendPending,
    validate({ body: ResendPendingVerificationSchema }, { message: 'Invalid request' }),
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      const user = await userRepository.findByUsername(normalizeUsername(username));
      const passwordValid = await verifyPassword(password, user?.password ?? await getDummyPasswordHash());

      res.status(202).json(RESEND_PENDING_RESPONSE);

      // Send after responding: awaiting it would make latency (or a 500) reveal
      // that the password was correct.
      if (user && passwordValid) {
        void sendPendingVerification(req, user).catch((error) => {
          log.warn('Pre-auth resend failed', { userId: user.id, error: getErrorMessage(error) });
        });
      }
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
        throw new StepUpCredentialInvalidError('Invalid password');
      }

      const normalizedEmail = normalizeEmail(email);
      const currentEmail = user.email ? normalizeEmail(user.email) : null;

      // Re-saving the current address of a verified user changes nothing; writing
      // would reset emailVerified and lock the user out where verification is required.
      if (normalizedEmail === currentEmail && user.emailVerified) {
        return res.json({
          success: true,
          message: 'Email address unchanged.',
          email: user.email,
          emailVerified: true,
          verificationSent: false,
        });
      }

      // Check if email is already in use
      if (normalizedEmail !== currentEmail) {
        const emailExists = await userRepository.emailExists(normalizedEmail);
        if (emailExists) {
          throw new ConflictError('This email address is already in use');
        }
      }

      // Refuse before writing anything if the new address could never be verified.
      await assertEmailChangeDeliverable();

      let updateResult: Awaited<ReturnType<typeof updateEmailWithVerification>>;
      try {
        updateResult = await updateEmailWithVerification(userId, normalizedEmail, user.username);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new ConflictError('This email address is already in use');
        }
        throw error;
      }
      const verificationResult = updateResult.verification;

      const { ipAddress, userAgent } = getClientInfo(req);
      await auditService.log({
        userId,
        username: user.username,
        action: AuditAction.USER_EMAIL_UPDATED,
        category: AuditCategory.USER,
        success: true,
        details: {
          oldEmail: user.email,
          newEmail: normalizedEmail,
        },
        ipAddress,
        userAgent,
      });

      log.info('Email updated', {
        userId,
        oldEmail: user.email,
        newEmail: normalizedEmail,
        verificationSent: verificationResult.success,
      });

      return res.json({
        success: true,
        message: 'Email updated. Please check your inbox for verification.',
        email: updateResult.user.email,
        emailVerified: updateResult.user.emailVerified,
        verificationSent: verificationResult.success,
      });
    })
  );

  return router;
}

export default createEmailRouter;
