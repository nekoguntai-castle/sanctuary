import { describe, expect, it } from 'vitest';
import {
  parseJsonImport,
  testXpubs,
  validateJsonImport,
  type JsonImportConfig,
} from './descriptorParserTestHarness';

export function registerDescriptorParserJsonImportContracts(): void {
  describe('JSON Import Format', () => {
    describe('validateJsonImport', () => {
      it('should validate correct single-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).toBeNull();
      });

      it('should validate correct multi-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).toBeNull();
      });

      it('should reject config without type', () => {
        const config = {
          scriptType: 'native_segwit',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toBeDefined();
      });

      it('should reject config with invalid type', () => {
        const config = {
          type: 'invalid_type',
          scriptType: 'native_segwit',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('single_sig');
      });

      it('should reject config without scriptType', () => {
        const config = {
          type: 'single_sig',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toBeDefined();
      });

      it('should reject config with empty devices array', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('devices');
      });

      it('should reject single-sig with multiple devices', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('exactly one device');
      });

      it('should reject multi-sig without quorum', () => {
        const config = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('quorum');
      });

      it('should reject multi-sig with quorum exceeding total devices', () => {
        const config: JsonImportConfig = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 3,
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('Quorum cannot exceed');
      });

      it('should reject device with invalid fingerprint format', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'invalid',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('fingerprint');
      });

      it('should reject device without derivationPath', () => {
        const config = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toBeDefined();
      });

      it('should reject device with empty xpub', () => {
        const config = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: '',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toBeDefined();
      });
    });

    describe('parseJsonImport', () => {
      it('should parse valid single-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].fingerprint).toBe('aabbccdd');
      });

      it('should parse valid multi-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.type).toBe('multi_sig');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
      });

      it('should normalize fingerprints to lowercase', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'AABBCCDD',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.devices[0].fingerprint).toBe('aabbccdd');
      });

      it('should detect network from xpub if not specified', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/1'/0'",
              xpub: testXpubs.testnet.bip84,
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.network).toBe('testnet');
      });

      it('should use specified network if provided', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/1'/0'",
              xpub: testXpubs.testnet.bip84,
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.network).toBe('testnet');
      });

      it('should fall back to xpub prefix when derivation path has no coin type', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: 'm',
              xpub: testXpubs.testnet.bip84,
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.network).toBe('testnet');
      });

      it('should detect testnet when first hardened index is coin type 1', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/1'/0'/0'",
              xpub: testXpubs.mainnet.bip84,
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.network).toBe('testnet');
      });

      it('should throw for invalid JSON config', () => {
        const config = {
          type: 'invalid',
        };

        expect(() => {
          parseJsonImport(config as JsonImportConfig);
        }).toThrow();
      });
    });
  });
}
