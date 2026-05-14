/**
 * Auth - Login Router
 *
 * Public authentication endpoints (registration, login)
 */

import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { userRepository, systemSettingRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { normalizeEmail } from '../../utils/email';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../utils/password';
import { generate2FAToken } from '../../utils/jwt';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import { SystemSettingSchemas } from '../../utils/safeJson';
import { isUsingInitialPassword } from './password';
import { isValidEmail } from '../../utils/validators';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, ValidationError, ConflictError, ForbiddenError, ErrorCodes } from '../../errors/ApiError';
import { LoginSchema } from '../schemas/auth';
import { UsernameSchema } from '../schemas/common';
import { normalizeUsername } from '../../utils/username';
import {
  isVerificationRequired,
  createVerificationToken,
  isSmtpConfigured,
} from '../../services/email';
import { prepareAuthSession, sendAuthSessionResponse } from './sessionResponse';

const router = Router();
const log = createLogger('AUTH_LOGIN:ROUTE');

const RegisterPresenceSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  email: z.string().min(1),
});

/**
 * Validate public-registration usernames and return the canonical stored value.
 */
function parseCanonicalUsername(username: string): string {
  const parsed = UsernameSchema.safeParse(username);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.issues.map((issue) => issue.message).join(', '));
  }
  return parsed.data;
}

/**
 * Create the login router with rate limiters
 * Rate limiters are passed from the parent auth.ts to centralize configuration
 */
