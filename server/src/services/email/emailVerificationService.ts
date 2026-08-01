/**
 * Email Verification Service
 *
 * Handles email verification token generation, validation, and email sending.
 */

import * as crypto from 'crypto';
import {
  emailVerificationRepository,
  userRepository,
  systemSettingRepository,
  SystemSettingKeys,
} from '../../repositories';
import { sendEmail, isSmtpConfigured } from './emailService';
import { generateVerificationEmail } from './templates/verification';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import config from '../../config';

const log = createLogger('EMAIL:VERIFICATION');

// Token configuration
const TOKEN_BYTES = 32;
const DEFAULT_EXPIRY_HOURS = 24;

/**
 * Generate a cryptographically secure verification token
 */
function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token for secure storage
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Get the token expiry hours from settings
 */
async function getTokenExpiryHours(): Promise<number> {
  return systemSettingRepository.getNumber(
    SystemSettingKeys.EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS,
    DEFAULT_EXPIRY_HOURS
  );
}

/**
 * Check if email verification is required for login
 */
export async function isVerificationRequired(): Promise<boolean> {
  return systemSettingRepository.getBoolean(
    SystemSettingKeys.EMAIL_VERIFICATION_REQUIRED,
    true
  );
}

/**
 * Get the server name for emails
 */
async function getServerName(): Promise<string> {
  const name = await systemSettingRepository.getValue(SystemSettingKeys.SERVER_NAME);
  return name || 'Sanctuary';
}

/**
 * Generate the verification URL
 */
