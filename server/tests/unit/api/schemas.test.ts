/**
 * Schema Validation Tests
 *
 * Tests for Zod schema refine callbacks that aren't exercised
 * through route-level tests in unit test mode.
 */

import { describe, it, expect } from 'vitest';
import { PasswordSchema, RegisterSchema } from '../../../src/api/schemas/auth';
import {
  getPasswordUtf8ByteLength,
  PASSWORD_POLICY,
  PASSWORD_POLICY_MESSAGES,
  validatePasswordStrength,
} from '../../../src/utils/password';
import {
  AddGroupMemberSchema,
  ConfirmRestoreSchema,
  CreateGroupSchema,
  ReorderElectrumServersSchema,
  RestoreBackupSchema,
  SystemSettingsUpdateSchema,
  TestElectrumServerSchema,
  UpdateUserSchema,
} from '../../../src/api/schemas/admin';

describe('Auth Schemas', () => {
  describe('PasswordSchema', () => {
    it('should accept valid password', () => {
      const result = PasswordSchema.safeParse('StrongPass1');
      expect(result.success).toBe(true);
    });

    it('should reject password without lowercase', () => {
      const result = PasswordSchema.safeParse('ALLUPPERCASE1');
      expect(result.success).toBe(false);
    });

    it('should reject password without uppercase', () => {
      const result = PasswordSchema.safeParse('alllowercase1');
      expect(result.success).toBe(false);
    });

    it('should reject password without number', () => {
      const result = PasswordSchema.safeParse('NoNumbersHere');
      expect(result.success).toBe(false);
    });

    it('should reject short password', () => {
      const result = PasswordSchema.safeParse('Ab1');
      expect(result.success).toBe(false);
    });

    it('should accept password exactly at the UTF-8 byte limit', () => {
      const password = 'A1' + 'a'.repeat(PASSWORD_POLICY.maxUtf8Bytes - 2);
      expect(getPasswordUtf8ByteLength(password)).toBe(PASSWORD_POLICY.maxUtf8Bytes);

      const result = PasswordSchema.safeParse(password);
      expect(result.success).toBe(true);
    });

    it('should reject password above the UTF-8 byte limit', () => {
      const password = 'A1' + 'a'.repeat(PASSWORD_POLICY.maxUtf8Bytes - 1);
      expect(getPasswordUtf8ByteLength(password)).toBe(PASSWORD_POLICY.maxUtf8Bytes + 1);

      const result = PasswordSchema.safeParse(password);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map(issue => issue.message)).toContain(PASSWORD_POLICY_MESSAGES.maxUtf8Bytes);
      }
    });

    it('should reject unicode passwords above the UTF-8 byte limit', () => {
      const password = 'A1' + 'a'.repeat(PASSWORD_POLICY.maxUtf8Bytes - 5) + '🔥';
      expect(password.length).toBeLessThanOrEqual(PASSWORD_POLICY.maxUtf8Bytes);
      expect(getPasswordUtf8ByteLength(password)).toBe(PASSWORD_POLICY.maxUtf8Bytes + 1);

      const result = validatePasswordStrength(password);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(PASSWORD_POLICY_MESSAGES.maxUtf8Bytes);
    });
  });

  describe('RegisterSchema', () => {
    it('requires email to match the public registration contract', () => {
      const missingEmail = RegisterSchema.safeParse({
        username: 'user123',
        password: 'StrongPass1',
      });
      expect(missingEmail.success).toBe(false);

      const withEmail = RegisterSchema.safeParse({
        username: 'user123',
        password: 'StrongPass1',
        email: 'user@example.com',
      });
      expect(withEmail.success).toBe(true);
    });
  });
});

describe('Admin Schemas', () => {
  describe('UpdateUserSchema', () => {
    it('allows empty email so admins can clear existing email addresses', () => {
      const result = UpdateUserSchema.safeParse({ email: '' });
      expect(result.success).toBe(true);
    });
  });

  describe('Group schemas', () => {
    it('accepts repository string IDs for group member lists and direct member additions', () => {
      expect(CreateGroupSchema.safeParse({
        name: 'Team',
        memberIds: ['user-1', 'user-2'],
      }).success).toBe(true);

      expect(AddGroupMemberSchema.safeParse({ userId: 'user-1', role: 'admin' }).success).toBe(true);
      expect(AddGroupMemberSchema.safeParse({ userId: 'user-1', role: 'owner' }).success).toBe(false);
    });
  });

  describe('Electrum server schemas', () => {
    it('accepts repository string IDs for reorder requests and defaults ad hoc tests to TCP', () => {
      expect(ReorderElectrumServersSchema.safeParse({ serverIds: ['srv-3', 'srv-1'] }).success).toBe(true);

      const result = TestElectrumServerSchema.safeParse({ host: 'electrum.example.com', port: '50002' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.useSsl).toBe(false);
      }
    });
  });

  describe('Backup schemas', () => {
    const backup = {
      meta: {
        version: '1.0',
        appVersion: '0.8.32',
        schemaVersion: 1,
        createdAt: '2026-04-12T00:00:00.000Z',
        createdBy: 'admin',
        includesCache: false,
        recordCounts: {},
      },
      data: {},
    };

    it('accepts backup objects and enforces explicit restore confirmation', () => {
      expect(RestoreBackupSchema.safeParse({ backup }).success).toBe(true);
      expect(ConfirmRestoreSchema.safeParse({ backup, confirmationCode: 'NOPE' }).success).toBe(false);
      expect(ConfirmRestoreSchema.safeParse({ backup, confirmationCode: 'CONFIRM_RESTORE' }).success).toBe(true);
    });
  });

  describe('SystemSettingsUpdateSchema', () => {
    it('should accept object with settings', () => {
      const result = SystemSettingsUpdateSchema.safeParse({ key: 'value' });
      expect(result.success).toBe(true);
    });

    it('should reject empty object', () => {
      const result = SystemSettingsUpdateSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
