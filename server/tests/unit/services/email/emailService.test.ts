/**
 * Email Service Tests
 *
 * Tests for SMTP email sending functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mocks to avoid reference before initialization
const { mockSystemSettingRepository, mockNodemailer, mockTransporter } = vi.hoisted(() => {
  const mockTransporter = {
    sendMail: vi.fn(),
    verify: vi.fn(),
    close: vi.fn(),
  };

  const mockNodemailer = {
    createTransport: vi.fn(() => mockTransporter),
  };

  const mockSystemSettingRepository = {
    getValue: vi.fn(),
    getNumber: vi.fn(),
    getBoolean: vi.fn(),
  };

  return { mockSystemSettingRepository, mockNodemailer, mockTransporter };
});

// Mock dependencies
vi.mock('nodemailer', () => ({
  default: mockNodemailer,
}));

vi.mock('../../../../src/repositories', () => ({
  systemSettingRepository: {
    ...mockSystemSettingRepository,
    // Same semantics as the real reader: getValue, then decode a JSON-encoded string.
    getString: async (key: string) => {
      const { decodeStoredString } = await vi.importActual<typeof import('../../../../src/utils/safeJson')>(
        '../../../../src/utils/safeJson',
      );
      const value = await mockSystemSettingRepository.getValue(key);
      return value === null ? null : decodeStoredString(value);
    },
  },
  SystemSettingKeys: {
    SMTP_HOST: 'smtp.host',
    SMTP_PORT: 'smtp.port',
    SMTP_SECURE: 'smtp.secure',
    SMTP_USER: 'smtp.user',
    SMTP_PASSWORD: 'smtp.password',
    SMTP_FROM_ADDRESS: 'smtp.fromAddress',
    SMTP_FROM_NAME: 'smtp.fromName',
  },
}));

vi.mock('../../../../src/utils/encryption', () => ({
  decrypt: vi.fn((val: string) => val.replace('encrypted:', '')),
  isEncrypted: vi.fn((val: string) => val.startsWith('encrypted:')),
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
  getSmtpConfig,
  isSmtpConfigured,
  sendEmail,
  verifySmtpConnection,
  clearTransporterCache,
} from '../../../../src/services/email/emailService';
import { decrypt } from '../../../../src/utils/encryption';

describe('Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear transporter cache before each test
    clearTransporterCache();
  });

  afterEach(() => {
    clearTransporterCache();
  });

  describe('getSmtpConfig', () => {
    it('should return null when SMTP host is not configured', async () => {
      mockSystemSettingRepository.getValue.mockResolvedValue(null);

      const config = await getSmtpConfig();

      expect(config).toBeNull();
    });

    it('should return config when SMTP host is configured', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.user': 'user@example.com',
          'smtp.password': 'password123',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || null);
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const config = await getSmtpConfig();

      expect(config).toEqual({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'user@example.com',
        password: 'password123',
        fromAddress: 'noreply@example.com',
        fromName: 'Test App',
      });
    });

    it('should decrypt encrypted password', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.user': 'user@example.com',
          'smtp.password': 'encrypted:secret123',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || null);
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const config = await getSmtpConfig();

      expect(config?.password).toBe('secret123');
    });

    it('falls back to empty password when decryption fails', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.user': 'user@example.com',
          'smtp.password': 'encrypted:broken',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || null);
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);
      (decrypt as any).mockImplementationOnce(() => {
        throw new Error('decrypt failed');
      });

      const config = await getSmtpConfig();

      expect(config?.password).toBe('');
    });

    it('should use default fromName when not configured', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string | null> = {
          'smtp.host': 'smtp.example.com',
          'smtp.user': '',
          'smtp.password': '',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': null,
        };
        return Promise.resolve(values[key] ?? null);
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const config = await getSmtpConfig();

      expect(config?.fromName).toBe('Sanctuary');
    });
  });

  describe('isSmtpConfigured', () => {
    it('should return false when no SMTP host configured', async () => {
      mockSystemSettingRepository.getValue.mockResolvedValue(null);

      const result = await isSmtpConfigured();

      expect(result).toBe(false);
    });

    it('should return false when no fromAddress configured', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string | null> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': '',
        };
        return Promise.resolve(values[key] ?? null);
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const result = await isSmtpConfigured();

      expect(result).toBe(false);
    });

    it('should return true when host and fromAddress are configured', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const result = await isSmtpConfigured();

      expect(result).toBe(true);
    });
  });

  describe('sendEmail', () => {
    const testMessage = {
      to: 'recipient@example.com',
      subject: 'Test Email',
      text: 'Plain text content',
      html: '<p>HTML content</p>',
    };

    it('should return error when SMTP not configured', async () => {
      mockSystemSettingRepository.getValue.mockResolvedValue(null);

      const result = await sendEmail(testMessage);

      expect(result).toEqual({
        success: false,
        error: 'SMTP not configured',
      });
    });

    it('should send email when SMTP is configured', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.user': 'user@example.com',
          'smtp.password': 'password',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const result = await sendEmail(testMessage);

      expect(result).toEqual({
        success: true,
        messageId: 'test-message-id',
      });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: '"Test App" <noreply@example.com>',
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Plain text content',
        html: '<p>HTML content</p>',
      });
    });

    it('should handle nodemailer send errors', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP connection refused'));

      const result = await sendEmail(testMessage);

      expect(result).toEqual({
        success: false,
        error: 'SMTP connection refused',
      });
    });

    it('returns SMTP not configured when transporter creation throws', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);
      mockNodemailer.createTransport.mockImplementationOnce(() => {
        throw new Error('bad transport config');
      });

      const result = await sendEmail(testMessage);

      expect(result).toEqual({
        success: false,
        error: 'SMTP not configured',
      });
    });

    it('returns configuration-not-available when config disappears after transporter creation', async () => {
      let hostReads = 0;
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        if (key === 'smtp.host') {
          hostReads += 1;
          return Promise.resolve(hostReads === 1 ? 'smtp.example.com' : null);
        }
        const values: Record<string, string> = {
          'smtp.user': 'user@example.com',
          'smtp.password': 'password',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      const result = await sendEmail(testMessage);

      expect(result).toEqual({
        success: false,
        error: 'SMTP configuration not available',
      });
    });

    it('should cache transporter and reuse it', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test App',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      // Send two emails
      await sendEmail(testMessage);
      await sendEmail({ ...testMessage, to: 'other@example.com' });

      // Transporter should only be created once
      expect(mockNodemailer.createTransport).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifySmtpConnection', () => {
    it('should return error when SMTP not configured', async () => {
      mockSystemSettingRepository.getValue.mockResolvedValue(null);

      const result = await verifySmtpConnection();

      expect(result).toEqual({
        success: false,
        error: 'SMTP not configured',
      });
    });

    it('should return success when connection is valid', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      mockTransporter.verify.mockResolvedValue(true);

      const result = await verifySmtpConnection();

      expect(result).toEqual({ success: true });
    });

    it('should return error when connection verification fails', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      mockTransporter.verify.mockRejectedValue(new Error('Connection timeout'));

      const result = await verifySmtpConnection();

      expect(result).toEqual({
        success: false,
        error: 'Connection timeout',
      });
    });
  });

  describe('clearTransporterCache', () => {
    it('should clear cached transporter', async () => {
      mockSystemSettingRepository.getValue.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.fromName': 'Test',
        };
        return Promise.resolve(values[key] || '');
      });
      mockSystemSettingRepository.getNumber.mockResolvedValue(587);
      mockSystemSettingRepository.getBoolean.mockResolvedValue(false);

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      // Send first email (creates transporter)
      await sendEmail({ to: 'test@example.com', subject: 'Test', text: 'Test', html: '<p>Test</p>' });

      // Clear cache
      clearTransporterCache();

      // Send second email (should create new transporter)
      await sendEmail({ to: 'test@example.com', subject: 'Test', text: 'Test', html: '<p>Test</p>' });

      // Transporter should be created twice
      expect(mockNodemailer.createTransport).toHaveBeenCalledTimes(2);
      expect(mockTransporter.close).toHaveBeenCalledTimes(1);
    });
  });
});
