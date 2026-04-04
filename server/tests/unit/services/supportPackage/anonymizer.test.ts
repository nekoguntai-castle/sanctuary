import { describe, it, expect } from 'vitest';
import { createAnonymizer, generateSalt } from '../../../../src/services/supportPackage/anonymizer';

describe('anonymizer', () => {
  describe('generateSalt', () => {
    it('returns a 64-character hex string', () => {
      const salt = generateSalt();
      expect(salt).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates unique salts', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toBe(salt2);
    });
  });

  describe('createAnonymizer', () => {
    it('produces deterministic pseudonyms for same salt+id', () => {
      const anonymize = createAnonymizer('test-salt');
      const result1 = anonymize('wallet', 'abc-123');
      const result2 = anonymize('wallet', 'abc-123');
      expect(result1).toBe(result2);
    });

    it('formats as category-hash', () => {
      const anonymize = createAnonymizer('test-salt');
      const result = anonymize('wallet', 'some-id');
      expect(result).toMatch(/^wallet-[a-f0-9]{8}$/);
    });

    it('produces different pseudonyms for different categories with same id', () => {
      const anonymize = createAnonymizer('test-salt');
      const walletResult = anonymize('wallet', 'same-id');
      const userResult = anonymize('user', 'same-id');
      expect(walletResult).toMatch(/^wallet-/);
      expect(userResult).toMatch(/^user-/);
      // Hash portion must also differ, not just the prefix
      const walletHash = walletResult.split('-')[1];
      const userHash = userResult.split('-')[1];
      expect(walletHash).not.toBe(userHash);
    });

    it('produces different hashes for different IDs', () => {
      const anonymize = createAnonymizer('test-salt');
      const result1 = anonymize('wallet', 'id-1');
      const result2 = anonymize('wallet', 'id-2');
      expect(result1).not.toBe(result2);
    });

    it('produces different pseudonyms with different salts', () => {
      const anonymize1 = createAnonymizer('salt-1');
      const anonymize2 = createAnonymizer('salt-2');
      const result1 = anonymize1('wallet', 'same-id');
      const result2 = anonymize2('wallet', 'same-id');
      expect(result1).not.toBe(result2);
    });

    it('caches results for repeated lookups', () => {
      const anonymize = createAnonymizer('test-salt');
      const first = anonymize('user', 'user-1');
      const second = anonymize('user', 'user-1');
      // Same reference from cache
      expect(first).toBe(second);
    });
  });
});
