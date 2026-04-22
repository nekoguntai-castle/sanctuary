/**
 * Redact Utilities Tests
 *
 * Tests for sensitive data redaction functions used to prevent
 * accidental exposure of credentials, keys, and personal information
 * in logs, error messages, and API responses.
 */

import {
  redact,
  redactObject,
  redactDeep,
  safeError,
  mask,
  REDACTED,
} from '../../../src/utils/redact';

describe('Redact Utilities', () => {
  describe('redact', () => {
    it('should return REDACTED for non-null values', () => {
      expect(redact('password123')).toBe('[REDACTED]');
      expect(redact('secret')).toBe('[REDACTED]');
      expect(redact(123)).toBe('[REDACTED]');
    });

    it('should return NOT SET for null, undefined, or empty values', () => {
      expect(redact(null)).toBe('[NOT SET]');
      expect(redact(undefined)).toBe('[NOT SET]');
      expect(redact('')).toBe('[NOT SET]');
    });

    it('should hide presence when showPresence is false', () => {
      expect(redact(null, false)).toBe('[REDACTED]');
      expect(redact(undefined, false)).toBe('[REDACTED]');
      expect(redact('', false)).toBe('[REDACTED]');
      expect(redact('secret', false)).toBe('[REDACTED]');
    });

    it('should handle boolean values', () => {
      expect(redact(true)).toBe('[REDACTED]');
      expect(redact(false)).toBe('[REDACTED]');
    });

    it('should handle objects', () => {
      expect(redact({ key: 'value' })).toBe('[REDACTED]');
      expect(redact([])).toBe('[REDACTED]');
    });
  });

  describe('redactObject', () => {
    it('should redact known sensitive fields', () => {
      const input = {
        username: 'john',
        password: 'secret123',
        email: 'john@example.com',
      };

      const result = redactObject(input);

      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
      expect(result.email).toBe('john@example.com');
    });

    it('should redact multiple sensitive field types', () => {
      const input = {
        token: 'abc123',
        apiKey: 'key-123',
        api_secret: 'secret',
        privateKey: 'priv-key',
        mnemonic: 'word1 word2 word3',
        xpub: 'xpub123...',
        seed: 'seed-phrase',
        passphrase: 'my-passphrase',
      };

      const result = redactObject(input);

      expect(result.token).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.api_secret).toBe('[REDACTED]');
      expect(result.privateKey).toBe('[REDACTED]');
      expect(result.mnemonic).toBe('[REDACTED]');
      expect(result.xpub).toBe('[REDACTED]');
      expect(result.seed).toBe('[REDACTED]');
      expect(result.passphrase).toBe('[REDACTED]');
    });

    it('should handle case-insensitive field matching', () => {
      const input = {
        PASSWORD: 'secret1',
        Token: 'token1',
        API_KEY: 'key1',
        ApiSecret: 'secret2',
      };

      const result = redactObject(input);

      expect(result.PASSWORD).toBe('[REDACTED]');
      expect(result.Token).toBe('[REDACTED]');
      expect(result.API_KEY).toBe('[REDACTED]');
      expect(result.ApiSecret).toBe('[REDACTED]');
    });

    it('should recursively redact nested objects', () => {
      const input = {
        user: {
          name: 'john',
          settings: {
            password: 'secret',
          },
        },
      };

      const result = redactObject(input);

      expect((result.user as any).name).toBe('john');
      // 'settings' is not a sensitive field, so it should be an object
      expect((result.user as any).settings.password).toBe('[REDACTED]');
    });

    it('should handle additional custom fields', () => {
      const input = {
        customSecret: 'my-secret',
        normalField: 'visible',
      };

      const result = redactObject(input, ['customSecret']);

      expect(result.customSecret).toBe('[REDACTED]');
      expect(result.normalField).toBe('visible');
    });

    it('should handle null and undefined input', () => {
      expect(redactObject(null as any)).toBe(null);
      expect(redactObject(undefined as any)).toBe(undefined);
    });

    it('should preserve non-sensitive arrays', () => {
      const input = {
        items: [1, 2, 3],
        password: 'secret',
      };

      const result = redactObject(input);

      expect(result.items).toEqual([1, 2, 3]);
      expect(result.password).toBe('[REDACTED]');
    });

    it('should handle empty objects', () => {
      expect(redactObject({})).toEqual({});
    });

    it('should redact 2FA-related fields', () => {
      const input = {
        otp: '123456',
        totp: '654321',
        backupCode: 'backup-123',
        backup_code: 'backup-456',
        recoveryCode: 'recovery-123',
      };

      const result = redactObject(input);

      expect(result.otp).toBe('[REDACTED]');
      expect(result.totp).toBe('[REDACTED]');
      expect(result.backupCode).toBe('[REDACTED]');
      expect(result.backup_code).toBe('[REDACTED]');
      expect(result.recoveryCode).toBe('[REDACTED]');
    });

    it('should redact authorization-related fields', () => {
      const input = {
        authorization: 'Bearer token123',
        bearer: 'token456',
        jwt: 'eyJhbGciOiJIUzI1NiJ9...',
        auth: 'auth-value',
      };

      const result = redactObject(input);

      expect(result.authorization).toBe('[REDACTED]');
      expect(result.bearer).toBe('[REDACTED]');
      expect(result.jwt).toBe('[REDACTED]');
      expect(result.auth).toBe('[REDACTED]');
    });

    it('should preserve prototype-like keys as own properties', () => {
      const input = JSON.parse(
        '{"__proto__":{"password":"secret"},"constructor":{"token":"abc"},"safe":"ok"}'
      );

      const result = redactObject(input);

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({
        password: '[REDACTED]',
      });
      expect(result.constructor).toEqual({ token: '[REDACTED]' });
      expect(result.safe).toBe('ok');
    });
  });

  describe('redactDeep', () => {
    it('should deeply redact nested objects', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              password: 'deep-secret',
              visible: 'ok',
            },
          },
        },
      };

      const result = redactDeep(input);

      expect((result as any).level1.level2.level3.password).toBe('[REDACTED]');
      expect((result as any).level1.level2.level3.visible).toBe('ok');
    });

    it('should handle circular references', () => {
      const obj: any = { name: 'test', password: 'secret' };
      obj.self = obj;

      const result = redactDeep(obj);

      expect(result.name).toBe('test');
      expect(result.password).toBe('[REDACTED]');
      expect(result.self).toBe('[CIRCULAR]');
    });

    it('should respect max depth', () => {
      const input = {
        l1: { l2: { l3: { l4: { l5: { l6: { password: 'deep' } } } } } },
      };

      const result = redactDeep(input, 3);

      expect((result as any).l1.l2.l3.l4).toBe('[MAX DEPTH]');
    });

    it('should handle arrays at any depth', () => {
      const input = {
        users: [
          { name: 'user1', password: 'pass1' },
          { name: 'user2', password: 'pass2' },
        ],
      };

      const result = redactDeep(input);

      expect((result as any).users[0].name).toBe('user1');
      expect((result as any).users[0].password).toBe('[REDACTED]');
      expect((result as any).users[1].name).toBe('user2');
      expect((result as any).users[1].password).toBe('[REDACTED]');
    });

    it('should handle null and undefined values', () => {
      const input = {
        nullValue: null,
        undefinedValue: undefined,
        password: 'secret',
      };

      const result = redactDeep(input);

      expect(result.nullValue).toBe(null);
      expect(result.undefinedValue).toBe(undefined);
      expect(result.password).toBe('[REDACTED]');
    });

    it('should handle primitive values', () => {
      expect(redactDeep('string')).toBe('string');
      expect(redactDeep(123)).toBe(123);
      expect(redactDeep(true)).toBe(true);
      expect(redactDeep(null)).toBe(null);
    });

    it('should deeply preserve prototype-like keys as own properties', () => {
      const input = JSON.parse('{"__proto__":{"token":"secret"},"safe":"ok"}');

      const result = redactDeep(input) as Record<string, unknown>;

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({
        token: '[REDACTED]',
      });
      expect(result.safe).toBe('ok');
    });
  });

  describe('safeError', () => {
    it('should extract message and name from Error objects', () => {
      const error = new Error('Something went wrong');
      const result = safeError(error);

      expect(result.message).toBe('Something went wrong');
      expect(result.name).toBe('Error');
    });

    it('should extract message from TypeError', () => {
      const error = new TypeError('Invalid type');
      const result = safeError(error);

      expect(result.message).toBe('Invalid type');
      expect(result.name).toBe('TypeError');
    });

    it('should handle string errors', () => {
      const result = safeError('String error message');

      expect(result.message).toBe('String error message');
      expect(result.name).toBeUndefined();
    });

    it('should handle non-Error objects', () => {
      const result = safeError({ code: 500, text: 'Server Error' });

      expect(result.message).toBe('[object Object]');
    });

    it('should handle null and undefined', () => {
      expect(safeError(null).message).toBe('null');
      expect(safeError(undefined).message).toBe('undefined');
    });

    it('should handle numbers', () => {
      expect(safeError(404).message).toBe('404');
      expect(safeError(0).message).toBe('0');
    });

    it('should include stack in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Test error');
      const result = safeError(error);

      expect(result.stack).toBeDefined();
      expect(result.stack).toContain('Error: Test error');

      process.env.NODE_ENV = originalEnv;
    });

    it('should exclude stack in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Test error');
      const result = safeError(error);

      expect(result.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('mask', () => {
    it('should mask middle of string showing first and last 4 chars', () => {
      expect(mask('sk_live_abc123xyz789')).toBe('sk_l***z789');
    });

    it('should return REDACTED for short strings', () => {
      expect(mask('short')).toBe('[REDACTED]');
      expect(mask('12345678')).toBe('[REDACTED]');
    });

    it('should handle custom visible character count', () => {
      expect(mask('sk_live_abc123xyz789', 2)).toBe('sk***89');
      expect(mask('abcdefghij', 3)).toBe('abc***hij');
    });

    it('should return REDACTED for empty or null strings', () => {
      expect(mask('')).toBe('[REDACTED]');
      expect(mask(null as any)).toBe('[REDACTED]');
      expect(mask(undefined as any)).toBe('[REDACTED]');
    });

    it('should work with exactly enough characters', () => {
      // With default visibleChars=4, needs > 8 chars
      expect(mask('123456789')).toBe('1234***6789');
    });
  });

  describe('REDACTED constant', () => {
    it('should be the expected string', () => {
      expect(REDACTED).toBe('[REDACTED]');
    });
  });

  describe('sensitive field patterns', () => {
    it('should match password variations', () => {
      const input = {
        userPassword: 'pass1',
        password_hash: 'pass2',
        PASSWORD_ENCRYPTED: 'pass3',
      };

      const result = redactObject(input);

      expect(result.userPassword).toBe('[REDACTED]');
      expect(result.password_hash).toBe('[REDACTED]');
      expect(result.PASSWORD_ENCRYPTED).toBe('[REDACTED]');
    });

    it('should match secret variations', () => {
      const input = {
        clientSecret: 'secret1',
        secret_key: 'secret2',
        AWS_SECRET: 'secret3',
      };

      const result = redactObject(input);

      expect(result.clientSecret).toBe('[REDACTED]');
      expect(result.secret_key).toBe('[REDACTED]');
      expect(result.AWS_SECRET).toBe('[REDACTED]');
    });

    it('should match token variations', () => {
      const input = {
        accessToken: 'token1',
        access_token: 'token2',
        refreshToken: 'token3',
      };

      const result = redactObject(input);

      expect(result.accessToken).toBe('[REDACTED]');
      expect(result.access_token).toBe('[REDACTED]');
      expect(result.refreshToken).toBe('[REDACTED]');
    });

    it('should match API key variations', () => {
      const input = {
        apiKey: 'key1',
        api_key: 'key2',
        'API-KEY': 'key3',
      };

      const result = redactObject(input);

      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.api_key).toBe('[REDACTED]');
      expect(result['API-KEY']).toBe('[REDACTED]');
    });

    it('should match private key patterns', () => {
      const input = {
        privateKey: 'privkey1',
        private_key: 'privkey2',
        PrivateKeyPEM: 'privkey3',
      };

      const result = redactObject(input);

      expect(result.privateKey).toBe('[REDACTED]');
      expect(result.private_key).toBe('[REDACTED]');
      expect(result.PrivateKeyPEM).toBe('[REDACTED]');
    });

    it('should match Bitcoin-specific sensitive fields', () => {
      const input = {
        xprv: 'xprv123...',
        XPRV: 'xprv456...',
        seedPhrase: 'word1 word2...',
      };

      const result = redactObject(input);

      expect(result.xprv).toBe('[REDACTED]');
      expect(result.XPRV).toBe('[REDACTED]');
      expect(result.seedPhrase).toBe('[REDACTED]');
    });
  });
});
