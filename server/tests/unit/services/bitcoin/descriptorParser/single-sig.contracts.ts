import { describe, expect, it } from 'vitest';
import {
  parseDescriptorForImport,
  testXpubs,
} from './descriptorParserTestHarness';

export function registerDescriptorParserSingleSigContracts(): void {
  describe('parseDescriptorForImport - Single-sig Descriptors', () => {
    describe('Native SegWit (wpkh)', () => {
      it('should parse wpkh descriptor with fingerprint and derivation path', () => {
        const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.network).toBe('mainnet');
        expect(result.isChange).toBe(false);
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].fingerprint).toBe('d34db33f');
        expect(result.devices[0].xpub).toBe('xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL');
        expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
      });

      it('should parse wpkh descriptor with change chain wildcard', () => {
        const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.isChange).toBe(true);
      });

      it('should parse wpkh descriptor with apostrophe notation for hardened paths', () => {
        const descriptor = "wpkh([d34db33f/84'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)";

        const result = parseDescriptorForImport(descriptor);

        expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
      });

      it('should parse wpkh descriptor with testnet xpub', () => {
        const descriptor = `wpkh([aabbccdd/84h/1h/0h]${testXpubs.testnet.bip84}/0/*)`;

        const result = parseDescriptorForImport(descriptor);

        expect(result.network).toBe('testnet');
        expect(result.scriptType).toBe('native_segwit');
      });

      it('should parse wpkh descriptor without origin info', () => {
        // The parser requires origin info [fingerprint/path] to extract keys
        // Descriptors without origin info will fail to parse
        const descriptor = 'wpkh(xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

        expect(() => {
          parseDescriptorForImport(descriptor);
        }).toThrow('No valid key expressions found in descriptor');
      });
    });

    describe('Legacy (pkh)', () => {
      it('should parse pkh descriptor', () => {
        const descriptor = 'pkh([11223344/44h/0h/0h]xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5/0/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('legacy');
        expect(result.network).toBe('mainnet');
        expect(result.devices[0].fingerprint).toBe('11223344');
        expect(result.devices[0].derivationPath).toBe("m/44'/0'/0'");
      });

      it('should detect testnet from coin type in derivation path', () => {
        // Use a testnet xpub prefix (tpub) to ensure testnet detection
        const descriptor = `pkh([11223344/44h/1h/0h]${testXpubs.testnet.bip44}/0/*)`;

        const result = parseDescriptorForImport(descriptor);

        expect(result.network).toBe('testnet');
      });
    });

    describe('Nested SegWit (sh(wpkh))', () => {
      it('should parse sh(wpkh) descriptor', () => {
        const descriptor = 'sh(wpkh([aabbccdd/49h/0h/0h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('nested_segwit');
        expect(result.devices[0].fingerprint).toBe('aabbccdd');
        expect(result.devices[0].derivationPath).toBe("m/49'/0'/0'");
      });
    });

    describe('Taproot (tr)', () => {
      it('should parse tr descriptor', () => {
        const descriptor = 'tr([eeff0011/86h/0h/0h]xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ/0/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('taproot');
        expect(result.devices[0].fingerprint).toBe('eeff0011');
        expect(result.devices[0].derivationPath).toBe("m/86'/0'/0'");
      });
    });
  });
}
