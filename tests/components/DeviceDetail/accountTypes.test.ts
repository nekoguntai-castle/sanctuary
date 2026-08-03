/**
 * Account Types Configuration Tests
 *
 * Tests for the account type configuration and getAccountTypeInfo function.
 * Ensures all account types are properly configured and the lookup function
 * handles known and unknown types correctly.
 */

import { describe,expect,it } from 'vitest';
import {
ACCOUNT_TYPE_CONFIG,
getAccountTypeInfo
} from '../../../src/components/DeviceDetail/accountTypes';
import type { DeviceAccount } from '../../../src/types';

describe('ACCOUNT_TYPE_CONFIG', () => {
  describe('Configuration Validity', () => {
    it('should have all required fields for each account type', () => {
      Object.entries(ACCOUNT_TYPE_CONFIG).forEach(([, config]) => {
        expect(config.title.length).toBeGreaterThan(0);
        expect(typeof config.title).toBe('string');
        expect(config.description.length).toBeGreaterThan(0);
        expect(typeof config.description).toBe('string');
        expect(config.addressPrefix.length).toBeGreaterThan(0);
        expect(typeof config.addressPrefix).toBe('string');
      });
    });

    it('should have valid key format (purpose:scriptType)', () => {
      const validPurposes = ['single_sig', 'multisig'];
      const validScriptTypes = [
        'native_segwit',
        'nested_segwit',
        'taproot',
        'legacy',
      ];

      Object.keys(ACCOUNT_TYPE_CONFIG).forEach((key) => {
        const [purpose, scriptType] = key.split(':');
        expect(validPurposes).toContain(purpose);
        expect(validScriptTypes).toContain(scriptType);
      });
    });

    it('should have at least one recommended single_sig type', () => {
      const recommendedSingleSig = Object.entries(ACCOUNT_TYPE_CONFIG).filter(
        ([key, config]) => key.startsWith('single_sig:') && config.recommended
      );
      expect(recommendedSingleSig.length).toBeGreaterThanOrEqual(1);
    });

    it('should have at least one recommended multisig type', () => {
      const recommendedMultisig = Object.entries(ACCOUNT_TYPE_CONFIG).filter(
        ([key, config]) => key.startsWith('multisig:') && config.recommended
      );
      expect(recommendedMultisig.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Single-Sig Account Types', () => {
    it('should have Native SegWit (BIP-84) configured', () => {
      const config = ACCOUNT_TYPE_CONFIG['single_sig:native_segwit'];
      expect(config).toBeDefined();
      expect(config.title).toContain('Native SegWit');
      expect(config.title).toContain('BIP-84');
      expect(config.addressPrefix).toBe('bc1q...');
      expect(config.recommended).toBe(true);
    });

    it('should have Taproot (BIP-86) configured', () => {
      const config = ACCOUNT_TYPE_CONFIG['single_sig:taproot'];
      expect(config).toBeDefined();
      expect(config.title).toContain('Taproot');
      expect(config.title).toContain('BIP-86');
      expect(config.addressPrefix).toBe('bc1p...');
    });

    it('should have Nested SegWit (BIP-49) configured', () => {
      const config = ACCOUNT_TYPE_CONFIG['single_sig:nested_segwit'];
      expect(config).toBeDefined();
      expect(config.title).toContain('Nested SegWit');
      expect(config.title).toContain('BIP-49');
      expect(config.addressPrefix).toBe('3...');
    });

    it('should have Legacy (BIP-44) configured', () => {
      const config = ACCOUNT_TYPE_CONFIG['single_sig:legacy'];
      expect(config).toBeDefined();
      expect(config.title).toContain('Legacy');
      expect(config.title).toContain('BIP-44');
      expect(config.addressPrefix).toBe('1...');
    });
  });

  describe('Multisig Account Types', () => {
    it('should have Multisig Native SegWit (BIP-48) configured', () => {
      const config = ACCOUNT_TYPE_CONFIG['multisig:native_segwit'];
      expect(config).toBeDefined();
      expect(config.title).toContain('Multisig');
      expect(config.title).toContain('Native SegWit');
      expect(config.title).toContain('BIP-48');
      expect(config.addressPrefix).toBe('bc1q...');
      expect(config.recommended).toBe(true);
    });

    it('should have Multisig Nested SegWit (BIP-48) configured', () => {
      const config = ACCOUNT_TYPE_CONFIG['multisig:nested_segwit'];
      expect(config).toBeDefined();
      expect(config.title).toContain('Multisig');
      expect(config.title).toContain('Nested SegWit');
      expect(config.addressPrefix).toBe('3...');
    });
  });

  describe('Address Prefixes', () => {
    it('should have correct prefixes for mainnet addresses', () => {
      // bc1q for Native SegWit
      expect(
        ACCOUNT_TYPE_CONFIG['single_sig:native_segwit'].addressPrefix
      ).toMatch(/^bc1q/);
      expect(
        ACCOUNT_TYPE_CONFIG['multisig:native_segwit'].addressPrefix
      ).toMatch(/^bc1q/);

      // bc1p for Taproot
      expect(ACCOUNT_TYPE_CONFIG['single_sig:taproot'].addressPrefix).toMatch(
        /^bc1p/
      );

      // 3 for Nested SegWit (P2SH-wrapped)
      expect(
        ACCOUNT_TYPE_CONFIG['single_sig:nested_segwit'].addressPrefix
      ).toMatch(/^3/);
      expect(
        ACCOUNT_TYPE_CONFIG['multisig:nested_segwit'].addressPrefix
      ).toMatch(/^3/);

      // 1 for Legacy
      expect(ACCOUNT_TYPE_CONFIG['single_sig:legacy'].addressPrefix).toMatch(
        /^1/
      );
    });
  });
});

describe('getAccountTypeInfo', () => {
  const createAccount = (
    purpose: DeviceAccount['purpose'],
    scriptType: DeviceAccount['scriptType']
  ): DeviceAccount => ({
    id: 'test-id',
    purpose,
    scriptType,
    derivationPath: "m/84'/0'/0'",
    xpub: 'xpub...',
  });

  describe('Known Account Types', () => {
    it('should return correct info for single_sig:native_segwit', () => {
      const account = createAccount('single_sig', 'native_segwit');
      const info = getAccountTypeInfo(account);

      expect(info.title).toContain('Native SegWit');
      expect(info.addressPrefix).toBe('bc1q...');
      expect(info.recommended).toBe(true);
    });

    it('should return correct info for single_sig:taproot', () => {
      const account = createAccount('single_sig', 'taproot');
      const info = getAccountTypeInfo(account);

      expect(info.title).toContain('Taproot');
      expect(info.addressPrefix).toBe('bc1p...');
    });

    it('should return correct info for single_sig:nested_segwit', () => {
      const account = createAccount('single_sig', 'nested_segwit');
      const info = getAccountTypeInfo(account);

      expect(info.title).toContain('Nested SegWit');
      expect(info.addressPrefix).toBe('3...');
    });

    it('should return correct info for single_sig:legacy', () => {
      const account = createAccount('single_sig', 'legacy');
      const info = getAccountTypeInfo(account);

      expect(info.title).toContain('Legacy');
      expect(info.addressPrefix).toBe('1...');
    });

    it('should return correct info for multisig:native_segwit', () => {
      const account = createAccount('multisig', 'native_segwit');
      const info = getAccountTypeInfo(account);

      expect(info.title).toContain('Multisig');
      expect(info.title).toContain('Native SegWit');
      expect(info.addressPrefix).toBe('bc1q...');
      expect(info.recommended).toBe(true);
    });

    it('should return correct info for multisig:nested_segwit', () => {
      const account = createAccount('multisig', 'nested_segwit');
      const info = getAccountTypeInfo(account);

      expect(info.title).toContain('Multisig');
      expect(info.title).toContain('Nested SegWit');
      expect(info.addressPrefix).toBe('3...');
    });
  });

  describe('Unknown Account Types', () => {
    it('should return fallback for unknown combination', () => {
      const account = createAccount('multisig', 'taproot');
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Unknown Format');
      expect(info.addressPrefix).toBe('?');
      // Description should be the derivation path
      expect(info.description).toBe(account.derivationPath);
    });

    it('should return fallback for multisig:legacy (not configured)', () => {
      const account = createAccount('multisig', 'legacy');
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Unknown Format');
      expect(info.addressPrefix).toBe('?');
    });

    it('should use derivation path as description for unknown types', () => {
      const account: DeviceAccount = {
        id: 'test',
        purpose: 'multisig',
        scriptType: 'taproot',
        derivationPath: "m/86'/0'/0'",
        xpub: 'xpub...',
      };
      const info = getAccountTypeInfo(account);

      expect(info.description).toBe("m/86'/0'/0'");
    });
  });

  describe('Return Type', () => {
    it('should always return an object with all required fields', () => {
      const account = createAccount('single_sig', 'native_segwit');
      const info = getAccountTypeInfo(account);

      expect(info).toHaveProperty('title');
      expect(info).toHaveProperty('description');
      expect(info).toHaveProperty('addressPrefix');
      expect(typeof info.title).toBe('string');
      expect(typeof info.description).toBe('string');
      expect(typeof info.addressPrefix).toBe('string');
    });

    it('should handle accounts with various derivation paths', () => {
      const paths = [
        "m/84'/0'/0'",
        "m/49'/0'/0'",
        "m/44'/0'/0'",
        "m/86'/0'/0'",
        "m/48'/0'/0'/2'",
      ];

      paths.forEach((derivationPath) => {
        const account: DeviceAccount = {
          id: 'test',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath,
          xpub: 'xpub...',
        };
        const info = getAccountTypeInfo(account);

        expect(info).toBeDefined();
        expect(info.title.length).toBeGreaterThan(0);
      });
    });
  });
});