export function createLoginRouter(
  loginLimiter: RequestHandler,
  registerLimiter: RequestHandler
): Router {
  /**
   * GET /api/v1/auth/registration-status
   * Check if public registration is enabled (public endpoint for login page)
   */
  router.get('/registration-status', asyncHandler(async (_req, res) => {
    const enabled = await systemSettingRepository.getParsed('registrationEnabled', SystemSettingSchemas.boolean, false);

    res.json({ enabled });
  }));

  /**
   * POST /api/v1/auth/register
   * Register a new user
   */
  router.post('/register', registerLimiter, validate(
    { body: RegisterPresenceSchema },
    { message: 'Username, password, and email are required', code: ErrorCodes.INVALID_INPUT }
  ), asyncHandler(async (req, res) => {
    // Check if registration is enabled (default: disabled / admin-only)
    const registrationEnabled = await systemSettingRepository.getParsed('registrationEnabled', SystemSettingSchemas.boolean, false);

    if (!registrationEnabled) {
      throw new ForbiddenError('Public registration is disabled. Please contact an administrator.');
    }

    const { password, email } = req.body;
    const username = parseCanonicalUsername(req.body.username);

    // Validation - email is required for open registration
    /* v8 ignore next -- registration route tests cover field-specific missing input validation */
    if (!username || !password || !email) {
      throw new InvalidInputError('Username, password, and email are required');
    }

    // Validate email format
    if (!isValidEmail(email)) {
      throw new InvalidInputError('Invalid email address format');
    }
    const canonicalEmail = normalizeEmail(email);

    // SEC-009: Enforce password strength at registration
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      throw new ValidationError('Password does not meet strength requirements', undefined, {
        errors: passwordValidation.errors as unknown as Record<string, unknown>,
      });
    }

    // Check if user exists
    const existingUser = await userRepository.findByUsername(username);

    if (existingUser) {
      throw new ConflictError('Username already exists');
    }

    // Check if email is already in use
    const existingEmail = await userRepository.findByEmail(canonicalEmail);

    if (existingEmail) {
      throw new ConflictError('Email address is already in use');
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user with default preferences
    const user = await userRepository.create({
      username,
      password: hashedPassword,
      email: canonicalEmail,
      emailVerified: false,
      preferences: {
        darkMode: true,
        theme: 'sanctuary',
        background: 'zen',
        unit: 'sats',
        fiatCurrency: 'USD',
        showFiat: true,
        priceProvider: 'auto',
        notificationSounds: {
          enabled: true,
          volume: 50,
          confirmation: { enabled: true, sound: 'chime' },
          receive: { enabled: true, sound: 'coin' },
          send: { enabled: true, sound: 'success' },
        },
      },
    });

    // Send verification email if SMTP is configured
    let emailVerificationRequired = false;
    let verificationEmailSent = false;

    const verificationRequired = await isVerificationRequired();
    const smtpConfigured = await isSmtpConfigured();

    if (smtpConfigured) {
      const verificationResult = await createVerificationToken(
        user.id,
        canonicalEmail,
        username
      );
      verificationEmailSent = verificationResult.success;
      if (verificationResult.success) {
        log.info('Verification email sent for new registration', { userId: user.id, email: canonicalEmail });
      } else {
        log.warn('Failed to send verification email', { userId: user.id, error: verificationResult.error });
      }
    } else {
      log.warn('SMTP not configured, skipping verification email', { userId: user.id });
    }

    // Email verification blocks authentication only while this user remains unverified.
    emailVerificationRequired = verificationRequired && !user.emailVerified;

    if (emailVerificationRequired && !user.emailVerified) {
      return res.status(201).json({
        emailVerificationRequired: true,
        verificationEmailSent,
        email: user.email,
        message: verificationEmailSent
          ? 'Registration successful. Please check your email to verify your account.'
          : 'Registration successful. Email verification is required, but the verification email could not be sent. Please contact an administrator.',
      });
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const authSession = await prepareAuthSession(user, {
      clientInfo: { ipAddress, userAgent },
      usingDefaultPassword: false,
    });

    // ADR 0001 / 0002 — Phase 6: browser auth is cookie-only. Access and
    // refresh tokens are set via HttpOnly cookies; the JSON body no longer
    // carries the token/refreshToken fields. The `expiresIn` hint and the
    // X-Access-Expires-At header (via setAuthCookies) let the client
    // schedule proactive refresh without reading tokens from the body.
    // Required-and-unverified registrations returned above as pending. Any response
    // that reaches this point is authenticated, so no verification block remains.
    sendAuthSessionResponse(req, res, authSession, {
      status: 201,
      body: {
        emailVerificationRequired: false,
        verificationEmailSent,
        message: 'Registration successful.',
      },
    });
  }));

  /**
   * POST /api/v1/auth/login
   * Login existing user
   */
  router.post('/login', loginLimiter, validate({ body: LoginSchema }, { message: 'Username and password are required' }), asyncHandler(async (req, res) => {
    const { password } = req.body;
    const username = normalizeUsername(req.body.username);

    // Find user
    const user = await userRepository.findByUsername(username);

    if (!user) {
      // Audit failed login (user not found)
      const { ipAddress, userAgent } = getClientInfo(req);
      await auditService.log({
        username,
        action: AuditAction.LOGIN_FAILED,
        category: AuditCategory.AUTH,
        ipAddress,
        userAgent,
        success: false,
        errorMsg: 'User not found',
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {
      // Audit failed login (wrong password)
      const { ipAddress, userAgent } = getClientInfo(req);
      await auditService.log({
        userId: user.id,
        username: user.username,
        action: AuditAction.LOGIN_FAILED,
        category: AuditCategory.AUTH,
        ipAddress,
        userAgent,
        success: false,
        errorMsg: 'Invalid password',
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    // Check email verification status if required
    const verificationRequired = await isVerificationRequired();
    if (verificationRequired && user.email && !user.emailVerified) {
      // User has email but hasn't verified - block login
      log.info('Login blocked - email not verified', { userId: user.id, email: user.email });

      return res.status(403).json({
        error: 'Email Not Verified',
        message: 'Please verify your email address before logging in.',
        emailVerificationRequired: true,
        email: user.email,
        canResend: true,
      });
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      // Check if using initial password before creating temp token
      const usingDefaultPassword = await isUsingInitialPassword(user.id);

      // SEC-006: Generate a 2FA temp token with distinct audience claim
      const tempToken = generate2FAToken({
        userId: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        sessionVersion: user.sessionVersion,
        usingDefaultPassword, // Pass through for after 2FA verification
      });

      return res.json({
        requires2FA: true,
        tempToken,
      });
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const usingDefaultPassword = await isUsingInitialPassword(user.id);
    const authSession = await prepareAuthSession(user, {
      clientInfo: { ipAddress, userAgent },
      usingDefaultPassword,
    });

    // Audit successful login
    await auditService.log({
      userId: user.id,
      username: user.username,
      action: AuditAction.LOGIN,
      category: AuditCategory.AUTH,
      ipAddress,
      userAgent,
      success: true,
    });

    // ADR 0001 / 0002 — Phase 6: browser auth is cookie-only. See register
    // handler above for the rationale.
    sendAuthSessionResponse(req, res, authSession);
  }));

  return router;
}

export default router;
