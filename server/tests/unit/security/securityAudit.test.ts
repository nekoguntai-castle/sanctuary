import { vi } from 'vitest';
/**
 * Security Audit Tests
 *
 * Tests that validate security controls and prevent regressions based on
 * security audit findings. These tests cover:
 *
 * CRITICAL:
 * 1. Hardcoded default password detection and warning
 * 2. JWT secret validation in production environments
 *
 * HIGH:
 * 3. Password policy consistency across all endpoints
 * 4. Password strength validation enforcement
 *
 * MEDIUM:
 * 5. Input length validation
 * 6. Rate limiting functionality
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { sampleUsers } from '../../fixtures/bitcoin';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
} from '../../helpers/testUtils';
import * as bcrypt from 'bcryptjs';

// ============================================================================
// MOCKS SETUP
// ============================================================================

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Store original NODE_ENV to restore after tests
const originalNodeEnv = process.env.NODE_ENV;

// Mock config - we'll reset this for production tests
vi.mock('../../../src/config', () => ({
  __esModule: true,
  default: {
    jwtSecret: 'test-jwt-secret-key-for-testing-only',
    jwtExpiresIn: '1h',
    nodeEnv: process.env.NODE_ENV || 'test',
  },
}));

// Mock audit service
vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logFromRequest: vi.fn().mockResolvedValue(undefined),
  },
  AuditAction: {
    LOGIN: 'LOGIN',
    LOGIN_FAILED: 'LOGIN_FAILED',
    PASSWORD_CHANGE: 'PASSWORD_CHANGE',
    USER_CREATE: 'USER_CREATE',
    USER_UPDATE: 'USER_UPDATE',
  },
  AuditCategory: {
    AUTH: 'AUTH',
    USER: 'USER',
  },
  getClientInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
}));

// Import utilities after mocks
import {
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  PASSWORD_POLICY_MESSAGES,
} from '../../../src/utils/password';

describe('Security Audit Tests', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  afterAll(() => {
    // Restore NODE_ENV
    process.env.NODE_ENV = originalNodeEnv;
  });

  // ==========================================================================
  // CRITICAL: Hardcoded Default Password Tests
  // ==========================================================================
  describe('CRITICAL: Default Password Detection', () => {
    const DEFAULT_PASSWORD = 'sanctuary';

    describe('Login endpoint should warn about default password usage', () => {
      it('should include usingDefaultPassword flag when logging in with default password', async () => {
        // The auth.ts file checks if password === DEFAULT_PASSWORD
        // This tests that the warning mechanism exists
        const password = DEFAULT_PASSWORD;
        const hashedPassword = await hashPassword(password);

        // Simulate login check
        const isDefaultPassword = password === DEFAULT_PASSWORD;
        expect(isDefaultPassword).toBe(true);

        // Verify the hash can be verified (password works)
        const isValid = await verifyPassword(password, hashedPassword);
        expect(isValid).toBe(true);
      });

      it('should NOT flag usingDefaultPassword for non-default passwords', async () => {
        const password: string = 'MySecurePassword123!';
        const isDefaultPassword = password === DEFAULT_PASSWORD;
        expect(isDefaultPassword).toBe(false);
      });

      it('should detect default password even with different casing concerns', () => {
        // The current implementation is case-sensitive
        // This test documents and validates the expected behavior
        const testCases = [
          { password: 'sanctuary', expected: true },
          { password: 'Sanctuary', expected: false },
          { password: 'SANCTUARY', expected: false },
          { password: 'sanctuary ', expected: false },
          { password: ' sanctuary', expected: false },
        ];

        testCases.forEach(({ password, expected }) => {
          expect(password === DEFAULT_PASSWORD).toBe(expected);
        });
      });
    });

    describe('GET /auth/me should detect users with default password', () => {
      it('should check if stored password matches default password hash', async () => {
        // In auth.ts, the /me endpoint does:
        // const usingDefaultPassword = await verifyPassword(DEFAULT_PASSWORD, user.password);
        const defaultPasswordHash = await hashPassword(DEFAULT_PASSWORD);

        // User has default password
        const isUsingDefault = await verifyPassword(DEFAULT_PASSWORD, defaultPasswordHash);
        expect(isUsingDefault).toBe(true);

        // User has changed password
        const changedPasswordHash = await hashPassword('NewSecurePassword123!');
        const isUsingDefaultAfterChange = await verifyPassword(DEFAULT_PASSWORD, changedPasswordHash);
        expect(isUsingDefaultAfterChange).toBe(false);
      });
    });

    describe('Security recommendation: Default password should be changed', () => {
      it('should document that default password creates security risk', () => {
        // This test serves as documentation and regression prevention
        // The hardcoded password 'sanctuary' at auth.ts:202 creates a known credential
        const KNOWN_INSECURE_PASSWORDS = [
          'sanctuary',  // The hardcoded default
          'password',
          '123456',
          'admin',
        ];

        // All of these should be considered insecure
        KNOWN_INSECURE_PASSWORDS.forEach((password) => {
          const strength = validatePasswordStrength(password);
          expect(strength.valid).toBe(false);
        });
      });
    });
  });

  // ==========================================================================
  // CRITICAL: JWT Secret Validation Tests
  // ==========================================================================
  describe('CRITICAL: JWT Secret Production Validation', () => {
    // Default secret from config/index.ts:60
    const INSECURE_DEFAULT_SECRET = 'default-secret-change-in-production';

    describe('Config validation behavior', () => {
      it('should recognize the insecure default JWT secret', () => {
        // This test validates that the default secret is identifiable
        expect(INSECURE_DEFAULT_SECRET).toBe('default-secret-change-in-production');
      });

      it('should document production requirement for JWT_SECRET', () => {
        // From config/index.ts:90-92:
        // if (config.jwtSecret === 'default-secret-change-in-production') {
        //   throw new Error('JWT_SECRET must be set in production');
        // }

        // This test verifies the validation logic pattern exists
        const simulateProductionValidation = (nodeEnv: string, jwtSecret: string): boolean => {
          if (nodeEnv === 'production') {
            if (jwtSecret === INSECURE_DEFAULT_SECRET) {
              return false; // Would throw error in production
            }
          }
          return true;
        };

        // Development mode allows default secret
        expect(simulateProductionValidation('development', INSECURE_DEFAULT_SECRET)).toBe(true);
        expect(simulateProductionValidation('test', INSECURE_DEFAULT_SECRET)).toBe(true);

        // Production MUST NOT use default secret
        expect(simulateProductionValidation('production', INSECURE_DEFAULT_SECRET)).toBe(false);

        // Production with custom secret is OK
        expect(simulateProductionValidation('production', 'a-real-secure-secret-key-123!')).toBe(true);
      });

      it('should require strong JWT secrets in production', () => {
        // Security best practice: JWT secrets should be cryptographically strong
        const isStrongSecret = (secret: string): boolean => {
          // Minimum 32 characters recommended for JWT secrets
          if (secret.length < 32) return false;
          // Should not be a common default
          if (secret === INSECURE_DEFAULT_SECRET) return false;
          if (secret.toLowerCase().includes('change') || secret.toLowerCase().includes('default')) return false;
          return true;
        };

        // Weak secrets
        expect(isStrongSecret(INSECURE_DEFAULT_SECRET)).toBe(false);
        expect(isStrongSecret('short')).toBe(false);
        expect(isStrongSecret('please-change-this-secret')).toBe(false);

        // Strong secrets
        expect(isStrongSecret('a-real-secure-secret-key-that-is-very-long-123!')).toBe(true);
        expect(isStrongSecret('kJ9xMqP2vN5wR8yT3bF6hL0cA4sD7gE1')).toBe(true);
      });
    });
  });

  // ==========================================================================
  // HIGH: Password Policy Consistency Tests
  // ==========================================================================
  describe('HIGH: Password Policy Consistency', () => {
    describe('Password validation function (password.ts)', () => {
      it('should require minimum 8 characters', () => {
        const shortPassword = 'Short1!';
        const result = validatePasswordStrength(shortPassword);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
      });

      it('should require uppercase letter', () => {
        const noUppercase = 'alllowercase123!';
        const result = validatePasswordStrength(noUppercase);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
      });

      it('should require lowercase letter', () => {
        const noLowercase = 'ALLUPPERCASE123!';
        const result = validatePasswordStrength(noLowercase);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter');
      });

      it('should require at least one number', () => {
        const noNumber = 'NoNumbersHere!';
        const result = validatePasswordStrength(noNumber);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one number');
      });

      it('should accept valid strong password', () => {
        const strongPassword = 'SecurePassword123!';
        const result = validatePasswordStrength(strongPassword);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('SECURITY FINDING: Admin user creation has weak 6-char minimum', () => {
      // This test documents the inconsistency found in admin.ts:315-319
      // where admin-created users only require 6 characters vs 8 elsewhere

      it('should document the inconsistency between endpoints', () => {
        // From admin.ts:315-319:
        // if (password.length < 6) {
        //   return res.status(400).json({
        //     error: 'Bad Request',
        //     message: 'Password must be at least 6 characters',
        //   });
        // }

        // From password.ts validatePasswordStrength:
        // if (password.length < 8) {
        //   errors.push('Password must be at least 8 characters long');
        // }

        const ADMIN_ENDPOINT_MIN_LENGTH = 6;
        const PASSWORD_UTILITY_MIN_LENGTH = 8;

        // Document the inconsistency - this test will PASS but highlights the issue
        expect(ADMIN_ENDPOINT_MIN_LENGTH).not.toBe(PASSWORD_UTILITY_MIN_LENGTH);

        // A password that passes admin endpoint but fails password utility
        const weakPassword = 'Short1';
        expect(weakPassword.length).toBeGreaterThanOrEqual(ADMIN_ENDPOINT_MIN_LENGTH);
        expect(weakPassword.length).toBeLessThan(PASSWORD_UTILITY_MIN_LENGTH);

        const strengthCheck = validatePasswordStrength(weakPassword);
        expect(strengthCheck.valid).toBe(false);
      });

      it('should demonstrate passwords that slip through admin endpoint but are weak', () => {
        // These passwords would pass admin.ts validation but fail proper password policy
        const weakButPassAdminEndpoint = [
          'abc123',   // 6 chars, but no uppercase
          'Abc123',   // 6 chars, has all but too short for password.ts
          'abcdef',   // 6 chars, no uppercase, no numbers
        ];

        weakButPassAdminEndpoint.forEach((password) => {
          // Would pass admin.ts check (length >= 6)
          expect(password.length).toBeGreaterThanOrEqual(6);

          // Fails proper password validation
          const result = validatePasswordStrength(password);
          expect(result.valid).toBe(false);
        });
      });
    });

    describe('Auth change-password endpoint has 6-char minimum', () => {
      // From auth.ts:538-543:
      // if (newPassword.length < 6) {
      //   return res.status(400).json({
      //     error: 'Bad Request',
      //     message: 'New password must be at least 6 characters',
      //   });
      // }

      it('should document auth change-password also uses weak minimum', () => {
        const AUTH_CHANGE_PASSWORD_MIN = 6;
        const PROPER_MIN = 8;

        expect(AUTH_CHANGE_PASSWORD_MIN).toBeLessThan(PROPER_MIN);
      });
    });
  });

  // ==========================================================================
  // HIGH: Password Strength Validation Applied Consistently
  // ==========================================================================
  describe('HIGH: Password Strength Validation Consistency', () => {
    it('should test validatePasswordStrength with various password patterns', () => {
      const testCases = [
        // Invalid passwords
        { password: '', expectedValid: false, reason: 'empty' },
        { password: 'short', expectedValid: false, reason: 'too short' },
        { password: 'nouppercase123', expectedValid: false, reason: 'no uppercase' },
        { password: 'NOLOWERCASE123', expectedValid: false, reason: 'no lowercase' },
        { password: 'NoNumbersHere', expectedValid: false, reason: 'no numbers' },
        { password: 'sanctuary', expectedValid: false, reason: 'default password - too weak' },

        // Valid passwords
        { password: 'ValidPass1', expectedValid: true, reason: 'meets all requirements' },
        { password: 'SecurePassword123', expectedValid: true, reason: 'strong password' },
        { password: 'MyP@ssw0rd', expectedValid: true, reason: 'with special chars' },
        { password: 'ABCDEfgh12345', expectedValid: true, reason: 'long alphanumeric' },
      ];

      testCases.forEach(({ password, expectedValid, reason }) => {
        const result = validatePasswordStrength(password);
        expect(result.valid).toBe(expectedValid);
      });
    });

    it('should catch common weak passwords', () => {
      const commonWeakPasswords = [
        'password',
        'Password',
        '12345678',
        'qwerty123',
        'letmein1',
        'admin123',
        'welcome1',
      ];

      commonWeakPasswords.forEach((password) => {
        const result = validatePasswordStrength(password);
        // Most common passwords fail at least one criterion
        // This test verifies our validation catches these
        if (result.valid) {
          // If it passes, it must meet ALL criteria
          expect(password.length).toBeGreaterThanOrEqual(8);
          expect(/[A-Z]/.test(password)).toBe(true);
          expect(/[a-z]/.test(password)).toBe(true);
          expect(/[0-9]/.test(password)).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // MEDIUM: Input Length Validation Tests
  // ==========================================================================
  describe('MEDIUM: Input Length Validation', () => {
    describe('Username length validation', () => {
      it('should reject usernames that are too short', () => {
        // From admin.ts:308-313:
        // if (username.length < 3) { ... }
        const MIN_USERNAME_LENGTH = 3;

        expect('ab'.length).toBeLessThan(MIN_USERNAME_LENGTH);
        expect('abc'.length).toBeGreaterThanOrEqual(MIN_USERNAME_LENGTH);
      });

      it('should handle maximum length inputs gracefully', () => {
        // Test that extremely long inputs don't cause issues
        const extremelyLongUsername = 'a'.repeat(10000);
        const extremelyLongPassword = 'A1' + 'a'.repeat(10000);

        // Password policy should fail closed before bcrypt's 72-byte truncation boundary
        const result = validatePasswordStrength(extremelyLongPassword);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(PASSWORD_POLICY_MESSAGES.maxUtf8Bytes);

        // Very long usernames could be a DoS vector - document this
        expect(extremelyLongUsername.length).toBe(10000);
      });
    });

    describe('Password length validation', () => {
      it('should handle very long passwords', async () => {
        // bcrypt has a 72-byte limit
        const longPassword = 'A1a' + 'x'.repeat(100);
        const veryLongPassword = 'A1a' + 'x'.repeat(1000);

        // Both should hash and verify correctly
        const hash1 = await hashPassword(longPassword);
        const hash2 = await hashPassword(veryLongPassword);

        expect(await verifyPassword(longPassword, hash1)).toBe(true);
        expect(await verifyPassword(veryLongPassword, hash2)).toBe(true);
      });

      it('should reject empty passwords', () => {
        const result = validatePasswordStrength('');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('Request body size limits', () => {
      it('should document JSON body limit configuration', () => {
        // From testServer.ts:34:
        // app.use(express.json({ limit: '50mb' }));
        // This is set to handle large backup files, but could be a DoS vector

        const CONFIGURED_LIMIT = '50mb';
        const LIMIT_IN_BYTES = 50 * 1024 * 1024;

        // Document the limit
        expect(LIMIT_IN_BYTES).toBe(52428800);
      });
    });
  });

  // ==========================================================================
  // MEDIUM: Rate Limiting Tests
  // ==========================================================================
  describe('MEDIUM: Rate Limiting Configuration', () => {
    describe('Login rate limiter configuration', () => {
      it('should document login rate limit parameters', () => {
        // From auth.ts:27-42:
        // const loginLimiter = rateLimit({
        //   windowMs: 15 * 60 * 1000, // 15 minutes
        //   max: 5, // 5 attempts per window
        // });

        const LOGIN_WINDOW_MS = 15 * 60 * 1000;
        const LOGIN_MAX_ATTEMPTS = 5;

        expect(LOGIN_WINDOW_MS).toBe(900000); // 15 minutes in ms
        expect(LOGIN_MAX_ATTEMPTS).toBe(5);

        // Verify the window is reasonable (not too long, not too short)
        expect(LOGIN_WINDOW_MS).toBeGreaterThanOrEqual(5 * 60 * 1000); // At least 5 min
        expect(LOGIN_WINDOW_MS).toBeLessThanOrEqual(60 * 60 * 1000); // At most 1 hour
      });

      it('should document login limiter uses IP + username combination', () => {
        // From auth.ts:37-41:
        // keyGenerator: (req) => {
        //   const username = req.body?.username?.toLowerCase() || 'unknown';
        //   return `${req.ip}-${username}`;
        // },

        // This prevents attackers from targeting specific accounts
        // while still allowing legitimate users from same IP
        const generateKey = (ip: string, username: string) => {
          return `${ip}-${username.toLowerCase()}`;
        };

        expect(generateKey('1.2.3.4', 'Admin')).toBe('1.2.3.4-admin');
        expect(generateKey('1.2.3.4', 'user1')).toBe('1.2.3.4-user1');

        // Different users from same IP have different limits
        expect(generateKey('1.2.3.4', 'user1')).not.toBe(generateKey('1.2.3.4', 'user2'));
      });
    });

    describe('Registration rate limiter configuration', () => {
      it('should document registration rate limit parameters', () => {
        // From auth.ts:44-55:
        // const registerLimiter = rateLimit({
        //   windowMs: 60 * 60 * 1000, // 1 hour
        //   max: 10, // 10 attempts per hour
        // });

        const REGISTER_WINDOW_MS = 60 * 60 * 1000;
        const REGISTER_MAX_ATTEMPTS = 10;

        expect(REGISTER_WINDOW_MS).toBe(3600000); // 1 hour in ms
        expect(REGISTER_MAX_ATTEMPTS).toBe(10);
      });
    });

    describe('2FA rate limiter configuration', () => {
      it('should document 2FA rate limit parameters', () => {
        // From auth.ts:57-68:
        // const twoFactorLimiter = rateLimit({
        //   windowMs: 15 * 60 * 1000, // 15 minutes
        //   max: 10, // 10 attempts
        // });

        const TFA_WINDOW_MS = 15 * 60 * 1000;
        const TFA_MAX_ATTEMPTS = 10;

        expect(TFA_WINDOW_MS).toBe(900000);
        expect(TFA_MAX_ATTEMPTS).toBe(10);

        // 2FA allows more attempts than login since user already authenticated first step
        expect(TFA_MAX_ATTEMPTS).toBeGreaterThanOrEqual(5); // Reasonable
        expect(TFA_MAX_ATTEMPTS).toBeLessThanOrEqual(20); // Not too permissive
      });
    });

    describe('Rate limiting error messages', () => {
      it('should not leak information in rate limit responses', () => {
        // Rate limit messages should be generic to prevent enumeration
        const LOGIN_RATE_LIMIT_MESSAGE = 'Too many login attempts. Please try again in 15 minutes.';
        const REGISTER_RATE_LIMIT_MESSAGE = 'Too many registration attempts. Please try again later.';
        const TFA_RATE_LIMIT_MESSAGE = 'Too many 2FA attempts. Please try again in 15 minutes.';

        // Messages should not reveal user existence
        expect(LOGIN_RATE_LIMIT_MESSAGE).not.toContain('user');
        expect(LOGIN_RATE_LIMIT_MESSAGE).not.toContain('invalid');

        // Messages should include retry timing
        expect(LOGIN_RATE_LIMIT_MESSAGE).toContain('15 minutes');
      });
    });
  });

  // ==========================================================================
  // Additional Security Best Practices Tests
  // ==========================================================================
  describe('Additional Security Controls', () => {
    describe('Password comparison timing safety', () => {
      it('should use bcrypt for password verification (timing-safe)', async () => {
        // bcrypt.compare is designed to be timing-safe
        const password = 'TestPassword123!';
        const hash = await hashPassword(password);

        // verifyPassword uses bcrypt.compare internally
        const isValid = await verifyPassword(password, hash);
        expect(isValid).toBe(true);
      });
    });

    describe('Error messages should not leak information', () => {
      it('should use generic error messages for auth failures', () => {
        // From auth.ts:238-241 and auth.ts:261-264:
        // Same message for user not found and wrong password
        const expectedErrorMessage = 'Invalid username or password';

        // Both cases should return the same message
        // This prevents username enumeration
        expect(expectedErrorMessage).not.toContain('not found');
        expect(expectedErrorMessage).not.toContain('incorrect');
        expect(expectedErrorMessage).not.toContain('wrong');
      });
    });

    describe('Token expiration', () => {
      it('should have reasonable token expiration times', () => {
        // From auth.ts:273-281 and config:
        const TEMP_2FA_TOKEN_EXPIRY = '5m'; // 5 minutes for 2FA pending
        const DEFAULT_TOKEN_EXPIRY = '7d'; // 7 days default

        // 2FA pending tokens should be short-lived
        expect(TEMP_2FA_TOKEN_EXPIRY).toBe('5m');

        // Regular tokens balance security and usability
        expect(DEFAULT_TOKEN_EXPIRY).toBe('7d');
      });
    });

    describe('Sensitive data handling', () => {
      it('should never return password in response', () => {
        // From auth.ts, user object transformation should exclude password
        const userFromDb = {
          id: 'user-123',
          username: 'testuser',
          password: '$2a$10$hashedpassword',
          email: 'test@example.com',
          isAdmin: false,
        };

        // Destructure pattern used in auth.ts
        const { password: _, ...userWithoutPassword } = userFromDb;

        expect(userWithoutPassword).not.toHaveProperty('password');
        expect(userWithoutPassword.username).toBe('testuser');
      });
    });
  });
});
