import { describe, expect, it } from 'vitest';
import {
  parseImportInput,
  testXpubs,
} from './descriptorParserTestHarness';

const VALID_DESCRIPTOR = `wpkh([d34db33f/84'/0'/0']${testXpubs.mainnet.bip84}/0/*)`;

export function registerDescriptorParserAutoDetectionContracts(): void {
  describe('parseImportInput - Auto-detection', () => {
    it('should auto-detect and parse descriptor format', () => {
      const input = VALID_DESCRIPTOR;

      const result = parseImportInput(input);

      expect(result.format).toBe('descriptor');
      expect(result.parsed.type).toBe('single_sig');
    });

    it('should auto-detect and parse JSON format', () => {
      const input = JSON.stringify({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          {
            fingerprint: 'aabbccdd',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
          },
        ],
      });

      const result = parseImportInput(input);

      expect(result.format).toBe('json');
      expect(result.parsed.type).toBe('single_sig');
    });

    it('should auto-detect and parse wallet export format', () => {
      const input = JSON.stringify({
        label: 'My Wallet',
        descriptor: VALID_DESCRIPTOR,
      });

      const result = parseImportInput(input);

      expect(result.format).toBe('wallet_export');
      expect(result.suggestedName).toBe('My Wallet');
    });

    it('should use wallet export name when label is absent', () => {
      const input = JSON.stringify({
        name: 'Fallback Wallet Name',
        descriptor: VALID_DESCRIPTOR,
      });

      const result = parseImportInput(input);

      expect(result.format).toBe('wallet_export');
      expect(result.suggestedName).toBe('Fallback Wallet Name');
    });

    it('should auto-detect and parse BlueWallet text format', () => {
      const input = `# BlueWallet Multisig setup file
Name: My 2-of-3 Wallet
Policy: 2 of 3
Sorted: true
Derivation: m/48'/0'/0'/2'
Format: P2WSH

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5
99887766: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj`;

      const result = parseImportInput(input);

      expect(result.format).toBe('bluewallet_text');
      expect(result.suggestedName).toBe('My 2-of-3 Wallet');
      expect(result.parsed.type).toBe('multi_sig');
      expect(result.parsed.quorum).toBe(2);
      expect(result.parsed.totalSigners).toBe(3);
    });

    it('should parse Coldcard format with P2WSH-P2SH (inner-outer notation) as nested_segwit', () => {
      const input = `# Coldcard Multisig setup file
Name: Casa Multisig
Policy: 3 of 5
Sorted: true
Derivation: m/48'/0'/0'/1'
Format: P2WSH-P2SH

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5
99887766: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj
deadbeef: xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ
cafebabe: xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj`;

      const result = parseImportInput(input);

      expect(result.format).toBe('bluewallet_text');
      expect(result.parsed.type).toBe('multi_sig');
      expect(result.parsed.scriptType).toBe('nested_segwit');
      expect(result.parsed.quorum).toBe(3);
      expect(result.parsed.totalSigners).toBe(5);
    });

    it('should parse P2SH-P2WSH format (outer-inner notation) as nested_segwit', () => {
      const input = `# Multisig setup file
Name: Nested Segwit Multisig
Policy: 2 of 3
Sorted: true
Derivation: m/48'/0'/0'/1'
Format: P2SH-P2WSH

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5
99887766: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj`;

      const result = parseImportInput(input);

      expect(result.format).toBe('bluewallet_text');
      expect(result.parsed.scriptType).toBe('nested_segwit');
    });

    it('should handle descriptor with comments (text format)', () => {
      const input = `# Sparrow Wallet export
# Created: 2024-01-01
${VALID_DESCRIPTOR}`;

      const result = parseImportInput(input);

      expect(result.format).toBe('descriptor');
      expect(result.parsed.type).toBe('single_sig');
    });

    it('rejects P2SH-P2TR instead of relabeling it as taproot', () => {
      const input = `# Nested Taproot setup
Name: Nested Taproot Wallet
Policy: 2 of 3
Sorted: true
Derivation: m/86'/0'/0'
Format: P2SH-P2TR

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5
99887766: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj`;

      expect(() => parseImportInput(input)).toThrow('Unsupported BlueWallet Format: P2SH-P2TR');
    });

    it('rejects P2TR-P2SH instead of relabeling it as taproot', () => {
      const input = `# Nested Taproot setup
Name: Nested Taproot Wallet
Policy: 2 of 3
Sorted: true
Derivation: m/86'/0'/0'
Format: P2TR-P2SH

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5
99887766: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj`;

      expect(() => parseImportInput(input)).toThrow('Unsupported BlueWallet Format: P2TR-P2SH');
    });

    it('should parse BlueWallet text with per-device derivation comments', () => {
      const input = `# BlueWallet Multisig setup file
Name: Commented Paths
Policy: 2 of 2
Sorted: true
Format: P2WSH
# derivation: m/48'/0'/0'/2'
aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
# derivation: m/48'/0'/0'/2'
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5`;

      const result = parseImportInput(input);

      expect(result.format).toBe('bluewallet_text');
      expect(result.parsed.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(result.parsed.devices[1].derivationPath).toBe("m/48'/0'/0'/2'");
    });

    it('should auto-detect and parse Coldcard JSON export format', () => {
      const input = JSON.stringify({
        xfp: 'A1B2C3D4',
        bip84: {
          xpub: testXpubs.mainnet.bip84,
          deriv: "m/84'/0'/0'",
        },
      });

      const result = parseImportInput(input);

      expect(result.format).toBe('coldcard');
      expect(result.parsed.type).toBe('single_sig');
      expect(result.parsed.scriptType).toBe('native_segwit');
      expect(result.availablePaths).toEqual([
        { scriptType: 'native_segwit', path: "m/84'/0'/0'" },
      ]);
      expect(result.parsed.devices[0].fingerprint).toBe('a1b2c3d4');
    });

    it('should throw Invalid JSON format for malformed JSON', () => {
      expect(() => parseImportInput('{"type":"single_sig"')).toThrow('Invalid JSON format');
    });

    it('should rethrow non-syntax JSON parsing errors from config validation', () => {
      const input = JSON.stringify({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [],
      });

      expect(() => parseImportInput(input)).toThrow('devices must be a non-empty array');
    });
  });
}
