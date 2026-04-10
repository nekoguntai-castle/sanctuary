/**
 * Schema Validation Tests
 *
 * Tests for Zod schema refine callbacks that aren't exercised
 * through route-level tests in unit test mode.
 */

import { describe, it, expect } from 'vitest';
import { PasswordSchema } from '../../../src/api/schemas/auth';
import { SystemSettingsUpdateSchema } from '../../../src/api/schemas/admin';

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
  });
});

describe('Admin Schemas', () => {
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