function getVerificationUrl(token: string): string {
  // Use the client URL since verification happens in the frontend
  const baseUrl = config.server.clientUrl || `http://localhost:3000`;
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Create a new email verification token and send verification email
 */
export async function createVerificationToken(
  userId: string,
  email: string,
  username: string
): Promise<{
  success: boolean;
  tokenId?: string;
  expiresAt?: Date;
  error?: string;
}> {
  try {
    const smtpConfigured = await isSmtpConfigured();
    if (!smtpConfigured) {
      log.warn('SMTP not configured, skipping verification email', { userId, email });
      return {
        success: false,
        error: 'SMTP not configured',
      };
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiryHours = await getTokenExpiryHours();
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const { token: verificationToken } = await emailVerificationRepository.replaceUnusedAndCreate({
      userId,
      email,
      tokenHash,
      expiresAt,
    });

    const serverName = await getServerName();
    const verificationUrl = getVerificationUrl(token);

    const emailContent = generateVerificationEmail({
      username,
      email,
      verificationUrl,
      expiresInHours: expiryHours,
      serverName,
    });

    const sendResult = await sendEmail({
      to: email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!sendResult.success) {
      log.error('Failed to send verification email', {
        userId,
        email,
        error: sendResult.error,
      });
      // Don't delete the token - user can try to resend
      return {
        success: false,
        tokenId: verificationToken.id,
        expiresAt,
        error: sendResult.error,
      };
    }

    log.info('Verification email sent', { userId, email, tokenId: verificationToken.id });

    return {
      success: true,
      tokenId: verificationToken.id,
      expiresAt,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    log.error('Failed to create verification token', { userId, email, error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Update a user's email and create the replacement verification intent in the
 * same transaction that invalidates older unused intents. SMTP delivery happens
 * only after that transaction commits, so stale old-address tokens cannot
 * survive when mail delivery is unavailable.
 */
export async function updateEmailWithVerification(
  userId: string,
  email: string,
  username: string
): Promise<{
  user: Awaited<ReturnType<typeof userRepository.updateEmail>>;
  verification: {
    success: boolean;
    tokenId?: string;
    expiresAt?: Date;
    error?: string;
  };
}> {
  try {
    const smtpConfigured = await isSmtpConfigured();
    const token = smtpConfigured ? generateToken() : null;
    const tokenHash = token ? hashToken(token) : undefined;
    const expiryHours = smtpConfigured ? await getTokenExpiryHours() : DEFAULT_EXPIRY_HOURS;
    const expiresAt = tokenHash
      ? new Date(Date.now() + expiryHours * 60 * 60 * 1000)
      : undefined;
    const { token: verificationToken, user } = await emailVerificationRepository.replaceUnusedForEmailUpdate({
      userId,
      email,
      tokenHash,
      expiresAt,
    });

    if (!smtpConfigured || !token || !verificationToken || !expiresAt) {
      log.warn('SMTP not configured after email update', {
        userId,
        email: user.email,
      });
      return {
        user,
        verification: {
          success: false,
          error: 'SMTP not configured',
        },
      };
    }

    const serverName = await getServerName();
    const verificationUrl = getVerificationUrl(token);
    const emailContent = generateVerificationEmail({
      username,
      email,
      verificationUrl,
      expiresInHours: expiryHours,
      serverName,
    });
    const sendResult = await sendEmail({
      to: email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!sendResult.success) {
      log.error('Failed to send verification email after email update', {
        userId,
        email,
        error: sendResult.error,
      });
      return {
        user,
        verification: {
          success: false,
          tokenId: verificationToken.id,
          expiresAt,
          error: sendResult.error,
        },
      };
    }

    return {
      user,
      verification: {
        success: true,
        tokenId: verificationToken.id,
        expiresAt,
      },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    log.error('Failed to update email verification intent', { userId, email, error: errorMessage });
    throw error;
  }
}

/**
 * Verify an email using a token
 */
export async function verifyEmail(token: string): Promise<{
  success: boolean;
  userId?: string;
  email?: string;
  error?: 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'ALREADY_USED' | 'USER_NOT_FOUND' | 'UNKNOWN_ERROR';
}> {
  try {
    const tokenHash = hashToken(token);

    const verificationResult = await emailVerificationRepository.consumeForCurrentEmail(tokenHash);

    if (!verificationResult.success) {
      const publicError = verificationResult.error === 'EMAIL_MISMATCH'
        ? 'INVALID_TOKEN'
        : verificationResult.error;
      log.warn('Invalid verification token attempted');
      return {
        success: false,
        userId: verificationResult.userId,
        error: publicError,
      };
    }

    log.info('Email verified successfully', {
      userId: verificationResult.userId,
      email: verificationResult.email,
    });

    return {
      success: true,
      userId: verificationResult.userId,
      email: verificationResult.email,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    log.error('Failed to verify email', { error: errorMessage });
    return {
      success: false,
      error: 'UNKNOWN_ERROR',
    };
  }
}

/**
 * Resend verification email
 */
export async function resendVerification(
  userId: string
): Promise<{
  success: boolean;
  expiresAt?: Date;
  error?: string;
}> {
  try {
    // Get user
    const user = await userRepository.findById(userId);
    if (!user) {
      return {
        success: false,
        error: 'User not found',
      };
    }

    if (!user.email) {
      return {
        success: false,
        error: 'No email address set',
      };
    }

    if (user.emailVerified) {
      return {
        success: false,
        error: 'Email already verified',
      };
    }

    // Check rate limiting - max 5 tokens in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await emailVerificationRepository.countCreatedSince(userId, oneHourAgo);

    if (recentCount >= 5) {
      return {
        success: false,
        error: 'Too many verification requests. Please try again later.',
      };
    }

    // Create new verification token
    const result = await createVerificationToken(userId, user.email, user.username);

    return {
      success: result.success,
      expiresAt: result.expiresAt,
      error: result.error,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    log.error('Failed to resend verification', { userId, error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Check if a user's email is verified
 */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await userRepository.findById(userId);
  return user?.emailVerified ?? false;
}

/**
 * Clean up expired verification tokens (maintenance job)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const count = await emailVerificationRepository.deleteExpired();
  if (count > 0) {
    log.info('Cleaned up expired verification tokens', { count });
  }
  return count;
}

export default {
  isVerificationRequired,
  createVerificationToken,
  updateEmailWithVerification,
  verifyEmail,
  resendVerification,
  isEmailVerified,
  cleanupExpiredTokens,
};
