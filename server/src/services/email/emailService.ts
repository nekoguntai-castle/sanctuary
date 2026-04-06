/**
 * Email Service
 *
 * Handles SMTP email sending using nodemailer.
 * Configuration is loaded from system settings (admin-configurable).
 */

import nodemailer, { Transporter } from 'nodemailer';
import { systemSettingRepository, SystemSettingKeys } from '../../repositories';
import { decrypt, isEncrypted } from '../../utils/encryption';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { SmtpConfig, EmailMessage, EmailSendResult } from './types';

const log = createLogger('EMAIL:SVC');

// Cache transporter to reuse connections
let transporter: Transporter | null = null;
let cachedConfig: SmtpConfig | null = null;

/**
 * Get SMTP configuration from system settings
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const host = await systemSettingRepository.getValue(SystemSettingKeys.SMTP_HOST);

  // If no host configured, SMTP is not set up
  if (!host) {
    return null;
  }

  const port = await systemSettingRepository.getNumber(SystemSettingKeys.SMTP_PORT, 587);
  const secure = await systemSettingRepository.getBoolean(SystemSettingKeys.SMTP_SECURE, false);
  const user = (await systemSettingRepository.getValue(SystemSettingKeys.SMTP_USER)) || '';
  const passwordRaw = (await systemSettingRepository.getValue(SystemSettingKeys.SMTP_PASSWORD)) || '';
  const fromAddress = (await systemSettingRepository.getValue(SystemSettingKeys.SMTP_FROM_ADDRESS)) || '';
  const fromName = (await systemSettingRepository.getValue(SystemSettingKeys.SMTP_FROM_NAME)) || 'Sanctuary';

  // Decrypt password if encrypted
  let password = passwordRaw;
  if (passwordRaw && isEncrypted(passwordRaw)) {
    try {
      password = decrypt(passwordRaw);
    } catch (error) {
      log.error('Failed to decrypt SMTP password', { error: getErrorMessage(error) });
      password = '';
    }
  }

  return {
    host,
    port,
    secure,
    user,
    password,
    fromAddress,
    fromName,
  };
}

/**
 * Check if SMTP is configured
 */
export async function isSmtpConfigured(): Promise<boolean> {
  const config = await getSmtpConfig();
  return config !== null && config.host.length > 0 && config.fromAddress.length > 0;
}

/**
 * Create or get cached nodemailer transporter
 */
async function getTransporter(): Promise<Transporter | null> {
  const config = await getSmtpConfig();

  if (!config) {
    return null;
  }

  // Check if config changed (invalidate cache)
  const configHash = JSON.stringify(config);
  const cachedHash = cachedConfig ? JSON.stringify(cachedConfig) : null;

  if (transporter && configHash === cachedHash) {
    return transporter;
  }

  // Create new transporter
  try {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user
        ? {
            user: config.user,
            pass: config.password,
          }
        : undefined,
    });

    cachedConfig = config;
    log.info('SMTP transporter created', { host: config.host, port: config.port });
    return transporter;
  } catch (error) {
    log.error('Failed to create SMTP transporter', { error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Send an email
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  const transport = await getTransporter();

  if (!transport) {
    log.warn('SMTP not configured, email not sent', { to: message.to });
    return {
      success: false,
      error: 'SMTP not configured',
    };
  }

  const config = await getSmtpConfig();
  if (!config) {
    return {
      success: false,
      error: 'SMTP configuration not available',
    };
  }

  try {
    const result = await transport.sendMail({
      from: `"${config.fromName}" <${config.fromAddress}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    log.info('Email sent successfully', {
      to: message.to,
      subject: message.subject,
      messageId: result.messageId,
    });

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    log.error('Failed to send email', {
      to: message.to,
      subject: message.subject,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Verify SMTP connection (for testing configuration)
 */
export async function verifySmtpConnection(): Promise<{ success: boolean; error?: string }> {
  const transport = await getTransporter();

  if (!transport) {
    return {
      success: false,
      error: 'SMTP not configured',
    };
  }

  try {
    await transport.verify();
    log.info('SMTP connection verified successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    log.error('SMTP connection verification failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Clear cached transporter (call when settings change)
 */
export function clearTransporterCache(): void {
  if (transporter) {
    transporter.close();
  }
  transporter = null;
  cachedConfig = null;
  log.debug('SMTP transporter cache cleared');
}

export default {
  getSmtpConfig,
  isSmtpConfigured,
  sendEmail,
  verifySmtpConnection,
  clearTransporterCache,
};
