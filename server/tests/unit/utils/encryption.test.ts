import { vi } from 'vitest';
/**
 * Encryption Utilities Tests
 *
 * Tests for AES-256-GCM encryption/decryption functions used to protect
 * sensitive data like node configuration passwords.
 */

describe('Encryption Utilities', async () => {
  // Store original env before any changes
  const originalEnv = process.env.ENCRYPTION_KEY;

  // Set up encryption key before running tests - must be at least 32 characters
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters-for-testing-only';
  });

  afterAll(() => {
    if (originalEnv) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  // Helper to get fresh module with key already initialized
  const getEncryptionModule = async () => {
    vi.resetModules();
    const mod = await import('../../../src/utils/encryption');
    // Initialize the encryption key (async scrypt derivation)
    await mod.validateEncryptionKey();
    return mod;
  };

  // Helper to get fresh module WITHOUT auto-initializing (for validateEncryptionKey tests)
  const getUninitializedModule = async () => {
    vi.resetModules();
    return await import('../../../src/utils/encryption');
  };

  describe('encrypt', async () => {
    it('should encrypt a plaintext string', async () => {
      const { encrypt } = await getEncryptionModule();
      const plaintext = 'my secret password';
      const encrypted = encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(typeof encrypted).toBe('string');
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const { encrypt } = await getEncryptionModule();
      const plaintext = 'same text twice';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should produce output in iv:authTag:ciphertext format', async () => {
      const { encrypt } = await getEncryptionModule();
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext);

      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);

      // Each part should be valid base64
      const base64Regex = /^[A-Za-z0-9+/]+=*$/;
      expect(parts[0]).toMatch(base64Regex); // IV
      expect(parts[1]).toMatch(base64Regex); // Auth Tag
      expect(parts[2]).toMatch(base64Regex); // Ciphertext
    });

    it('should handle empty string', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const encrypted = encrypt('');
      expect(encrypted).toBeDefined();

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = 'Password with unicode symbols!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = 'A'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle JSON strings', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const jsonData = JSON.stringify({
        username: 'admin',
        password: 'secret123',
        nested: { key: 'value' },
      });
      const encrypted = encrypt(jsonData);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(jsonData);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(jsonData));
    });
  });

  describe('decrypt', async () => {
    it('should decrypt an encrypted string', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = 'my secret password';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw error for invalid format (wrong number of parts)', async () => {
      const { decrypt } = await getEncryptionModule();
      expect(() => decrypt('invalid-string')).toThrow('Invalid encrypted string format');
      expect(() => decrypt('part1:part2')).toThrow('Invalid encrypted string format');
      expect(() => decrypt('part1:part2:part3:part4')).toThrow('Invalid encrypted string format');
    });

    it('should throw error for tampered ciphertext', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext);
      const parts = encrypted.split(':');

      // Tamper with ciphertext
      const tamperedCiphertext = 'YWJj' + parts[2].substring(4); // Replace start of ciphertext
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw error for tampered auth tag', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext);
      const parts = encrypted.split(':');

      // Tamper with auth tag
      const tamperedAuthTag = 'AAAAAAAAAAAAAAAAAAAAAA==';
      const tampered = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw error for invalid base64 in IV', async () => {
      const { decrypt } = await getEncryptionModule();
      expect(() => decrypt('!!!invalid!!!:dGVzdA==:dGVzdA==')).toThrow();
    });
  });

  describe('isEncrypted', async () => {
    it('should return true for properly formatted encrypted strings', async () => {
      const { encrypt, isEncrypted } = await getEncryptionModule();
      const encrypted = encrypt('test');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for null or undefined', async () => {
      const { isEncrypted } = await getEncryptionModule();
      expect(isEncrypted(null as any)).toBe(false);
      expect(isEncrypted(undefined as any)).toBe(false);
    });

    it('should return false for empty string', async () => {
      const { isEncrypted } = await getEncryptionModule();
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for plaintext', async () => {
      const { isEncrypted } = await getEncryptionModule();
      expect(isEncrypted('plaintext password')).toBe(false);
      expect(isEncrypted('simple string')).toBe(false);
    });

    it('should return false for strings with wrong number of colons', async () => {
      const { isEncrypted } = await getEncryptionModule();
      expect(isEncrypted('no:colons:here:extra')).toBe(false);
      expect(isEncrypted('only:one')).toBe(false);
    });

    it('should return false for non-base64 parts', async () => {
      const { isEncrypted } = await getEncryptionModule();
      expect(isEncrypted('invalid!!!:invalid!!!:invalid!!!')).toBe(false);
    });

    it('should return false for empty parts', async () => {
      const { isEncrypted } = await getEncryptionModule();
      expect(isEncrypted('::dGVzdA==')).toBe(false);
      expect(isEncrypted('dGVzdA==::')).toBe(false);
    });

    it('should return true for valid base64 format with colons', async () => {
      const { isEncrypted } = await getEncryptionModule();
      // Valid base64 parts
      expect(isEncrypted('dGVzdA==:dGVzdA==:dGVzdA==')).toBe(true);
    });
  });

  describe('decryptIfEncrypted', async () => {
    it('should decrypt encrypted values', async () => {
      const { encrypt, decryptIfEncrypted } = await getEncryptionModule();
      const plaintext = 'secret password';
      const encrypted = encrypt(plaintext);

      const result = decryptIfEncrypted(encrypted);
      expect(result).toBe(plaintext);
    });

    it('should return plaintext values unchanged', async () => {
      const { decryptIfEncrypted } = await getEncryptionModule();
      const plaintext = 'not encrypted';
      const result = decryptIfEncrypted(plaintext);

      expect(result).toBe(plaintext);
    });

    it('should handle legacy unencrypted passwords', async () => {
      const { decryptIfEncrypted } = await getEncryptionModule();
      // Simulates backward compatibility with pre-encryption passwords
      const legacyPassword = 'old-plaintext-password';
      const result = decryptIfEncrypted(legacyPassword);

      expect(result).toBe(legacyPassword);
    });

    it('should handle strings that look like encrypted but are not valid', async () => {
      const { isEncrypted, decryptIfEncrypted } = await getEncryptionModule();
      // This has the format but invalid content
      const fakeEncrypted = 'YWJj:ZGVm:Z2hp';

      // isEncrypted returns true because format matches
      expect(isEncrypted(fakeEncrypted)).toBe(true);

      // But decryption will fail, so this should throw
      expect(() => decryptIfEncrypted(fakeEncrypted)).toThrow();
    });
  });

  describe('initialization guards', async () => {
    it('throws when encrypt is used before validateEncryptionKey', async () => {
      const { encrypt } = await getUninitializedModule();
      expect(() => encrypt('secret')).toThrow('Encryption key not initialized');
    });
  });

  describe('validateEncryptionKey', async () => {
    it('should not throw when encryption key is valid', async () => {
      const { validateEncryptionKey } = await getUninitializedModule();
      await expect(validateEncryptionKey()).resolves.not.toThrow();
    });

    it('should throw error when ENCRYPTION_KEY is not set', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      try {
        const { validateEncryptionKey } = await getUninitializedModule();
        await expect(validateEncryptionKey()).rejects.toThrow(
          'ENCRYPTION_KEY environment variable must be set and at least 32 characters long'
        );
      } finally {
        process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('should throw error when ENCRYPTION_KEY is too short (< 32 chars)', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'short-key-only-20-chars';

      try {
        const { validateEncryptionKey } = await getUninitializedModule();
        await expect(validateEncryptionKey()).rejects.toThrow(
          'ENCRYPTION_KEY environment variable must be set and at least 32 characters long'
        );
      } finally {
        process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('reuses cached key on repeated validation with same salt', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      const { validateEncryptionKey } = await getUninitializedModule();

      await expect(validateEncryptionKey()).resolves.not.toThrow();
      process.env.ENCRYPTION_KEY = 'short';
      await expect(validateEncryptionKey()).resolves.not.toThrow();

      process.env.ENCRYPTION_KEY = originalKey;
    });
  });

  describe('encryption key validation', async () => {
    it('should use consistent key derivation for encrypt/decrypt cycle', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      // Verify that multiple encrypt/decrypt cycles work
      for (let i = 0; i < 5; i++) {
        const plaintext = `test message ${i}`;
        const encrypted = encrypt(plaintext);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });
  });

  describe('encryption salt configuration', async () => {
    it('should use default salt and warn when ENCRYPTION_SALT is not set', async () => {
      const originalSalt = process.env.ENCRYPTION_SALT;
      delete process.env.ENCRYPTION_SALT;

      // Mock console.warn to capture warnings
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        // Get fresh module without salt
        const { encrypt, decrypt } = await getEncryptionModule();
        const plaintext = 'test with default salt';
        const encrypted = encrypt(plaintext);
        const decrypted = decrypt(encrypted);

        expect(decrypted).toBe(plaintext);
        // Verify security warning was logged
        expect(warnSpy).toHaveBeenCalled();
        expect(warnSpy.mock.calls.some(call =>
          call[0]?.includes?.('SECURITY WARNING') || call[0]?.includes?.('ENCRYPTION_SALT')
        )).toBe(true);
      } finally {
        warnSpy.mockRestore();
        if (originalSalt) {
          process.env.ENCRYPTION_SALT = originalSalt;
        }
      }
    });

    it('decrypts default-salt ciphertext after legacy default salt is materialized', async () => {
      const originalSalt = process.env.ENCRYPTION_SALT;
      delete process.env.ENCRYPTION_SALT;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const legacyModule = await getEncryptionModule();
        const plaintext = 'legacy two factor secret';
        const encrypted = legacyModule.encrypt(plaintext);

        process.env.ENCRYPTION_SALT = 'sanctuary-node-config';
        const upgradedModule = await getEncryptionModule();

        expect(upgradedModule.decrypt(encrypted)).toBe(plaintext);
      } finally {
        warnSpy.mockRestore();
        if (originalSalt) {
          process.env.ENCRYPTION_SALT = originalSalt;
        } else {
          delete process.env.ENCRYPTION_SALT;
        }
      }
    });

    it('should use custom ENCRYPTION_SALT when set', async () => {
      const originalSalt = process.env.ENCRYPTION_SALT;
      process.env.ENCRYPTION_SALT = 'custom-test-salt-value';

      try {
        // Get fresh module with custom salt
        const { encrypt, decrypt } = await getEncryptionModule();
        const plaintext = 'test with custom salt';
        const encrypted = encrypt(plaintext);
        const decrypted = decrypt(encrypted);

        expect(decrypted).toBe(plaintext);
      } finally {
        if (originalSalt) {
          process.env.ENCRYPTION_SALT = originalSalt;
        } else {
          delete process.env.ENCRYPTION_SALT;
        }
      }
    });

    it('should invalidate key cache when salt changes', async () => {
      const originalSalt = process.env.ENCRYPTION_SALT;

      try {
        // Set initial salt and encrypt
        process.env.ENCRYPTION_SALT = 'initial-salt-value';
        const module1 = await getEncryptionModule();
        const plaintext = 'test cache invalidation';
        const encrypted = module1.encrypt(plaintext);

        // Verify decryption works with same salt
        expect(module1.decrypt(encrypted)).toBe(plaintext);

        // Change salt - this should invalidate the cache and use new key derivation
        process.env.ENCRYPTION_SALT = 'different-salt-value';

        // Get fresh module with new salt - decryption should fail because
        // the data was encrypted with a different derived key
        const module2 = await getEncryptionModule();
        expect(() => module2.decrypt(encrypted)).toThrow();
      } finally {
        if (originalSalt) {
          process.env.ENCRYPTION_SALT = originalSalt;
        } else {
          delete process.env.ENCRYPTION_SALT;
        }
      }
    });

    it('should invalidate key cache within same module when salt changes and key is re-initialized', async () => {
      const originalSalt = process.env.ENCRYPTION_SALT;

      try {
        // Set initial salt
        process.env.ENCRYPTION_SALT = 'first-salt-for-cache-test';
        const encryptionModule = await getEncryptionModule();

        // Encrypt with first salt - this caches the key
        const plaintext = 'test cache invalidation within module';
        const encrypted = encryptionModule.encrypt(plaintext);

        // Verify decryption works with same salt (key is cached)
        expect(encryptionModule.decrypt(encrypted)).toBe(plaintext);

        // Change salt and re-initialize the key
        // In the async scrypt design, salt changes require re-initialization
        process.env.ENCRYPTION_SALT = 'second-salt-for-cache-test';
        await encryptionModule.validateEncryptionKey();

        // Decryption should fail because data was encrypted with different derived key
        expect(() => encryptionModule.decrypt(encrypted)).toThrow();
      } finally {
        if (originalSalt) {
          process.env.ENCRYPTION_SALT = originalSalt;
        } else {
          delete process.env.ENCRYPTION_SALT;
        }
      }
    });
  });

  describe('edge cases and security', async () => {
    it('should handle newlines in plaintext', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = 'line1\nline2\r\nline3';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle null bytes in plaintext', async () => {
      const { encrypt, decrypt } = await getEncryptionModule();
      const plaintext = 'before\x00after';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce deterministic output length based on input', async () => {
      const { encrypt } = await getEncryptionModule();
      // The ciphertext length should correlate with plaintext length
      const short = encrypt('a');
      const medium = encrypt('a'.repeat(100));
      const long = encrypt('a'.repeat(1000));

      expect(short.length).toBeLessThan(medium.length);
      expect(medium.length).toBeLessThan(long.length);
    });
  });
});
