/**
 * Descriptor Builder Service Tests
 *
 * Comprehensive tests for Bitcoin descriptor generation including:
 * - Single-sig descriptor building (wpkh, pkh, sh(wpkh), tr)
 * - Multi-sig descriptor building (wsh(sortedmulti))
 * - Derivation path generation (BIP44, BIP49, BIP84, BIP86, BIP48)
 * - Change descriptor generation
 * - Network handling
 * - Validation
 */

import {
  buildSingleSigDescriptor,
  buildMultiSigDescriptor,
  buildChangeDescriptor,
  buildDescriptorFromDevices,
  getDerivationPath,
  getMultisigDerivationPath,
  validateDeviceScriptType,
} from '../../../../src/services/bitcoin/descriptorBuilder';
import { testXpubs } from '../../../fixtures/bitcoin';

describe('Descriptor Builder Service', () => {
  describe('getDerivationPath', () => {
    describe('Mainnet paths', () => {
      it('should generate BIP44 path for legacy (mainnet)', () => {
        const path = getDerivationPath('legacy', 'mainnet', 0);
        expect(path).toBe("m/44'/0'/0'");
      });

      it('should generate BIP49 path for nested_segwit (mainnet)', () => {
        const path = getDerivationPath('nested_segwit', 'mainnet', 0);
        expect(path).toBe("m/49'/0'/0'");
      });

      it('should generate BIP84 path for native_segwit (mainnet)', () => {
        const path = getDerivationPath('native_segwit', 'mainnet', 0);
        expect(path).toBe("m/84'/0'/0'");
      });

      it('should generate BIP86 path for taproot (mainnet)', () => {
        const path = getDerivationPath('taproot', 'mainnet', 0);
        expect(path).toBe("m/86'/0'/0'");
      });
    });

    describe('Testnet paths', () => {
      it('should generate BIP44 path for legacy (testnet)', () => {
        const path = getDerivationPath('legacy', 'testnet', 0);
        expect(path).toBe("m/44'/1'/0'");
      });

      it('should generate BIP49 path for nested_segwit (testnet)', () => {
        const path = getDerivationPath('nested_segwit', 'testnet', 0);
        expect(path).toBe("m/49'/1'/0'");
      });

      it('should generate BIP84 path for native_segwit (testnet)', () => {
        const path = getDerivationPath('native_segwit', 'testnet', 0);
        expect(path).toBe("m/84'/1'/0'");
      });

      it('should generate BIP86 path for taproot (testnet)', () => {
        const path = getDerivationPath('taproot', 'testnet', 0);
        expect(path).toBe("m/86'/1'/0'");
      });
    });

    describe('Signet paths', () => {
      it('should generate BIP84 path with testnet coin type for signet', () => {
        const path = getDerivationPath('native_segwit', 'signet', 0);
        expect(path).toBe("m/84'/1'/0'");
      });

      it('should generate BIP86 path with testnet coin type for signet', () => {
        const path = getDerivationPath('taproot', 'signet', 0);
        expect(path).toBe("m/86'/1'/0'");
      });
    });

    describe('Account variation', () => {
      it('should support different account numbers', () => {
        const path0 = getDerivationPath('native_segwit', 'mainnet', 0);
        const path1 = getDerivationPath('native_segwit', 'mainnet', 1);
        const path2 = getDerivationPath('native_segwit', 'mainnet', 2);

        expect(path0).toBe("m/84'/0'/0'");
        expect(path1).toBe("m/84'/0'/1'");
        expect(path2).toBe("m/84'/0'/2'");
      });
    });

    describe('Default values', () => {
      it('should default to mainnet and account 0', () => {
        const path = getDerivationPath('native_segwit');
        expect(path).toBe("m/84'/0'/0'");
      });
    });

    describe('Error handling', () => {
      it('should throw for unknown script type', () => {
        expect(() => {
          getDerivationPath('unknown' as any);
        }).toThrow('Unknown script type');
      });

      it('should fail closed for an unknown network instead of deriving mainnet', () => {
        expect(() => getDerivationPath('native_segwit', 'unknown' as never))
          .toThrow('Unknown Bitcoin network: unknown');
      });

      it('preserves canonical path validation errors', () => {
        expect(() => getDerivationPath('native_segwit', 'mainnet', -1))
          .toThrow('Invalid BIP32 account index');
      });
    });
  });

  describe('getMultisigDerivationPath', () => {
    describe('Mainnet multisig paths', () => {
      it('should reject legacy multisig', () => {
        expect(() => getMultisigDerivationPath('legacy', 'mainnet', 0))
          .toThrow('Unsupported multi-sig script type: legacy');
      });

      it('should generate BIP48/1 path for nested_segwit multisig', () => {
        const path = getMultisigDerivationPath('nested_segwit', 'mainnet', 0);
        expect(path).toBe("m/48'/0'/0'/1'");
      });

      it('should generate BIP48/2 path for native_segwit multisig', () => {
        const path = getMultisigDerivationPath('native_segwit', 'mainnet', 0);
        expect(path).toBe("m/48'/0'/0'/2'");
      });

      it('should reject proposed BIP48/3 taproot multisig', () => {
        expect(() => getMultisigDerivationPath('taproot', 'mainnet', 0))
          .toThrow('Unsupported multi-sig script type: taproot');
      });
    });

    describe('Testnet multisig paths', () => {
      it('should generate testnet BIP48/2 path', () => {
        const path = getMultisigDerivationPath('native_segwit', 'testnet', 0);
        expect(path).toBe("m/48'/1'/0'/2'");
      });

      it('should generate testnet BIP48/1 path', () => {
        const path = getMultisigDerivationPath('nested_segwit', 'testnet', 0);
        expect(path).toBe("m/48'/1'/0'/1'");
      });
    });

    describe('Signet multisig paths', () => {
      it('should generate signet BIP48 paths with testnet coin type', () => {
        const path = getMultisigDerivationPath('native_segwit', 'signet', 0);
        expect(path).toBe("m/48'/1'/0'/2'");
      });
    });

    describe('Account variation', () => {
      it('should support different account numbers', () => {
        const path0 = getMultisigDerivationPath('native_segwit', 'mainnet', 0);
        const path1 = getMultisigDerivationPath('native_segwit', 'mainnet', 1);
        const path2 = getMultisigDerivationPath('native_segwit', 'mainnet', 2);

        expect(path0).toBe("m/48'/0'/0'/2'");
        expect(path1).toBe("m/48'/0'/1'/2'");
        expect(path2).toBe("m/48'/0'/2'/2'");
      });
    });

    describe('Error handling', () => {
      it('should throw for unknown script type', () => {
        expect(() => {
          getMultisigDerivationPath('unknown' as any);
        }).toThrow('Unknown script type');
      });
    });
  });

  describe('buildSingleSigDescriptor', () => {
    const device = {
      fingerprint: 'd34db33f',
      xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
      derivationPath: "m/84'/0'/0'",
    };

    describe('Native SegWit (wpkh)', () => {
      it('should build wpkh descriptor', () => {
        const descriptor = buildSingleSigDescriptor(device, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('wpkh(');
        expect(descriptor).toContain('[d34db33f/84h/0h/0h]');
        expect(descriptor).toContain(device.xpub);
        expect(descriptor).toContain('/0/*');
        expect(descriptor).toMatch(/wpkh\(\[d34db33f\/84h\/0h\/0h\]xpub[a-zA-Z0-9]+\/0\/\*\)/);
      });

      it('should use provided derivation path', () => {
        const customDevice = {
          ...device,
          derivationPath: "m/84'/0'/5'",
        };

        const descriptor = buildSingleSigDescriptor(customDevice, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('[d34db33f/84h/0h/5h]');
      });

      it('should auto-generate derivation path if not provided', () => {
        const deviceWithoutPath = {
          fingerprint: 'd34db33f',
          xpub: device.xpub,
        };

        const descriptor = buildSingleSigDescriptor(deviceWithoutPath, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('[d34db33f/84h/0h/0h]');
      });

      it('should handle testnet xpubs', () => {
        const testnetDevice = {
          fingerprint: 'aabbccdd',
          xpub: testXpubs.testnet.bip84,
          derivationPath: "m/84'/1'/0'",
        };

        const descriptor = buildSingleSigDescriptor(testnetDevice, 'native_segwit', 'testnet');

        expect(descriptor).toContain('[aabbccdd/84h/1h/0h]');
        expect(descriptor).toContain(testXpubs.testnet.bip84);
      });
    });

    describe('Legacy (pkh)', () => {
      it('should build pkh descriptor', () => {
        const legacyDevice = {
          fingerprint: '11223344',
          xpub: device.xpub,
          derivationPath: "m/44'/0'/0'",
        };

        const descriptor = buildSingleSigDescriptor(legacyDevice, 'legacy', 'mainnet');

        expect(descriptor).toContain('pkh(');
        expect(descriptor).toContain('[11223344/44h/0h/0h]');
        expect(descriptor).toContain('/0/*');
        expect(descriptor).toMatch(/pkh\(\[11223344\/44h\/0h\/0h\]xpub[a-zA-Z0-9]+\/0\/\*\)/);
      });
    });

    describe('Nested SegWit (sh(wpkh))', () => {
      it('should build sh(wpkh) descriptor', () => {
        const nestedDevice = {
          fingerprint: 'aabbccdd',
          xpub: device.xpub,
          derivationPath: "m/49'/0'/0'",
        };

        const descriptor = buildSingleSigDescriptor(nestedDevice, 'nested_segwit', 'mainnet');

        expect(descriptor).toContain('sh(wpkh(');
        expect(descriptor).toContain('[aabbccdd/49h/0h/0h]');
        expect(descriptor).toContain('/0/*');
        expect(descriptor).toContain('))');
        expect(descriptor).toMatch(/sh\(wpkh\(\[aabbccdd\/49h\/0h\/0h\]xpub[a-zA-Z0-9]+\/0\/\*\)\)/);
      });
    });

    describe('Taproot (tr)', () => {
      it('should build tr descriptor', () => {
        const taprootDevice = {
          fingerprint: 'eeff0011',
          xpub: device.xpub,
          derivationPath: "m/86'/0'/0'",
        };

        const descriptor = buildSingleSigDescriptor(taprootDevice, 'taproot', 'mainnet');

        expect(descriptor).toContain('tr(');
        expect(descriptor).toContain('[eeff0011/86h/0h/0h]');
        expect(descriptor).toContain('/0/*');
        expect(descriptor).toMatch(/tr\(\[eeff0011\/86h\/0h\/0h\]xpub[a-zA-Z0-9]+\/0\/\*\)/);
      });
    });

    describe('Derivation path formatting', () => {
      it('should convert apostrophes to h notation', () => {
        const deviceWithApostrophes = {
          fingerprint: 'd34db33f',
          xpub: device.xpub,
          derivationPath: "m/84'/0'/0'",
        };

        const descriptor = buildSingleSigDescriptor(deviceWithApostrophes, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('84h/0h/0h');
        expect(descriptor).not.toContain("84'/0'/0'");
      });

      it('should remove m/ prefix from path', () => {
        const descriptor = buildSingleSigDescriptor(device, 'native_segwit', 'mainnet');

        expect(descriptor).not.toContain('m/84h');
        expect(descriptor).toContain('[d34db33f/84h');
      });

      it('should handle paths without m/ prefix', () => {
        const deviceNoPrefix = {
          ...device,
          derivationPath: "84'/0'/0'",
        };

        const descriptor = buildSingleSigDescriptor(deviceNoPrefix, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('[d34db33f/84h/0h/0h]');
      });
    });

    describe('Error handling', () => {
      it('should throw for unsupported script type', () => {
        expect(() => {
          buildSingleSigDescriptor(device, 'unknown' as any, 'mainnet');
        }).toThrow('Unsupported script type');
      });
    });
  });

  describe('buildMultiSigDescriptor', () => {
    const devices = [
      {
        fingerprint: 'aabbccdd',
        xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
        derivationPath: "m/48'/0'/0'/2'",
      },
      {
        fingerprint: '11223344',
        xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
        derivationPath: "m/48'/0'/0'/2'",
      },
      {
        fingerprint: '99887766',
        xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj',
        derivationPath: "m/48'/0'/0'/2'",
      },
    ];

    describe('2-of-3 Multisig', () => {
      it('should build wsh(sortedmulti) descriptor', () => {
        const descriptor = buildMultiSigDescriptor(devices, 2, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('wsh(sortedmulti(2,');
        expect(descriptor).toContain('[aabbccdd/48h/0h/0h/2h]');
        expect(descriptor).toContain('[11223344/48h/0h/0h/2h]');
        expect(descriptor).toContain('[99887766/48h/0h/0h/2h]');
        expect(descriptor).toContain('/0/*');
        expect(descriptor).toMatch(/wsh\(sortedmulti\(2,\[aabbccdd/);
      });

      it('should use sortedmulti for deterministic ordering', () => {
        const descriptor = buildMultiSigDescriptor(devices, 2, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('sortedmulti');
        expect(descriptor).not.toContain('wsh(multi(');
      });

      it('should include all device fingerprints and xpubs', () => {
        const descriptor = buildMultiSigDescriptor(devices, 2, 'native_segwit', 'mainnet');

        devices.forEach((device) => {
          expect(descriptor).toContain(device.fingerprint);
          expect(descriptor).toContain(device.xpub);
        });
      });
    });

    describe('3-of-5 Multisig', () => {
      it('should build 3-of-5 wsh(sortedmulti) descriptor', () => {
        const fiveDevices = [
          ...devices,
          {
            fingerprint: 'deadbeef',
            xpub: 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ',
            derivationPath: "m/48'/0'/0'/2'",
          },
          {
            fingerprint: 'cafebabe',
            xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
            derivationPath: "m/48'/0'/0'/2'",
          },
        ];

        const descriptor = buildMultiSigDescriptor(fiveDevices, 3, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('wsh(sortedmulti(3,');
        expect(fiveDevices).toHaveLength(5);
        fiveDevices.forEach((device) => {
          expect(descriptor).toContain(device.fingerprint);
        });
      });
    });

    describe('Nested SegWit Multisig', () => {
      it('should build sh(wsh(sortedmulti)) descriptor', () => {
        const nestedDevices = devices.map((d) => ({
          ...d,
          derivationPath: "m/48'/0'/0'/1'",
        }));

        const descriptor = buildMultiSigDescriptor(nestedDevices, 2, 'nested_segwit', 'mainnet');

        expect(descriptor).toContain('sh(wsh(sortedmulti(2,');
        expect(descriptor).toContain('[aabbccdd/48h/0h/0h/1h]');
        expect(descriptor).toContain(')))');
      });
    });

    describe('Legacy Multisig', () => {
      it('should reject legacy multisig', () => {
        const legacyDevices = devices.map((d) => ({
          ...d,
          derivationPath: "m/45'/0'",
        }));

        expect(() => buildMultiSigDescriptor(legacyDevices, 2, 'legacy', 'mainnet'))
          .toThrow('Unsupported multi-sig script type: legacy');
      });
    });

    describe('Taproot Multisig', () => {
      it('should throw for taproot multisig (not yet supported)', () => {
        expect(() => {
          buildMultiSigDescriptor(devices, 2, 'taproot', 'mainnet');
        }).toThrow('Unsupported multi-sig script type: taproot');
      });
    });

    describe('Auto-generate derivation paths', () => {
      it('should auto-generate paths if not provided', () => {
        const devicesWithoutPaths = devices.map((d) => ({
          fingerprint: d.fingerprint,
          xpub: d.xpub,
        }));

        const descriptor = buildMultiSigDescriptor(devicesWithoutPaths, 2, 'native_segwit', 'mainnet');

        expect(descriptor).toContain('[aabbccdd/48h/0h/0h/2h]');
        expect(descriptor).toContain('[11223344/48h/0h/0h/2h]');
        expect(descriptor).toContain('[99887766/48h/0h/0h/2h]');
      });

      it('should use correct testnet paths when auto-generating', () => {
        const devicesWithoutPaths = devices.map((d) => ({
          fingerprint: d.fingerprint,
          xpub: d.xpub,
        }));

        const descriptor = buildMultiSigDescriptor(devicesWithoutPaths, 2, 'native_segwit', 'testnet');

        expect(descriptor).toContain('48h/1h/0h/2h');
      });
    });

    describe('Testnet multisig', () => {
      it('should build testnet multisig descriptor', () => {
        const testnetDevices = [
          {
            fingerprint: 'aabbccdd',
            xpub: testXpubs.testnet.bip84,
            derivationPath: "m/48'/1'/0'/2'",
          },
          {
            fingerprint: '11223344',
            xpub: testXpubs.testnet.bip84,
            derivationPath: "m/48'/1'/0'/2'",
          },
        ];

        const descriptor = buildMultiSigDescriptor(testnetDevices, 2, 'native_segwit', 'testnet');

        expect(descriptor).toContain('[aabbccdd/48h/1h/0h/2h]');
        expect(descriptor).toContain('[11223344/48h/1h/0h/2h]');
      });
    });

    describe('Error handling', () => {
      it('should throw for less than 2 devices', () => {
        expect(() => {
          buildMultiSigDescriptor([devices[0]], 1, 'native_segwit', 'mainnet');
        }).toThrow('Multi-sig requires at least 2 devices');
      });

      it('should throw for quorum exceeding device count', () => {
        expect(() => {
          buildMultiSigDescriptor(devices.slice(0, 2), 3, 'native_segwit', 'mainnet');
        }).toThrow('Quorum cannot exceed total number of signers');
      });

      it('should throw for quorum less than 1', () => {
        expect(() => {
          buildMultiSigDescriptor(devices, 0, 'native_segwit', 'mainnet');
        }).toThrow('Quorum must be at least 1');
      });

      it('should throw for unsupported script type', () => {
        expect(() => {
          buildMultiSigDescriptor(devices, 2, 'unknown' as any, 'mainnet');
        }).toThrow('Unsupported script type');
      });
    });
  });

  describe('buildChangeDescriptor', () => {
    it('should convert receive descriptor to change descriptor', () => {
      const receiveDescriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const changeDescriptor = buildChangeDescriptor(receiveDescriptor);

      expect(changeDescriptor).toContain('/1/*');
      expect(changeDescriptor).not.toContain('/0/*');
    });

    it('should convert multisig receive descriptor to change descriptor', () => {
      const receiveDescriptor = 'wsh(sortedmulti(2,[aabbccdd/48h/0h/0h/2h]xpub1/0/*),[11223344/48h/0h/0h/2h]xpub2/0/*))';

      const changeDescriptor = buildChangeDescriptor(receiveDescriptor);

      expect(changeDescriptor).toContain('/1/*)');
      expect(changeDescriptor).toBe('wsh(sortedmulti(2,[aabbccdd/48h/0h/0h/2h]xpub1/1/*),[11223344/48h/0h/0h/2h]xpub2/1/*))');
    });

    it('should handle nested segwit descriptors', () => {
      const receiveDescriptor = 'sh(wpkh([aabbccdd/49h/0h/0h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj/0/*))';

      const changeDescriptor = buildChangeDescriptor(receiveDescriptor);

      expect(changeDescriptor).toContain('/1/*))');
    });

    it('should not modify descriptors without /0/* pattern', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub/1/*)';

      const result = buildChangeDescriptor(descriptor);

      expect(result).toBe(descriptor);
    });
  });

  describe('buildDescriptorFromDevices', () => {
    const singleDevice = {
      fingerprint: 'd34db33f',
      xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
      derivationPath: "m/84'/0'/0'",
    };

    const multiDevices = [
      {
        fingerprint: 'aabbccdd',
        xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
        derivationPath: "m/48'/0'/0'/2'",
      },
      {
        fingerprint: '11223344',
        xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
        derivationPath: "m/48'/0'/0'/2'",
      },
    ];

    describe('Single-sig wallet', () => {
      it('should build single-sig wallet descriptors', () => {
        const result = buildDescriptorFromDevices([singleDevice], {
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });

        expect(result.descriptor).toContain('wpkh(');
        expect(result.descriptor).toContain('/0/*');
        expect(result.changeDescriptor).toContain('wpkh(');
        expect(result.changeDescriptor).toContain('/1/*');
        expect(result.fingerprint).toBe('d34db33f');
      });

      it('should return single device fingerprint', () => {
        const result = buildDescriptorFromDevices([singleDevice], {
          type: 'single_sig',
          scriptType: 'native_segwit',
        });

        expect(result.fingerprint).toBe(singleDevice.fingerprint);
      });

      it('should throw if single-sig has multiple devices', () => {
        expect(() => {
          buildDescriptorFromDevices(multiDevices, {
            type: 'single_sig',
            scriptType: 'native_segwit',
          });
        }).toThrow('Single-sig wallet requires exactly 1 device');
      });

      it('should throw if single-sig has no devices', () => {
        expect(() => {
          buildDescriptorFromDevices([], {
            type: 'single_sig',
            scriptType: 'native_segwit',
          });
        }).toThrow('Single-sig wallet requires exactly 1 device');
      });
    });

    describe('Multi-sig wallet', () => {
      it('should build multi-sig wallet descriptors', () => {
        const result = buildDescriptorFromDevices(multiDevices, {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
        });

        expect(result.descriptor).toContain('wsh(sortedmulti(2,');
        expect(result.descriptor).toContain('/0/*');
        expect(result.changeDescriptor).toContain('wsh(sortedmulti(2,');
        expect(result.changeDescriptor).toContain('/1/*');
      });

      it('should return combined fingerprints for multi-sig', () => {
        const result = buildDescriptorFromDevices(multiDevices, {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
        });

        expect(result.fingerprint).toBe('aabbccdd-11223344');
      });

      it('should throw if multi-sig has no quorum', () => {
        expect(() => {
          buildDescriptorFromDevices(multiDevices, {
            type: 'multi_sig',
            scriptType: 'native_segwit',
          });
        }).toThrow('Quorum is required for multi-sig wallets');
      });
    });

    describe('Network handling', () => {
      it('should default to mainnet if not specified', () => {
        const result = buildDescriptorFromDevices([singleDevice], {
          type: 'single_sig',
          scriptType: 'native_segwit',
        });

        expect(result.descriptor).toContain('[d34db33f/84h/0h/0h]');
      });

      it('should use testnet when specified', () => {
        const testnetDevice = {
          fingerprint: 'aabbccdd',
          xpub: testXpubs.testnet.bip84,
          derivationPath: "m/84'/1'/0'",
        };

        const result = buildDescriptorFromDevices([testnetDevice], {
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
        });

        expect(result.descriptor).toContain('[aabbccdd/84h/1h/0h]');
      });
    });

    describe('Script type variations', () => {
      it('should build legacy descriptor', () => {
        const legacyDevice = {
          ...singleDevice,
          derivationPath: "m/44'/0'/0'",
        };

        const result = buildDescriptorFromDevices([legacyDevice], {
          type: 'single_sig',
          scriptType: 'legacy',
        });

        expect(result.descriptor).toContain('pkh(');
      });

      it('should build nested segwit descriptor', () => {
        const nestedDevice = {
          ...singleDevice,
          derivationPath: "m/49'/0'/0'",
        };

        const result = buildDescriptorFromDevices([nestedDevice], {
          type: 'single_sig',
          scriptType: 'nested_segwit',
        });

        expect(result.descriptor).toContain('sh(wpkh(');
      });

      it('should build taproot descriptor', () => {
        const taprootDevice = {
          ...singleDevice,
          derivationPath: "m/86'/0'/0'",
        };

        const result = buildDescriptorFromDevices([taprootDevice], {
          type: 'single_sig',
          scriptType: 'taproot',
        });

        expect(result.descriptor).toContain('tr(');
      });
    });

    describe('Change descriptor generation', () => {
      it('should generate matching change descriptor', () => {
        const result = buildDescriptorFromDevices([singleDevice], {
          type: 'single_sig',
          scriptType: 'native_segwit',
        });

        expect(result.descriptor.replace('/0/*', '/1/*')).toBe(result.changeDescriptor);
      });

      it('should handle multisig change descriptors', () => {
        const result = buildDescriptorFromDevices(multiDevices, {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
        });

        const receiveCount = (result.descriptor.match(/\/0\/\*/g) || []).length;
        const changeCount = (result.changeDescriptor.match(/\/1\/\*/g) || []).length;

        expect(receiveCount).toBe(2);
        expect(changeCount).toBe(2);
        expect(result.changeDescriptor).not.toContain('/0/*');
      });
    });
  });

  describe('validateDeviceScriptType', () => {
    it('should validate native_segwit variations', () => {
      expect(validateDeviceScriptType(['native_segwit'], 'native_segwit')).toBe(true);
      expect(validateDeviceScriptType(['p2wpkh'], 'native_segwit')).toBe(true);
      expect(validateDeviceScriptType(['bech32'], 'native_segwit')).toBe(true);
      expect(validateDeviceScriptType(['segwit'], 'native_segwit')).toBe(true);
    });

    it('should validate nested_segwit variations', () => {
      expect(validateDeviceScriptType(['nested_segwit'], 'nested_segwit')).toBe(true);
      expect(validateDeviceScriptType(['p2sh-p2wpkh'], 'nested_segwit')).toBe(true);
      expect(validateDeviceScriptType(['wrapped_segwit'], 'nested_segwit')).toBe(true);
      expect(validateDeviceScriptType(['segwit'], 'nested_segwit')).toBe(true);
    });

    it('should validate taproot variations', () => {
      expect(validateDeviceScriptType(['taproot'], 'taproot')).toBe(true);
      expect(validateDeviceScriptType(['p2tr'], 'taproot')).toBe(true);
      expect(validateDeviceScriptType(['bech32m'], 'taproot')).toBe(true);
    });

    it('should validate legacy variations', () => {
      expect(validateDeviceScriptType(['legacy'], 'legacy')).toBe(true);
      expect(validateDeviceScriptType(['p2pkh'], 'legacy')).toBe(true);
    });

    it('should handle case insensitivity', () => {
      expect(validateDeviceScriptType(['NATIVE_SEGWIT'], 'native_segwit')).toBe(true);
      expect(validateDeviceScriptType(['P2WPKH'], 'native_segwit')).toBe(true);
      expect(validateDeviceScriptType(['Bech32'], 'native_segwit')).toBe(true);
    });

    it('should return false for incompatible types', () => {
      expect(validateDeviceScriptType(['legacy'], 'native_segwit')).toBe(false);
      expect(validateDeviceScriptType(['p2pkh'], 'taproot')).toBe(false);
    });

    it('should handle multiple device script types', () => {
      expect(validateDeviceScriptType(['legacy', 'native_segwit', 'taproot'], 'native_segwit')).toBe(true);
      expect(validateDeviceScriptType(['legacy', 'nested_segwit'], 'taproot')).toBe(false);
    });

    it('should return false for empty device script types', () => {
      expect(validateDeviceScriptType([], 'native_segwit')).toBe(false);
    });

    it('should return false for unknown requested script type values', () => {
      expect(validateDeviceScriptType(['native_segwit'], 'unknown_type' as any)).toBe(false);
    });
  });
});
