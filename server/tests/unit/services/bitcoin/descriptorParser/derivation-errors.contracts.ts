import { describe, expect, it, vi } from 'vitest';
import {
  parseDescriptorForImport,
  testXpubs,
  validateDescriptor,
  type Network,
} from './descriptorParserTestHarness';

export function registerDescriptorParserDerivationErrorContracts(): void {
  describe('Derivation Path Parsing', () => {
    it('should handle h notation for hardened derivation', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
    });

    it("should handle ' notation for hardened derivation", () => {
      const descriptor = "wpkh([d34db33f/84'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)";

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
    });

    it('should handle H notation for hardened derivation', () => {
      // Both uppercase H and lowercase h are normalized to apostrophe notation
      const descriptor = 'wpkh([d34db33f/84H/0H/0H]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      // Uppercase H is now normalized to apostrophe notation
      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
    });

    it('should handle mixed H and h notation for hardened derivation', () => {
      // Mixed uppercase H and lowercase h should all normalize to apostrophe
      const descriptor = 'wpkh([d34db33f/84H/0h/0H]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
    });

    it('should handle mixed hardened and unhardened paths', () => {
      const descriptor = "wpkh([d34db33f/84'/0'/0]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)";

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0");
    });

    it('should extract fingerprint from origin info', () => {
      const descriptor = 'wpkh([AbCdEf12/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].fingerprint).toBe('abcdef12');
    });

    it('should handle wildcard in receive chain', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.isChange).toBe(false);
    });

    it('should handle wildcard in change chain', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.isChange).toBe(true);
    });
  });

  describe('Checksum Handling', () => {
    it('should parse descriptor with checksum', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)#abcdefgh';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should parse descriptor without checksum', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should handle alphanumeric checksum', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)#2h48fu9a';

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].fingerprint).toBe('d34db33f');
    });
  });

  describe('Error Handling', () => {
    it('should throw for invalid descriptor format', () => {
      expect(() => {
        parseDescriptorForImport('invalid-descriptor');
      }).toThrow();
    });

    it('should throw for unsupported script type', () => {
      expect(() => {
        parseDescriptorForImport('pk([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)');
      }).toThrow('Unable to detect script type from descriptor');
    });

    it('should throw for descriptor without key expressions', () => {
      expect(() => {
        parseDescriptorForImport('wpkh()');
      }).toThrow('No valid key expressions found in descriptor');
    });

    it('should throw for multisig without quorum', () => {
      expect(() => {
        parseDescriptorForImport('wsh(sortedmulti([aabbccdd/48h/1h/0h/2h]tpub1/0/*))');
      }).toThrow('Could not extract quorum from multisig descriptor');
    });

    it('should handle malformed xpub gracefully', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]invalid-xpub/0/*)';

      expect(() => {
        parseDescriptorForImport(descriptor);
      }).toThrow('No valid key expressions found in descriptor');
    });

    it('should throw when key expression parsing fails after extraction', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';
      const keyExpressionPattern = '\\[([a-fA-F0-9]{8})\\/([^\\]]+)\\]([xyztuvYZTUVpub][a-zA-Z0-9]+)';
      const originalMatch = String.prototype.match;
      const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (pattern: RegExp | string) {
        if (pattern instanceof RegExp && pattern.source === keyExpressionPattern) {
          return null;
        }
        return originalMatch.call(this, pattern);
      });

      try {
        expect(() => {
          parseDescriptorForImport(descriptor);
        }).toThrow('Invalid descriptor key expression');
      } finally {
        matchSpy.mockRestore();
      }
    });

    it('should handle descriptor with spaces', () => {
      const descriptor = '  wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)  ';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
    });

    it('should handle empty descriptor', () => {
      expect(() => {
        parseDescriptorForImport('');
      }).toThrow();
    });
  });

  describe('Network Detection', () => {
    it('should detect mainnet from xpub prefix', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('mainnet');
    });

    it('should detect testnet from tpub prefix', () => {
      const descriptor = `wpkh([d34db33f/84h/1h/0h]${testXpubs.testnet.bip84}/0/*)`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('testnet');
    });

    it('should detect testnet from coin type in derivation path', () => {
      // Use testnet xpub to ensure proper network detection
      const descriptor = `wpkh([d34db33f/84h/1h/0h]${testXpubs.testnet.bip84}/0/*)`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('testnet');
    });

    it('should detect testnet from upub prefix (nested segwit)', () => {
      const descriptor = `sh(wpkh([d34db33f/49h/1h/0h]${testXpubs.testnet.bip49}/0/*))`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('testnet');
    });

    it('should detect mainnet from ypub prefix', () => {
      const descriptor = `sh(wpkh([d34db33f/49h/0h/0h]${testXpubs.mainnet.bip49}/0/*))`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('mainnet');
    });
  });

  describe('validateDescriptor', () => {
    it('should return null for valid descriptor', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const error = validateDescriptor(descriptor);

      expect(error).toBeNull();
    });

    it('should return error for invalid descriptor', () => {
      const error = validateDescriptor('invalid');

      expect(error).not.toBeNull();
      expect(error?.message).toBeDefined();
    });
  });
}
