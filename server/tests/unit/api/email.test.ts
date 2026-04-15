/**
 * Email Verification API Tests
 *
 * Tests for email verification endpoints.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { faker } from '@faker-js/faker';

// Hoist mocks
const {
  mockEmailVerificationService,
  mockUserRepository,
  mockAuditService,
} = vi.hoisted(() => {
  const mockEmailVerificationService = {
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
    createVerificationToken: vi.fn(),
    isVerificationRequired: vi.fn(),
    isSmtpConfigured: vi.fn(),
  };

  const mockUserRepository = {
    findById: vi.fn(),
    updateEmail: vi.fn(),
    emailExists: vi.fn(),
  };

  const mockAuditService = {
    auditService: {
      log: vi.fn().mockResolvedValue(undefined),
      logFromRequest: vi.fn().mockResolvedValue(undefined),
    },
    AuditAction: {
      AUTH_EMAIL_VERIFICATION_SENT: 'auth.email_verification_sent',
      AUTH_EMAIL_VERIFIED: 'auth.email_verified',
      AUTH_EMAIL_VERIFICATION_FAILED: 'auth.email_verification_failed',
      USER_EMAIL_UPDATED: 'user.email_updated',
    },
    AuditCategory: {
      AUTH: 'auth',
      USER: 'user',
    },
    getClientInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test-agent' }),
  };

  return {
    mockEmailVerificationService,
    mockUserRepository,
    mockAuditService,
  };
});

// Mock dependencies BEFORE importing
vi.mock('../../../src/services/email', () => mockEmailVerificationService);

vi.mock('../../../src/repositories', () => ({
  userRepository: mockUserRepository,
}));

vi.mock('../../../src/services/auditService', () => mockAuditService);

vi.mock('../../../src/utils/password', () => ({
  verifyPassword: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: vi.fn((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Simulate authenticated user
    req.user = {
      userId: 'test-user-id',
      username: 'testuser',
      isAdmin: false,
    };
    next();
  }),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : 'Unknown error',
}));

// Import after mocks
import { verifyPassword } from '../../../src/utils/password';
import { createEmailRouter } from '../../../src/api/auth/email';
import { errorHandler } from '../../../src/errors/errorHandler';

// Create test app with rate limiters
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Create mock rate limiters that do nothing
  const noopLimiter = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();

  // Mount the email router
  const emailRouter = createEmailRouter(
    noopLimiter as any, // verifyLimiter
    noopLimiter as any, // resendLimiter
    noopLimiter as any  // updateLimiter
  );
  app.use('/api/v1/auth', emailRouter);
  app.use(errorHandler);

  return app;
}

describe('Email Verification API', () => {
  // Use fixed values that match the mock middleware
  const testUserId = 'test-user-id';
  const testEmail = 'testuser@example.com';
  const testUsername = 'testuser';

  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /api/v1/auth/email/verify', () => {
    it('should verify email with valid token', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: true,
        userId: testUserId,
        email: testEmail,
      });
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        username: testUsername,
      });

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'valid-token-123' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Email verified successfully',
        email: testEmail,
      });
    });

    it('should reject missing token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject empty token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: '' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should handle INVALID_TOKEN error', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: false,
        error: 'INVALID_TOKEN',
      });

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'invalid-token' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.code).toBe('INVALID_TOKEN');
    });

    it('should handle EXPIRED_TOKEN error', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: false,
        error: 'EXPIRED_TOKEN',
      });

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'expired-token' });

      expect(response.status).toBe(400);
      expect(response.body.details.code).toBe('EXPIRED_TOKEN');
      expect(response.body.message).toContain('expired');
    });

    it('should handle ALREADY_USED error', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: false,
        error: 'ALREADY_USED',
      });

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'used-token' });

      expect(response.status).toBe(400);
      expect(response.body.details.code).toBe('ALREADY_USED');
    });

    it('should handle USER_NOT_FOUND error', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: false,
        error: 'USER_NOT_FOUND',
      });

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'orphan-token' });

      expect(response.status).toBe(400);
      expect(response.body.details.code).toBe('USER_NOT_FOUND');
    });

    it('should create audit log on success', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: true,
        userId: testUserId,
        email: testEmail,
      });
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        username: testUsername,
      });

      await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'valid-token' });

      expect(mockAuditService.auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: mockAuditService.AuditAction.AUTH_EMAIL_VERIFIED,
          success: true,
        })
      );
    });

    it('should create audit log on failure', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: false,
        error: 'INVALID_TOKEN',
      });

      await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'invalid-token' });

      expect(mockAuditService.auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: mockAuditService.AuditAction.AUTH_EMAIL_VERIFICATION_FAILED,
          success: false,
        })
      );
    });

    it('should use unknown error fallback when verification fails without a code', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'unknown-error-token' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('An error occurred during verification');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should audit success with username=unknown when user lookup fails', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({
        success: true,
        userId: testUserId,
        email: testEmail,
      });
      mockUserRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'valid-token' });

      expect(response.status).toBe(200);
      expect(mockAuditService.auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          username: 'unknown',
          action: mockAuditService.AuditAction.AUTH_EMAIL_VERIFIED,
        })
      );
    });

    it('should return 500 when verifyEmail throws unexpectedly', async () => {
      mockEmailVerificationService.verifyEmail.mockRejectedValue(new Error('Service failure'));

      const response = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ token: 'throws' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /api/v1/auth/email/resend', () => {
    it('should resend verification for unverified user', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        username: testUsername,
        email: testEmail,
        emailVerified: false,
      });
      mockEmailVerificationService.resendVerification.mockResolvedValue({
        success: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const response = await request(app)
        .post('/api/v1/auth/email/resend')
        .send();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Verification email sent');
    });

    it('should reject if already verified', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        email: testEmail,
        emailVerified: true,
      });
      mockEmailVerificationService.resendVerification.mockResolvedValue({
        success: false,
        error: 'Email already verified',
      });

      const response = await request(app)
        .post('/api/v1/auth/email/resend')
        .send();

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject if no email set', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        email: null,
      });
      mockEmailVerificationService.resendVerification.mockResolvedValue({
        success: false,
        error: 'No email address set',
      });

      const response = await request(app)
        .post('/api/v1/auth/email/resend')
        .send();

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('No email address set');
    });

    it('should return expiresAt on success', async () => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        username: testUsername,
        email: testEmail,
      });
      mockEmailVerificationService.resendVerification.mockResolvedValue({
        success: true,
        expiresAt,
      });

      const response = await request(app)
        .post('/api/v1/auth/email/resend')
        .send();

      expect(response.status).toBe(200);
      expect(response.body.expiresAt).toBeDefined();
    });

    it('should return 404 when authenticated user cannot be loaded', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/email/resend')
        .send();

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
      expect(response.body.message).toBe('User not found');
    });

    it('should use default resend failure message when service omits an error', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        username: testUsername,
        email: testEmail,
      });
      mockEmailVerificationService.resendVerification.mockResolvedValue({
        success: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/email/resend')
        .send();

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Failed to resend verification email');
    });

    it('should return 500 when resend verification throws unexpectedly', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        username: testUsername,
        email: testEmail,
      });
      mockEmailVerificationService.resendVerification.mockRejectedValue(new Error('SMTP down'));

      const response = await request(app)
        .post('/api/v1/auth/email/resend')
        .send();

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PUT /api/v1/auth/me/email', () => {
    const newEmail = 'newemail@example.com';
    const currentPassword = 'CurrentPassword123!';

    beforeEach(() => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        username: testUsername,
        email: testEmail,
        password: 'hashed-password',
      });
    });

    it('should update email with valid password', async () => {
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.emailExists.mockResolvedValue(false);
      mockUserRepository.updateEmail.mockResolvedValue({
        id: testUserId,
        email: newEmail,
        emailVerified: false,
      });
      mockEmailVerificationService.createVerificationToken.mockResolvedValue({
        success: true,
      });

      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail, password: currentPassword });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.email).toBe(newEmail);
      expect(response.body.emailVerified).toBe(false);
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: 'invalid-email', password: currentPassword });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject missing password', async () => {
      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid password', async () => {
      (verifyPassword as any).mockResolvedValue(false);

      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail, password: 'wrongpassword' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(response.body.message).toBe('Invalid password');
    });

    it('should reject duplicate email', async () => {
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.emailExists.mockResolvedValue(true);

      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail, password: currentPassword });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
      expect(response.body.message).toContain('already in use');
    });

    it('should send verification email to new address', async () => {
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.emailExists.mockResolvedValue(false);
      mockUserRepository.updateEmail.mockResolvedValue({
        id: testUserId,
        email: newEmail,
        emailVerified: false,
      });
      mockEmailVerificationService.createVerificationToken.mockResolvedValue({
        success: true,
      });

      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail, password: currentPassword });

      expect(response.status).toBe(200);
      expect(response.body.verificationSent).toBe(true);
      expect(mockEmailVerificationService.createVerificationToken).toHaveBeenCalledWith(
        testUserId,
        newEmail.toLowerCase(),
        testUsername
      );
    });

    it('should create audit log for email update', async () => {
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.emailExists.mockResolvedValue(false);
      mockUserRepository.updateEmail.mockResolvedValue({
        id: testUserId,
        email: newEmail,
        emailVerified: false,
      });
      mockEmailVerificationService.createVerificationToken.mockResolvedValue({
        success: true,
      });

      await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail, password: currentPassword });

      expect(mockAuditService.auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: mockAuditService.AuditAction.USER_EMAIL_UPDATED,
          success: true,
        })
      );
    });

    it('should return 404 if user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail, password: currentPassword });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should skip duplicate check when new email only changes case', async () => {
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.updateEmail.mockResolvedValue({
        id: testUserId,
        email: testEmail,
        emailVerified: false,
      });
      mockEmailVerificationService.createVerificationToken.mockResolvedValue({
        success: true,
      });

      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: testEmail.toUpperCase(), password: currentPassword });

      expect(response.status).toBe(200);
      expect(mockUserRepository.emailExists).not.toHaveBeenCalled();
      expect(mockUserRepository.updateEmail).toHaveBeenCalledWith(testUserId, testEmail);
    });

    it('should return 500 when updating email throws unexpectedly', async () => {
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.emailExists.mockResolvedValue(false);
      mockUserRepository.updateEmail.mockRejectedValue(new Error('Database failure'));

      const response = await request(app)
        .put('/api/v1/auth/me/email')
        .send({ email: newEmail, password: currentPassword });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
