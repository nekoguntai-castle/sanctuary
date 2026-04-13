import { describe, expect, it } from 'vitest';
import {
  CIRCULAR,
  MAX_DEPTH,
  NOT_SET,
  REDACTED,
  isSensitiveField,
  redact,
  redactDeep,
  stringifyRedacted,
} from '../../shared/utils/redact';

describe('shared redaction utilities', () => {
  describe('isSensitiveField', () => {
    it('matches exact sensitive fields case-insensitively', () => {
      const fields = [
        'password',
        'secret',
        'token',
        'apikey',
        'api_key',
        'apisecret',
        'api_secret',
        'privatekey',
        'private_key',
        'encryptionkey',
        'encryption_key',
        'jwt',
        'bearer',
        'authorization',
        'auth',
        'credential',
        'credentials',
        'xpub',
        'xprv',
        'seed',
        'mnemonic',
        'passphrase',
        'pin',
        'otp',
        'totp',
        'backupcode',
        'backup_code',
        'recoverycode',
        'recovery_code',
      ];

      for (const field of fields) {
        expect(isSensitiveField(field)).toBe(true);
        expect(isSensitiveField(field.toUpperCase())).toBe(true);
      }
    });

    it('matches sensitive field patterns without redacting unrelated keys', () => {
      expect(isSensitiveField('accessToken')).toBe(true);
      expect(isSensitiveField('client-secret')).toBe(true);
      expect(isSensitiveField('API-KEY')).toBe(true);
      expect(isSensitiveField('privateKeyPem')).toBe(true);
      expect(isSensitiveField('encryption-key-id')).toBe(true);
      expect(isSensitiveField('seedPhrase')).toBe(true);
      expect(isSensitiveField('publicKey')).toBe(false);
      expect(isSensitiveField('username')).toBe(false);
    });
  });

  describe('redact', () => {
    it('redacts set values and marks missing values when presence is visible', () => {
      expect(redact('secret')).toBe(REDACTED);
      expect(redact(123)).toBe(REDACTED);
      expect(redact(null)).toBe(NOT_SET);
      expect(redact(undefined)).toBe(NOT_SET);
      expect(redact('')).toBe(NOT_SET);
    });

    it('hides presence when requested', () => {
      expect(redact(null, false)).toBe(REDACTED);
      expect(redact(undefined, false)).toBe(REDACTED);
      expect(redact('', false)).toBe(REDACTED);
      expect(redact('secret', false)).toBe(REDACTED);
    });
  });

  describe('redactDeep', () => {
    it('redacts nested sensitive keys while preserving safe fields', () => {
      const result = redactDeep({
        user: 'alice',
        nested: {
          password: 'plain-password',
          accessToken: 'token-value',
          publicKey: 'pub-key',
        },
        users: [{ name: 'bob', xprv: 'private-root-key' }],
      });

      expect(result.user).toBe('alice');
      expect(result.nested.password).toBe(REDACTED);
      expect(result.nested.accessToken).toBe(REDACTED);
      expect(result.nested.publicKey).toBe('pub-key');
      expect(result.users[0].name).toBe('bob');
      expect(result.users[0].xprv).toBe(REDACTED);
    });

    it('converts JSON-hostile values into safe metadata values', () => {
      const date = new Date('2026-04-12T00:00:00.000Z');
      const error = new TypeError('bad input');
      const symbol = Symbol('marker');
      const result = redactDeep<Record<string, unknown>>({
        amount: BigInt(42),
        callback: () => 'ignored',
        marker: symbol,
        date,
        error,
      });

      expect(result.amount).toBe('42');
      expect(result.callback).toBe('[FUNCTION]');
      expect(result.marker).toBe('Symbol(marker)');
      expect(result.date).toBe('2026-04-12T00:00:00.000Z');
      expect(result.error).toEqual({ name: 'TypeError', message: 'bad input' });
    });

    it('preserves nullish metadata values', () => {
      expect(redactDeep(null)).toBeNull();
      expect(redactDeep(undefined)).toBeUndefined();
    });

    it('handles circular references and max depth', () => {
      const meta: Record<string, unknown> = { name: 'root' };
      meta.self = meta;

      const circular = redactDeep(meta);
      expect(circular.self).toBe(CIRCULAR);

      const deep = redactDeep({ a: { b: { c: { d: 'too deep' } } } }, 2);
      expect(deep.a.b.c).toBe(MAX_DEPTH);
    });
  });

  describe('stringifyRedacted', () => {
    it('serializes redacted metadata without leaking secret values', () => {
      const output = stringifyRedacted({
        token: 'secret-token',
        nested: { keep: 'visible', password: 'plain-password' },
      });

      expect(output).toContain(`"token":"${REDACTED}"`);
      expect(output).toContain('"keep":"visible"');
      expect(output).not.toContain('secret-token');
      expect(output).not.toContain('plain-password');
    });

    it('returns a serialization error payload if traversal fails', () => {
      const output = stringifyRedacted({
        invalidDate: new Date(Number.NaN),
      });

      const parsed = JSON.parse(output);
      expect(parsed.serializationError).toContain('Invalid time value');
    });

    it('serializes non-Error traversal failures', () => {
      const metadata: Record<string, unknown> = {};
      Object.defineProperty(metadata, 'broken', {
        enumerable: true,
        get: () => {
          throw 'non-error failure';
        },
      });

      const output = stringifyRedacted(metadata);

      expect(JSON.parse(output)).toEqual({
        serializationError: 'non-error failure',
      });
    });
  });
});
