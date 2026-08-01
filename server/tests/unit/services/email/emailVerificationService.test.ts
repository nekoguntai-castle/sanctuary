/**
 * Email Verification Service Tests
 *
 * Tests for email verification token generation, validation, and management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

// Hoist mocks
const {
  mockEmailVerificationRepository,
  mockUserRepository,
  mockSystemSettingRepository,
  mockEmailService,
  mockConfig,
} = vi.hoisted(() => {
  const mockEmailVerificationRepository = {
    create: vi.fn(),
    consumeForCurrentEmail: vi.fn(),
    replaceUnusedAndCreate: vi.fn(),
    replaceUnusedForEmailUpdate: vi.fn(),
    findByTokenHash: vi.fn(),
    findPendingByUserId: vi.fn(),
    markUsed: vi.fn(),
    deleteExpired: vi.fn(),
    deleteUnusedByUserId: vi.fn(),
    countCreatedSince: vi.fn(),
  };

  const mockUserRepository = {
    findById: vi.fn(),
    updateEmailVerification: vi.fn(),
    updateEmail: vi.fn(),
  };

  const mockSystemSettingRepository = {
    getValue: vi.fn(),
    getNumber: vi.fn(),
    getBoolean: vi.fn(),
  };

  const mockEmailService = {
    sendEmail: vi.fn(),
    isSmtpConfigured: vi.fn(),
  };

  const mockConfig = {
    server: {
      clientUrl: 'http://localhost:3000',
      port: 3001,
    },
  };

  return {
    mockEmailVerificationRepository,
    mockUserRepository,
    mockSystemSettingRepository,
    mockEmailService,
    mockConfig,
  };
});

// Mock dependencies
vi.mock('../../../../src/repositories', () => ({
  emailVerificationRepository: mockEmailVerificationRepository,
  userRepository: mockUserRepository,
  systemSettingRepository: mockSystemSettingRepository,
  SystemSettingKeys: {
    EMAIL_VERIFICATION_REQUIRED: 'email.verificationRequired',
    EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS: 'email.tokenExpiryHours',
    SERVER_NAME: 'serverName',
  },
}));

vi.mock('../../../../src/services/email/emailService', () => mockEmailService);

vi.mock('../../../../src/config', () => ({
  default: mockConfig,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  createVerificationToken,
  updateEmailWithVerification,
  verifyEmail,
  resendVerification,
  isVerificationRequired,
  isEmailVerified,
  cleanupExpiredTokens,
} from '../../../../src/services/email/emailVerificationService';

describe('Email Verification Service', () => {
  const testUserId = faker.string.uuid();
  const testEmail = faker.internet.email().toLowerCase();
  const testUsername = faker.internet.username();
  const testTokenId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default settings
    mockSystemSettingRepository.getNumber.mockResolvedValue(24);
    mockSystemSettingRepository.getBoolean.mockResolvedValue(true);
    mockSystemSettingRepository.getValue.mockResolvedValue(null);
    mockEmailVerificationRepository.create.mockResolvedValue({
      id: testTokenId,
      userId: testUserId,
      email: testEmail,
      tokenHash: 'hashed-token',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      usedAt: null,
    });
    mockEmailVerificationRepository.replaceUnusedAndCreate.mockResolvedValue({
      token: {
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      },
    });
    mockEmailVerificationRepository.replaceUnusedForEmailUpdate.mockResolvedValue({
      token: {
        id: testTokenId,
        userId: testUserId,
        email: testEmail,
        tokenHash: 'hashed-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        usedAt: null,
      },
      user: {
        id: testUserId,
        username: testUsername,
        email: testEmail,
        emailVerified: false,
      },
    });
  });

  describe('createVerificationToken', () => {
    it('should fail when SMTP is not configured', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(false);

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result).toEqual({
        success: false,
        error: 'SMTP not configured',
      });
      expect(mockEmailVerificationRepository.replaceUnusedAndCreate).not.toHaveBeenCalled();
      expect(mockEmailVerificationRepository.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should preserve existing pending tokens when SMTP is not configured', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(false);

      await createVerificationToken(testUserId, testEmail, testUsername);

      expect(mockEmailVerificationRepository.replaceUnusedAndCreate).not.toHaveBeenCalled();
      expect(mockEmailVerificationRepository.deleteUnusedByUserId).not.toHaveBeenCalled();
    });

    it('should create token when SMTP is configured', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: true, messageId: 'msg-123' });

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result.success).toBe(true);
      expect(result.tokenId).toBe(testTokenId);
      expect(result.expiresAt).toBeDefined();
      expect(mockEmailVerificationRepository.replaceUnusedAndCreate).toHaveBeenCalled();
      expect(mockEmailVerificationRepository.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendEmail).toHaveBeenCalled();
    });

    it('should replace existing unused tokens before sending the email', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      await createVerificationToken(testUserId, testEmail, testUsername);

      expect(mockEmailVerificationRepository.replaceUnusedAndCreate).toHaveBeenCalledBefore(
        mockEmailService.sendEmail
      );
    });

    it('should use custom expiry hours from settings', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockSystemSettingRepository.getNumber.mockResolvedValue(48); // 48 hours
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result.success).toBe(true);
      // Verify the expiry time is ~48 hours from now
      const expiresAt = result.expiresAt!;
      const expectedExpiry = Date.now() + 48 * 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeCloseTo(expectedExpiry, -4); // Within 10 seconds
    });

    it('should handle email sending failure gracefully', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: false, error: 'SMTP error' });

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP error');
      expect(result.tokenId).toBe(testTokenId); // Token was created even if email failed
    });

    it('should fall back to localhost verification URL when client URL is not configured', async () => {
      const originalClientUrl = mockConfig.server.clientUrl;
      mockConfig.server.clientUrl = '';
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      await createVerificationToken(testUserId, testEmail, testUsername);

      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('http://localhost:3000/verify-email?token='),
        })
      );
      mockConfig.server.clientUrl = originalClientUrl;
    });

    it('should hash the token before storing', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      await createVerificationToken(testUserId, testEmail, testUsername);

      const createCall = mockEmailVerificationRepository.replaceUnusedAndCreate.mock.calls[0][0];
      // Token hash should be a 64-character hex string (SHA256)
      expect(createCall.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return service error when token creation flow throws', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.replaceUnusedAndCreate.mockRejectedValue(new Error('replace failed'));

      const result = await createVerificationToken(testUserId, testEmail, testUsername);

      expect(result).toEqual({
        success: false,
        error: 'replace failed',
      });
    });
  });

  describe('updateEmailWithVerification', () => {
    it('should invalidate old intents, update email, and truthfully report unsent mail when SMTP is disabled', async () => {
      const updatedUser = {
        id: testUserId,
        username: testUsername,
        email: testEmail,
        emailVerified: false,
      };
      mockEmailService.isSmtpConfigured.mockResolvedValue(false);
      mockEmailVerificationRepository.replaceUnusedForEmailUpdate.mockResolvedValue({
        token: {
          id: testTokenId,
          userId: testUserId,
          email: testEmail,
          tokenHash: 'hashed-token',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          usedAt: null,
        },
        user: updatedUser,
      });

      const result = await updateEmailWithVerification(testUserId, testEmail, testUsername);

      expect(result).toEqual({
        user: updatedUser,
        verification: {
          success: false,
          error: 'SMTP not configured',
        },
      });
      expect(mockEmailVerificationRepository.replaceUnusedForEmailUpdate).toHaveBeenCalledWith({
        userId: testUserId,
        email: testEmail,
        tokenHash: undefined,
        expiresAt: undefined,
      });
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should send the replacement verification email after the update transaction commits', async () => {
      const updatedUser = {
        id: testUserId,
        username: testUsername,
        email: testEmail,
        emailVerified: false,
      };
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: true });
      mockEmailVerificationRepository.replaceUnusedForEmailUpdate.mockResolvedValue({
        token: {
          id: testTokenId,
          userId: testUserId,
          email: testEmail,
          tokenHash: 'hashed-token',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          usedAt: null,
        },
        user: updatedUser,
      });

      const result = await updateEmailWithVerification(testUserId, testEmail, testUsername);

      expect(result.verification.success).toBe(true);
      expect(mockEmailVerificationRepository.replaceUnusedForEmailUpdate).toHaveBeenCalledBefore(
        mockEmailService.sendEmail,
      );
    });

    it('should report send failure after committing the email update intent', async () => {
      const updatedUser = {
        id: testUserId,
        username: testUsername,
        email: testEmail,
        emailVerified: false,
      };
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: false, error: 'SMTP timeout' });
      mockEmailVerificationRepository.replaceUnusedForEmailUpdate.mockResolvedValue({
        token: {
          id: testTokenId,
          userId: testUserId,
          email: testEmail,
          tokenHash: 'hashed-token',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          usedAt: null,
        },
        user: updatedUser,
      });

      const result = await updateEmailWithVerification(testUserId, testEmail, testUsername);

      expect(result).toEqual({
        user: updatedUser,
        verification: {
          success: false,
          tokenId: testTokenId,
          expiresAt: expect.any(Date),
          error: 'SMTP timeout',
        },
      });
    });

    it('should rethrow unexpected transaction failures', async () => {
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailVerificationRepository.replaceUnusedForEmailUpdate.mockRejectedValue(
        new Error('unique conflict')
      );

      await expect(
        updateEmailWithVerification(testUserId, testEmail, testUsername)
      ).rejects.toThrow('unique conflict');
    });
  });

  describe('verifyEmail', () => {
    it('should reject invalid token', async () => {
      mockEmailVerificationRepository.consumeForCurrentEmail.mockResolvedValue({
        success: false,
        error: 'INVALID_TOKEN',
      });

      const result = await verifyEmail('invalid-token');

      expect(result).toEqual({
        success: false,
        error: 'INVALID_TOKEN',
      });
    });

    it('should reject expired token', async () => {
      mockEmailVerificationRepository.consumeForCurrentEmail.mockResolvedValue({
        success: false,
        error: 'EXPIRED_TOKEN',
        userId: testUserId,
      });

      const result = await verifyEmail('some-token');

      expect(result).toEqual({
        success: false,
        userId: testUserId,
        error: 'EXPIRED_TOKEN',
      });
    });

    it('should reject already-used token', async () => {
      mockEmailVerificationRepository.consumeForCurrentEmail.mockResolvedValue({
        success: false,
        error: 'ALREADY_USED',
        userId: testUserId,
      });

      const result = await verifyEmail('some-token');

      expect(result).toEqual({
        success: false,
        userId: testUserId,
        error: 'ALREADY_USED',
      });
    });

    it('should reject when user not found', async () => {
      mockEmailVerificationRepository.consumeForCurrentEmail.mockResolvedValue({
        success: false,
        error: 'USER_NOT_FOUND',
        userId: testUserId,
      });

      const result = await verifyEmail('valid-token');

      expect(result).toEqual({
        success: false,
        userId: testUserId,
        error: 'USER_NOT_FOUND',
      });
    });

    it('should verify valid token and update user', async () => {
      mockEmailVerificationRepository.consumeForCurrentEmail.mockResolvedValue({
        success: true,
        userId: testUserId,
        email: testEmail,
      });

      const result = await verifyEmail('valid-token');

      expect(result).toEqual({
        success: true,
        userId: testUserId,
        email: testEmail,
      });
      expect(mockEmailVerificationRepository.consumeForCurrentEmail).toHaveBeenCalled();
      expect(mockEmailVerificationRepository.markUsed).not.toHaveBeenCalled();
      expect(mockUserRepository.updateEmailVerification).not.toHaveBeenCalled();
    });

    it('should reject stale email-change intents without overwriting the current email', async () => {
      mockEmailVerificationRepository.consumeForCurrentEmail.mockResolvedValue({
        success: false,
        error: 'EMAIL_MISMATCH',
        userId: testUserId,
      });

      const result = await verifyEmail('valid-token');

      expect(result).toEqual({
        success: false,
        userId: testUserId,
        error: 'INVALID_TOKEN',
      });
      expect(mockUserRepository.updateEmail).not.toHaveBeenCalled();
      expect(mockUserRepository.updateEmailVerification).not.toHaveBeenCalled();
    });

    it('should return UNKNOWN_ERROR when verification throws unexpectedly', async () => {
      mockEmailVerificationRepository.consumeForCurrentEmail.mockRejectedValue(new Error('db timeout'));

      const result = await verifyEmail('broken-token');

      expect(result).toEqual({
        success: false,
        error: 'UNKNOWN_ERROR',
      });
    });
  });

  describe('resendVerification', () => {
    const mockUser = {
      id: testUserId,
      username: testUsername,
      email: testEmail,
      emailVerified: false,
    };

    it('should reject if user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'User not found',
      });
    });

    it('should reject if no email set', async () => {
      mockUserRepository.findById.mockResolvedValue({ ...mockUser, email: null });

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'No email address set',
      });
    });

    it('should reject if already verified', async () => {
      mockUserRepository.findById.mockResolvedValue({ ...mockUser, emailVerified: true });

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'Email already verified',
      });
    });

    it('should enforce rate limit (max 5 per hour)', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockEmailVerificationRepository.countCreatedSince.mockResolvedValue(5);

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'Too many verification requests. Please try again later.',
      });
    });

    it('should allow resend when under rate limit', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockEmailVerificationRepository.countCreatedSince.mockResolvedValue(4);
      mockEmailService.isSmtpConfigured.mockResolvedValue(true);
      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      const result = await resendVerification(testUserId);

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeDefined();
      expect(mockEmailVerificationRepository.replaceUnusedAndCreate).toHaveBeenCalledWith({
        userId: testUserId,
        email: testEmail,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      });
    });

    it('should return service error message when resend flow throws', async () => {
      mockUserRepository.findById.mockRejectedValue(new Error('lookup failed'));

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'lookup failed',
      });
    });

    it('should not invalidate a pending verification link when SMTP is unavailable during resend', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        email: testEmail,
        emailVerified: false,
        username: testUsername,
      });
      mockEmailVerificationRepository.countCreatedSince.mockResolvedValue(1);
      mockEmailService.isSmtpConfigured.mockResolvedValue(false);

      const result = await resendVerification(testUserId);

      expect(result).toEqual({
        success: false,
        error: 'SMTP not configured',
      });
      expect(mockEmailVerificationRepository.replaceUnusedAndCreate).not.toHaveBeenCalled();
      expect(mockEmailVerificationRepository.deleteUnusedByUserId).not.toHaveBeenCalled();
    });
  });

  describe('isVerificationRequired', () => {
    it('should return true by default', async () => {
      mockSystemSettingRepository.getBoolean.mockResolvedValue(true);

      const result = await isVerificationRequired();

      expect(result).toBe(true);
    });

    it('should return false when disabled in settings', async () => {
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const result = await isVerificationRequired();

      expect(result).toBe(false);
    });
  });

  describe('isEmailVerified', () => {
    it('should return true for verified user', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        emailVerified: true,
      });

      const result = await isEmailVerified(testUserId);

      expect(result).toBe(true);
    });

    it('should return false for unverified user', async () => {
      mockUserRepository.findById.mockResolvedValue({
        id: testUserId,
        emailVerified: false,
      });

      const result = await isEmailVerified(testUserId);

      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const result = await isEmailVerified(testUserId);

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens and return count', async () => {
      mockEmailVerificationRepository.deleteExpired.mockResolvedValue(5);

      const result = await cleanupExpiredTokens();

      expect(result).toBe(5);
      expect(mockEmailVerificationRepository.deleteExpired).toHaveBeenCalled();
    });

    it('should return 0 when no expired tokens', async () => {
      mockEmailVerificationRepository.deleteExpired.mockResolvedValue(0);

      const result = await cleanupExpiredTokens();

      expect(result).toBe(0);
    });
  });
});
