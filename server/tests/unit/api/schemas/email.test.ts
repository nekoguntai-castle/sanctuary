/**
 * Email Schema Tests
 *
 * Tests for email verification Zod validation schemas.
 */

import { describe, it, expect } from 'vitest';
import { VerifyEmailSchema, UpdateEmailSchema } from '../../../../src/api/schemas/email';

describe('Email Schemas', () => {
  describe('VerifyEmailSchema', () => {
    it('should accept valid token string', () => {
      const result = VerifyEmailSchema.safeParse({ token: 'valid-token-123' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.token).toBe('valid-token-123');
      }
    });

    it('should accept long token strings', () => {
      const longToken = 'a'.repeat(256);
      const result = VerifyEmailSchema.safeParse({ token: longToken });
      expect(result.success).toBe(true);
    });

    it('should reject empty token', () => {
      const result = VerifyEmailSchema.safeParse({ token: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Token is required');
      }
    });

    it('should reject missing token', () => {
      const result = VerifyEmailSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject non-string token', () => {
      const result = VerifyEmailSchema.safeParse({ token: 123 });
      expect(result.success).toBe(false);
    });

    it('should reject null token', () => {
      const result = VerifyEmailSchema.safeParse({ token: null });
      expect(result.success).toBe(false);
    });

    it('should reject undefined token', () => {
      const result = VerifyEmailSchema.safeParse({ token: undefined });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateEmailSchema', () => {
    it('should accept valid email and password', () => {
      const result = UpdateEmailSchema.safeParse({
        email: 'test@example.com',
        password: 'MySecurePassword123!',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('test@example.com');
        expect(result.data.password).toBe('MySecurePassword123!');
      }
    });

    it('should canonicalize mixed-case email to lowercase', () => {
      const result = UpdateEmailSchema.safeParse({
        email: 'Mixed.Case+Tag@Example.COM',
        password: 'test123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('mixed.case+tag@example.com');
      }
    });

    it('should accept various valid email formats', () => {
      // Note: Zod's email validation is stricter than RFC 5321/5322
      const validEmails = [
        'simple@example.com',
        'very.common@example.com',
        'disposable.style.email.with+symbol@example.com',
        'other.email-with-hyphen@example.com',
        'fully-qualified-domain@example.com',
        'user.name+tag+sorting@example.com',
        'x@example.com',
        'example-indeed@strange-example.com',
        'example@s.example',
      ];

      for (const email of validEmails) {
        const result = UpdateEmailSchema.safeParse({ email, password: 'test123' });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid email format', () => {
      const invalidEmails = [
        'plainaddress',
        '@missing-local.com',
        'missing-at.com',
        'missing@domain',
        'spaces in@email.com',
        'double..dots@example.com',
      ];

      for (const email of invalidEmails) {
        const result = UpdateEmailSchema.safeParse({ email, password: 'test123' });
        expect(result.success).toBe(false);
      }
    });

    it('should reject empty email', () => {
      const result = UpdateEmailSchema.safeParse({
        email: '',
        password: 'test123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('email');
      }
    });

    it('should reject missing email', () => {
      const result = UpdateEmailSchema.safeParse({
        password: 'test123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty password', () => {
      const result = UpdateEmailSchema.safeParse({
        email: 'test@example.com',
        password: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('password');
      }
    });

    it('should reject missing password', () => {
      const result = UpdateEmailSchema.safeParse({
        email: 'test@example.com',
      });
      expect(result.success).toBe(false);
    });

    it('should reject both missing', () => {
      const result = UpdateEmailSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should reject non-string email', () => {
      const result = UpdateEmailSchema.safeParse({
        email: 123,
        password: 'test123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-string password', () => {
      const result = UpdateEmailSchema.safeParse({
        email: 'test@example.com',
        password: 123,
      });
      expect(result.success).toBe(false);
    });

    it('should not enforce password strength (done elsewhere)', () => {
      // Schema only checks non-empty, actual strength validation is done in route
      const result = UpdateEmailSchema.safeParse({
        email: 'test@example.com',
        password: '1', // Very weak but should pass schema
      });
      expect(result.success).toBe(true);
    });
  });
});
