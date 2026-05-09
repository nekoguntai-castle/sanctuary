/**
 * Auth API Routes
 *
 * Authentication, authorization, and user management endpoints
 *
 * Route domains extracted to ./auth/ subdirectory:
 * - login.ts      - Registration status, register, login (public)
 * - profile.ts    - User profile and preferences
 * - password.ts   - Password change
 * - twoFactor.ts  - 2FA setup, verification, backup codes
 * - telegram.ts   - Telegram notification integration
 * - tokens.ts     - Token refresh, logout
 * - sessions.ts   - Session management
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { rateLimit, rateLimitByIpAndKey, rateLimitByUser } from '../middleware/rateLimit';

// Domain routers
import { createLoginRouter } from './auth/login';
import profileRouter from './auth/profile';
import { createPasswordRouter } from './auth/password';
import { createTwoFactorRouter } from './auth/twoFactor';
import { createEmailRouter } from './auth/email';
import telegramRouter from './auth/telegram';
import tokensRouter from './auth/tokens';
import sessionsRouter from './auth/sessions';

const router = Router();

// ========================================
// RATE LIMITERS (centralized policies)
// ========================================

const loginLimiter = rateLimitByIpAndKey(
  'auth:login',
  (req) => req.body?.username?.toLowerCase()
);
const registerLimiter = rateLimit('auth:register');
const twoFactorLimiter = rateLimit('auth:2fa');
const passwordChangeLimiter = rateLimitByUser('auth:password-change');
const emailVerifyLimiter = rateLimit('auth:email-verify');
const emailResendLimiter = rateLimitByUser('auth:email-resend');
const emailUpdateLimiter = rateLimitByUser('auth:email-update');

// ========================================
// ROUTE CONFIGURATION
// ========================================

// Public routes (no auth required)
// Login router handles: /registration-status, /register, /login
router.use('/', createLoginRouter(loginLimiter, registerLimiter));

// Token management (partially public - /refresh doesn't need auth, but logout* do)
router.use('/', tokensRouter);

// 2FA routes - mixed auth requirements:
// - /2fa/verify uses temp token (rate-limited, no auth middleware)
// - Other 2FA routes require authentication
router.use('/', createTwoFactorRouter(twoFactorLimiter));

// Email verification routes - mixed auth requirements:
// - /email/verify is public (uses token from email)
// - /email/resend requires authentication
// - /me/email requires authentication
router.use('/', createEmailRouter(emailVerifyLimiter, emailResendLimiter, emailUpdateLimiter));

// Protected routes (require authentication)
router.use('/', authenticate, profileRouter);
router.use('/', authenticate, createPasswordRouter(passwordChangeLimiter));
router.use('/', authenticate, telegramRouter);
router.use('/', authenticate, sessionsRouter);

export default router;
