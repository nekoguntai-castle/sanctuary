/**
 * Email Service
 *
 * Provides email sending and verification functionality.
 */

// Core email service
export {
  getSmtpConfig,
  isSmtpConfigured,
  sendEmail,
  verifySmtpConnection,
  clearTransporterCache,
} from './emailService';

// Email verification service
export {
  isVerificationRequired,
  createVerificationToken,
  updateEmailWithVerification,
  verifyEmail,
  resendVerification,
  isEmailVerified,
  cleanupExpiredTokens,
} from './emailVerificationService';

// Types
export type {
  SmtpConfig,
  EmailMessage,
  EmailSendResult,
  VerificationEmailData,
} from './types';

// Templates
export { generateVerificationEmail } from './templates/verification';
