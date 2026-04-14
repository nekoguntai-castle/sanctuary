import { describe, expect, it } from 'vitest';
import {
  extractDescriptorFromText,
  isDescriptorTextFormat,
  parseBlueWalletTextImport,
  parseColdcardExport,
  parseDescriptorForImport,
  testXpubs,
  type ScriptType,
} from './descriptorParserTestHarness';

export function registerDescriptorParserTextColdcardChecksumContracts(): void {
  describe('parseBlueWalletTextImport', () => {
    it('should default to native_segwit when Format line is missing', () => {
      const input = `# BlueWallet Multisig setup file
Policy: 2 of 2
Derivation: m/48'/0'/0'/2'

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5`;

      const result = parseBlueWalletTextImport(input);

      expect(result.scriptType).toBe('native_segwit');
      expect(result.type).toBe('multi_sig');
      expect(result.quorum).toBe(2);
      expect(result.totalSigners).toBe(2);
    });

    it('should throw when no device lines are present', () => {
      const input = `# BlueWallet Multisig setup file
Policy: 2 of 3
Derivation: m/48'/0'/0'/2'
Format: P2WSH`;

      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'No devices found in BlueWallet text file'
      );
    });

    it('should use default derivation when no wallet or per-device derivation is provided', () => {
      const input = `# BlueWallet setup file
Policy: 1 of 1
Format: P2WPKH

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL`;

      const result = parseBlueWalletTextImport(input);

      expect(result.type).toBe('single_sig');
      expect(result.quorum).toBeUndefined();
      expect(result.totalSigners).toBeUndefined();
      expect(result.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
    });

    it('maps BlueWallet format values to expected script types', () => {
      const cases: Array<{ format: string; expected: ScriptType }> = [
        { format: 'P2SH', expected: 'legacy' },
        { format: 'P2TR', expected: 'taproot' },
        { format: 'P2WPKH', expected: 'native_segwit' },
        { format: 'P2SH-P2WPKH', expected: 'nested_segwit' },
        { format: 'P2WPKH-P2SH', expected: 'nested_segwit' },
        { format: 'P2PKH', expected: 'legacy' },
        { format: 'SOMETHING-ELSE', expected: 'native_segwit' },
      ];

      for (const { format, expected } of cases) {
        const input = `# BlueWallet setup file
Policy: 2 of 2
Derivation: m/48'/0'/0'/2'
Format: ${format}

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5`;

        expect(parseBlueWalletTextImport(input).scriptType).toBe(expected);
      }
    });

    it('should ignore non-device lines that are not recognized metadata', () => {
      const input = `# BlueWallet setup file
Policy: 1 of 1
Format: P2WPKH
Unrecognized metadata line

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL`;

      const result = parseBlueWalletTextImport(input);

      expect(result.type).toBe('single_sig');
      expect(result.devices).toHaveLength(1);
    });
  });

  describe('Coldcard JSON parsing', () => {
    it('should select nested-segwit when only bip49 is present', () => {
      const result = parseColdcardExport({
        xfp: 'AABBCCDD',
        bip49: {
          xpub: testXpubs.mainnet.bip49,
          deriv: "m/49'/0'/0'",
        },
      });

      expect(result.parsed.scriptType).toBe('nested_segwit');
      expect(result.parsed.devices[0].derivationPath).toBe("m/49'/0'/0'");
      expect(result.availablePaths).toEqual([
        { scriptType: 'nested_segwit', path: "m/49'/0'/0'" },
      ]);
    });

    it('should select legacy when only bip44 is present', () => {
      const result = parseColdcardExport({
        xfp: 'AABBCCDD',
        bip44: {
          xpub: testXpubs.mainnet.bip44,
          deriv: "m/44'/0'/0'",
        },
      });

      expect(result.parsed.scriptType).toBe('legacy');
      expect(result.parsed.devices[0].derivationPath).toBe("m/44'/0'/0'");
    });

    it('should support bip48_2 and bip48_1 derivation fallbacks', () => {
      const bip48_2 = parseColdcardExport({
        xfp: 'AABBCCDD',
        bip48_2: {
          xpub: testXpubs.mainnet.bip84,
          deriv: "m/48'/0'/0'/2'",
        },
      });
      const bip48_1 = parseColdcardExport({
        xfp: 'AABBCCDD',
        bip48_1: {
          xpub: testXpubs.mainnet.bip49,
          deriv: "m/48'/0'/0'/1'",
        },
      });

      expect(bip48_2.parsed.scriptType).toBe('native_segwit');
      expect(bip48_1.parsed.scriptType).toBe('nested_segwit');
    });

    it('should parse flat-format export and choose legacy when only p2sh is present', () => {
      const result = parseColdcardExport({
        xfp: 'AABBCCDD',
        p2sh: testXpubs.mainnet.bip44,
        p2sh_deriv: "m/45'",
      });

      expect(result.parsed.scriptType).toBe('legacy');
      expect(result.availablePaths).toEqual([{ scriptType: 'legacy', path: "m/45'" }]);
    });

    it('should parse flat-format export and prefer native segwit p2wsh path', () => {
      const result = parseColdcardExport({
        xfp: 'AABBCCDD',
        p2wsh: testXpubs.mainnet.bip84,
        p2wsh_deriv: "m/48'/0'/0'/2'",
      });

      expect(result.parsed.scriptType).toBe('native_segwit');
      expect(result.availablePaths).toEqual([
        { scriptType: 'native_segwit', path: "m/48'/0'/0'/2'" },
      ]);
    });

    it('should parse flat-format export and choose nested segwit p2sh_p2wsh path', () => {
      const result = parseColdcardExport({
        xfp: 'AABBCCDD',
        p2sh_p2wsh: testXpubs.mainnet.bip49,
        p2sh_p2wsh_deriv: "m/48'/0'/0'/1'",
      });

      expect(result.parsed.scriptType).toBe('nested_segwit');
      expect(result.availablePaths).toEqual([
        { scriptType: 'nested_segwit', path: "m/48'/0'/0'/1'" },
      ]);
    });

    it('should throw when flat format contains no usable derivation+xpub pair', () => {
      expect(() =>
        parseColdcardExport({
          xfp: 'AABBCCDD',
          p2wsh: testXpubs.mainnet.bip84,
        })
      ).toThrow('Coldcard export does not contain any recognized derivation paths with xpubs');
    });

    it('should throw when nested format has no recognized BIP paths', () => {
      expect(() => parseColdcardExport({ xfp: 'AABBCCDD' })).toThrow(
        'Coldcard export does not contain any recognized BIP derivation paths'
      );
    });
  });

  describe('Descriptor text helpers', () => {
    it('extracts first descriptor line from mixed text', () => {
      const input = [
        '# Export created by Wallet',
        'not a descriptor',
        'wpkh([aabbccdd/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)',
        'wsh(sortedmulti(2,[aabbccdd/48h/0h/0h/2h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*,[11223344/48h/0h/0h/2h]xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5/0/*))',
      ].join('\n');

      expect(extractDescriptorFromText(input)?.startsWith('wpkh(')).toBe(true);
    });

    it('returns null when no descriptor-like line exists', () => {
      const input = '# only comments\n\nthis is plain text';
      expect(extractDescriptorFromText(input)).toBeNull();
    });

    it('detects descriptor text format only when both comments and descriptors are present', () => {
      const withBoth = '# header\nwpkh([aabbccdd/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';
      const descriptorOnly = 'wpkh([aabbccdd/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';
      const commentsOnly = '# just comments';

      expect(isDescriptorTextFormat(withBoth)).toBe(true);
      expect(isDescriptorTextFormat(descriptorOnly)).toBe(false);
      expect(isDescriptorTextFormat(commentsOnly)).toBe(false);
    });
  });

  describe('Checksum Validation', () => {
    it('should accept descriptor when checksum cannot be computed due to unsupported characters', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*:foo)#abcd1234';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.devices[0].fingerprint).toBe('d34db33f');
    });

    it('should accept descriptors whose payload length leaves checksum class remainder', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)_#abcd1234';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should accept descriptor with valid checksum', () => {
      // Note: This descriptor has a placeholder checksum - the actual checksum
      // validation logs a warning but still accepts the descriptor
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)#abcd1234';

      // Should not throw - checksum validation is lenient
      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should accept descriptor without checksum', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.devices[0].fingerprint).toBe('d34db33f');
    });

    it('should strip checksum and parse descriptor correctly', () => {
      const descriptor = 'wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*))#checksum';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('multi_sig');
      expect(result.quorum).toBe(2);
      expect(result.devices).toHaveLength(2);
    });
  });
}
