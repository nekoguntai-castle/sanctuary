/**
 * JWT Utilities Tests
 *
 * Tests for JWT token creation, verification, and utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
const mockConfig = vi.hoisted(() => ({
  jwtSecret: 'test-secret-key-for-testing-purposes-only',
  jwtExpiresIn: '1h',
  jwtRefreshExpiresIn: '7d',
}));

vi.mock('../../../src/config', () => ({
  default: mockConfig,
}));

// Mock token revocation
const mockIsTokenRevoked = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock('../../../src/services/tokenRevocation', () => ({
  isTokenRevoked: mockIsTokenRevoked,
}));

import jwt from 'jsonwebtoken';
import {
  TokenAudience,
  generateToken,
  generate2FAToken,
  generateRefreshToken,
  verifyToken,
  verify2FAToken,
  verifyRefreshToken,
  decodeToken,
  extractTokenFromHeader,
  getTokenExpiration,
  hashToken,
} from '../../../src/utils/jwt';

describe('JWT Utilities', () => {
  const mockPayload = {
    userId: 'user-123',
    username: 'testuser',
    isAdmin: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTokenRevoked.mockResolvedValue(false);
  });

  describe('TokenAudience', () => {
    it('should have ACCESS audience', () => {
      expect(TokenAudience.ACCESS).toBe('sanctuary:access');
    });

    it('should have REFRESH audience', () => {
      expect(TokenAudience.REFRESH).toBe('sanctuary:refresh');
    });

    it('should have TWO_FACTOR audience', () => {
      expect(TokenAudience.TWO_FACTOR).toBe('sanctuary:2fa');
    });
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateToken(mockPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include payload data', () => {
      const token = generateToken(mockPayload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.userId).toBe('user-123');
      expect(decoded.username).toBe('testuser');
      expect(decoded.isAdmin).toBe(false);
    });

    it('should include jti claim', () => {
      const token = generateToken(mockPayload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.jti).toBeDefined();
      expect(typeof decoded.jti).toBe('string');
    });

    it('should include ACCESS audience', () => {
      const token = generateToken(mockPayload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.aud).toBe(TokenAudience.ACCESS);
    });

    it('should use default expiration', () => {
      const token = generateToken(mockPayload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.exp).toBeDefined();
    });

    it('should accept custom expiration', () => {
      const token = generateToken(mockPayload, '5m');
      const decoded = jwt.decode(token) as any;

      // Verify token is valid
      expect(decoded.exp).toBeDefined();
    });

    it('should generate unique tokens', () => {
      const token1 = generateToken(mockPayload);
      const token2 = generateToken(mockPayload);

      expect(token1).not.toBe(token2);
    });
  });

  describe('generate2FAToken', () => {
    it('should generate a valid token', () => {
      const token = generate2FAToken(mockPayload);

      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include pending2FA flag', () => {
      const token = generate2FAToken(mockPayload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.pending2FA).toBe(true);
    });

    it('should include TWO_FACTOR audience', () => {
      const token = generate2FAToken(mockPayload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.aud).toBe(TokenAudience.TWO_FACTOR);
    });

    it('should have short expiration', () => {
      const token = generate2FAToken(mockPayload);
      const decoded = jwt.decode(token) as any;

      // Should expire in ~5 minutes
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = decoded.exp - now;

      expect(expiresIn).toBeLessThanOrEqual(300); // 5 minutes
      expect(expiresIn).toBeGreaterThan(0);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid token', () => {
      const token = generateRefreshToken('user-123');

      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include userId', () => {
      const token = generateRefreshToken('user-123');
      const decoded = jwt.decode(token) as any;

      expect(decoded.userId).toBe('user-123');
    });

    it('should include REFRESH audience', () => {
      const token = generateRefreshToken('user-123');
      const decoded = jwt.decode(token) as any;

      expect(decoded.aud).toBe(TokenAudience.REFRESH);
    });

    it('should include refresh type', () => {
      const token = generateRefreshToken('user-123');
      const decoded = jwt.decode(token) as any;

      expect(decoded.type).toBe('refresh');
    });

    it('should include jti claim', () => {
      const token = generateRefreshToken('user-123');
      const decoded = jwt.decode(token) as any;

      expect(decoded.jti).toBeDefined();
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', async () => {
      const token = generateToken(mockPayload);
      const decoded = await verifyToken(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.username).toBe('testuser');
    });

    it('should verify token with expected audience', async () => {
      const token = generateToken(mockPayload);
      const decoded = await verifyToken(token, TokenAudience.ACCESS);

      expect(decoded.userId).toBe('user-123');
    });

    it('should reject pending 2FA claims for access audience tokens', async () => {
      const token = jwt.sign(
        {
          ...mockPayload,
          pending2FA: true,
          aud: TokenAudience.ACCESS,
        },
        mockConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      await expect(verifyToken(token, TokenAudience.ACCESS)).rejects.toThrow('2FA verification required');
    });

    it('should reject malformed access payloads after signature verification', async () => {
      const token = jwt.sign(
        {
          userId: 'user-123',
          username: 'testuser',
          isAdmin: 'false',
          aud: TokenAudience.ACCESS,
        },
        mockConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      await expect(verifyToken(token, TokenAudience.ACCESS)).rejects.toThrow('Invalid or expired token');
    });

    it('should reject empty user ids after signature verification', async () => {
      const token = jwt.sign(
        {
          userId: '',
          username: 'testuser',
          isAdmin: false,
          aud: TokenAudience.ACCESS,
        },
        mockConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      await expect(verifyToken(token, TokenAudience.ACCESS)).rejects.toThrow('Invalid or expired token');
    });

    it('should reject missing user ids after signature verification', async () => {
      const token = jwt.sign(
        {
          username: 'testuser',
          isAdmin: false,
          aud: TokenAudience.ACCESS,
        },
        mockConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      await expect(verifyToken(token, TokenAudience.ACCESS)).rejects.toThrow('Invalid or expired token');
    });

    it('should reject non-object JWT payloads after signature verification', async () => {
      const verifySpy = vi.spyOn(jwt, 'verify').mockReturnValue('not-an-object' as never);

      await expect(verifyToken('string-payload-token')).rejects.toThrow('Invalid or expired token');

      verifySpy.mockRestore();
    });

    it('should throw for wrong audience', async () => {
      const token = generateToken(mockPayload);

      await expect(verifyToken(token, TokenAudience.REFRESH)).rejects.toThrow('Invalid token');
    });

    it('should throw for invalid token', async () => {
      await expect(verifyToken('invalid-token')).rejects.toThrow('Invalid token');
    });

    it('should throw for expired token', async () => {
      const token = generateToken(mockPayload, '-1s'); // Already expired

      await expect(verifyToken(token)).rejects.toThrow('Token expired');
    });

    it('should throw for revoked token', async () => {
      mockIsTokenRevoked.mockResolvedValue(true);
      const token = generateToken(mockPayload);

      // The error message is generic to avoid leaking revocation info
      await expect(verifyToken(token)).rejects.toThrow('Invalid or expired token');
    });

    it('should check token revocation', async () => {
      const token = generateToken(mockPayload);
      await verifyToken(token);

      expect(mockIsTokenRevoked).toHaveBeenCalled();
    });
  });

  describe('verify2FAToken', () => {
    it('should verify valid 2FA token', async () => {
      const token = generate2FAToken(mockPayload);
      const decoded = await verify2FAToken(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.pending2FA).toBe(true);
    });

    it('should throw for non-2FA token', async () => {
      const token = generateToken(mockPayload);

      await expect(verify2FAToken(token)).rejects.toThrow();
    });

    it('should throw for access token with wrong audience', async () => {
      const token = generateToken(mockPayload);

      await expect(verify2FAToken(token)).rejects.toThrow('Invalid token');
    });

    it('should reject token missing pending2FA flag even with 2FA audience', async () => {
      const token = jwt.sign(
        {
          ...mockPayload,
          aud: TokenAudience.TWO_FACTOR,
        },
        mockConfig.jwtSecret,
        { expiresIn: '5m' }
      );

      await expect(verify2FAToken(token)).rejects.toThrow('Invalid 2FA token');
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify valid refresh token', async () => {
      const token = generateRefreshToken('user-123');
      const decoded = await verifyRefreshToken(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.type).toBe('refresh');
    });

    it('should throw for access token', async () => {
      const token = generateToken(mockPayload);

      await expect(verifyRefreshToken(token)).rejects.toThrow('Invalid refresh token');
    });

    it('should throw for revoked refresh token', async () => {
      mockIsTokenRevoked.mockResolvedValue(true);
      const token = generateRefreshToken('user-123');

      // The error message is generic to avoid leaking revocation info
      await expect(verifyRefreshToken(token)).rejects.toThrow('Invalid refresh token');
    });

    it('should throw for invalid token', async () => {
      await expect(verifyRefreshToken('invalid')).rejects.toThrow('Invalid refresh token');
    });

    it('should throw for refresh audience token with wrong type', async () => {
      const token = jwt.sign(
        {
          userId: 'user-123',
          jti: 'jti-wrong-type',
          aud: TokenAudience.REFRESH,
          type: 'access',
        },
        mockConfig.jwtSecret,
        { expiresIn: '7d' }
      );

      await expect(verifyRefreshToken(token)).rejects.toThrow('Invalid refresh token');
    });

    it('should throw specific message for expired refresh token', async () => {
      const token = jwt.sign(
        {
          userId: 'user-123',
          jti: 'jti-expired-refresh',
          aud: TokenAudience.REFRESH,
          type: 'refresh',
        },
        mockConfig.jwtSecret,
        { expiresIn: '-1s' }
      );

      await expect(verifyRefreshToken(token)).rejects.toThrow('Refresh token expired');
    });
  });

  describe('decodeToken', () => {
    it('should decode valid token without verification', () => {
      const token = generateToken(mockPayload);
      const decoded = decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe('user-123');
    });

    it('should return null for invalid token', () => {
      const decoded = decodeToken('invalid-token');

      expect(decoded).toBeNull();
    });

    it('should decode expired token', () => {
      const token = generateToken(mockPayload, '-1s');
      const decoded = decodeToken(token);

      // Should still decode even if expired
      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe('user-123');
    });

    it('should include exp claim', () => {
      const token = generateToken(mockPayload);
      const decoded = decodeToken(token);

      expect(decoded?.exp).toBeDefined();
    });

    it('should return null when jwt.decode throws', () => {
      const decodeSpy = vi.spyOn(jwt, 'decode').mockImplementation(() => {
        throw new Error('decode failed');
      });

      expect(decodeToken('forced-error-token')).toBeNull();

      decodeSpy.mockRestore();
    });
  });

  describe('extractTokenFromHeader', () => {
    it('should extract token from Bearer header', () => {
      const token = extractTokenFromHeader('Bearer abc123');

      expect(token).toBe('abc123');
    });

    it('should return null for missing header', () => {
      const token = extractTokenFromHeader(undefined);

      expect(token).toBeNull();
    });

    it('should return null for empty header', () => {
      const token = extractTokenFromHeader('');

      expect(token).toBeNull();
    });

    it('should return null for non-Bearer auth', () => {
      const token = extractTokenFromHeader('Basic abc123');

      expect(token).toBeNull();
    });

    it('should return null for malformed header', () => {
      const token = extractTokenFromHeader('Bearer');

      expect(token).toBeNull();
    });

    it('should return null for header with extra parts', () => {
      const token = extractTokenFromHeader('Bearer abc 123');

      expect(token).toBeNull();
    });

    it('should handle lowercase Bearer', () => {
      // Should be case-sensitive
      const token = extractTokenFromHeader('bearer abc123');

      expect(token).toBeNull();
    });
  });

  describe('getTokenExpiration', () => {
    it('should return expiration date for valid token', () => {
      const token = generateToken(mockPayload);
      const expiration = getTokenExpiration(token);

      expect(expiration).toBeInstanceOf(Date);
      expect(expiration!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return null for invalid token', () => {
      const expiration = getTokenExpiration('invalid-token');

      expect(expiration).toBeNull();
    });

    it('should return null for token without exp', () => {
      // Create a token without expiration (unusual but possible)
      const tokenWithoutExp = jwt.sign({ userId: '123' }, mockConfig.jwtSecret);
      const expiration = getTokenExpiration(tokenWithoutExp);

      expect(expiration).toBeNull();
    });
  });

  describe('hashToken', () => {
    it('should return SHA256 hash', () => {
      const hash = hashToken('test-token');

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(64); // SHA256 hex is 64 chars
    });

    it('should produce consistent hash for same input', () => {
      const hash1 = hashToken('same-token');
      const hash2 = hashToken('same-token');

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different input', () => {
      const hash1 = hashToken('token-1');
      const hash2 = hashToken('token-2');

      expect(hash1).not.toBe(hash2);
    });

    it('should hash empty string', () => {
      const hash = hashToken('');

      expect(hash).toBeDefined();
      expect(hash).toHaveLength(64);
    });
  });

  describe('token payload preservation', () => {
    it('should preserve isAdmin flag', () => {
      const adminPayload = { ...mockPayload, isAdmin: true };
      const token = generateToken(adminPayload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.isAdmin).toBe(true);
    });

    it('should not carry pending2FA into access tokens', () => {
      const payload2FA = { ...mockPayload, pending2FA: true };
      const token = generateToken(payload2FA);
      const decoded = jwt.decode(token) as any;

      expect(decoded.pending2FA).toBeUndefined();
    });

    it('should preserve usingDefaultPassword flag', () => {
      const payloadDefault = { ...mockPayload, usingDefaultPassword: true };
      const token = generateToken(payloadDefault);
      const decoded = jwt.decode(token) as any;

      expect(decoded.usingDefaultPassword).toBe(true);
    });
  });
});
