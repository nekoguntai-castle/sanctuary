import { describe, expect, it } from 'vitest';
import {
  parseBlueWalletTextImport,
  parseDescriptorForImport,
  parseJsonImport,
  validateDescriptor,
  type JsonImportConfig,
  type ParsedDescriptor,
} from './descriptorParserTestHarness';
import {
  validateParsedDescriptorDomain,
  validateRawDescriptorDomain,
} from '../../../../../src/services/bitcoin/descriptorParser/domainValidation';

const MAINNET_XPUB =
  'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL';
const MAINNET_XPUB_2 =
  'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5';
const TESTNET_TPUB =
  'tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ';

const wpkh = (path: string, xpub = MAINNET_XPUB, suffix = '/0/*') =>
  `wpkh([d34db33f/${path}]${xpub}${suffix})`;

const sortedMulti = (
  quorum: number,
  first = `[aabbccdd/48h/0h/0h/2h]${MAINNET_XPUB}/0/*`,
  second = `[11223344/48h/0h/0h/2h]${MAINNET_XPUB_2}/0/*`,
) => `wsh(sortedmulti(${quorum},${first},${second}))`;

export function registerDescriptorParserDomainValidationContracts(): void {
  describe('Descriptor domain validation', () => {
    it('rejects private extended keys before import', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('84h/0h/0h', 'xprv9s21ZrQH143K3privateKeyMaterial'));
      }).toThrow('Extended public key prefix does not match descriptor wrapper');
    });

    it('rejects mainnet xpubs on testnet coin-type paths', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('84h/1h/0h'));
      }).toThrow('xpub network does not match derivation path coin type');
    });

    it('rejects testnet xpubs on mainnet coin-type paths', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('84h/0h/0h', TESTNET_TPUB));
      }).toThrow('xpub network does not match derivation path coin type');
    });

    it('rejects unsupported derivation path coin types', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('84h/2h/0h'));
      }).toThrow('Descriptor origin is not a canonical account path for its wrapper');
    });

    it('rejects mixed-network multisig cosigners', () => {
      expect(() => {
        parseDescriptorForImport(
          sortedMulti(
            2,
            `[aabbccdd/48h/0h/0h/2h]${MAINNET_XPUB}/0/*`,
            `[11223344/48h/1h/0h/2h]${TESTNET_TPUB}/0/*`,
          ),
        );
      }).toThrow();
    });

    it('rejects unsupported descriptor branch wildcards', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('84h/0h/0h', MAINNET_XPUB, '/2/*'));
      }).toThrow('Descriptor key paths must end');
    });

    it('rejects fixed child indexes in import descriptors', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('84h/0h/0h', MAINNET_XPUB, '/0/7'));
      }).toThrow('Descriptor key paths must end');
    });

    it('rejects multisig descriptors that mix receive and change branches', () => {
      expect(() => {
        parseDescriptorForImport(
          sortedMulti(
            2,
            `[aabbccdd/48h/0h/0h/2h]${MAINNET_XPUB}/0/*`,
            `[11223344/48h/0h/0h/2h]${MAINNET_XPUB_2}/1/*`,
          ),
        );
      }).toThrow();
    });

    it('rejects malformed cosigner suffixes instead of ignoring the cosigner', () => {
      expect(() => {
        parseDescriptorForImport(
          sortedMulti(
            1,
            `[aabbccdd/48h/0h/0h/2h]${MAINNET_XPUB}/0/*`,
            `[11223344/48h/0h/0h/2h]${MAINNET_XPUB_2}/0/*:ignored`,
          ),
        );
      }).toThrow();
    });

    it('rejects malformed cosigner xpubs instead of importing a smaller quorum', () => {
      expect(() => {
        parseDescriptorForImport(
          sortedMulti(
            1,
            `[aabbccdd/48h/0h/0h/2h]${MAINNET_XPUB}/0/*`,
            '[11223344/48h/0h/0h/2h]invalid-xpub/0/*',
          ),
        );
      }).toThrow();
    });

    it('rejects raw descriptor candidates that do not match supported key expressions', () => {
      expect(() => {
        validateRawDescriptorDomain('wpkh([d34db33f/84h/0h/0h]not-a-public-key)', 1);
      }).toThrow('Descriptor key paths must end in /0/* or /1/*');
    });

    it('rejects quorum larger than signer count', () => {
      expect(() => {
        parseDescriptorForImport(sortedMulti(3));
      }).toThrow();
    });

    it('rejects zero-of-n multisig descriptors', () => {
      expect(() => {
        parseDescriptorForImport(sortedMulti(0));
      }).toThrow('Multisig quorum must be a positive integer');
    });

    it('rejects duplicate multisig cosigner keys', () => {
      const duplicate = `[aabbccdd/48h/0h/0h/2h]${MAINNET_XPUB}/0/*`;
      expect(() => {
        parseDescriptorForImport(sortedMulti(2, duplicate, duplicate));
      }).toThrow();
    });

    it('rejects script and account path purpose mismatches', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('49h/0h/0h'));
      }).toThrow('Descriptor origin is not a canonical account path for its wrapper');
    });

    it('rejects account-root descriptors without an account purpose path', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('m/'));
      }).toThrow('Descriptor origin is not a canonical account path for its wrapper');
    });

    it('rejects nonnumeric derivation path components in descriptors', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('84h/not-a-number/0h'));
      }).toThrow('Descriptor origin is not a canonical account path for its wrapper');
    });

    it('rejects derivation path components above the BIP32 index range', () => {
      expect(() => {
        parseDescriptorForImport(wpkh('2147483648h/0h/0h'));
      }).toThrow('Descriptor origin is not a canonical account path for its wrapper');
    });

    it('rejects legacy multisig descriptors with single-sig account paths', () => {
      expect(() => {
        parseDescriptorForImport(
          `sh(sortedmulti(2,[aabbccdd/44h/0h/0h]${MAINNET_XPUB}/0/*,[11223344/44h/0h/0h]${MAINNET_XPUB_2}/0/*))`,
        );
      }).toThrow('Unsupported descriptor format');
    });

    it('rejects native multisig descriptors that are not BIP48 multisig paths', () => {
      expect(() => {
        parseDescriptorForImport(
          sortedMulti(
            2,
            `[aabbccdd/45h]${MAINNET_XPUB}/0/*`,
            `[11223344/45h]${MAINNET_XPUB_2}/0/*`,
          ),
        );
      }).toThrow('Descriptor origin is not a canonical account path for its wrapper');
    });

    it('rejects nested multisig descriptors with native-segwit account paths', () => {
      expect(() => {
        parseDescriptorForImport(
          `sh(wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/2h]${TESTNET_TPUB}/0/*,[11223344/48h/1h/0h/2h]${TESTNET_TPUB}/0/*)))`,
        );
      }).toThrow('Descriptor origin is not a canonical account path for its wrapper');
    });

    it('rejects native multisig descriptors with nested-segwit account paths', () => {
      expect(() => {
        parseDescriptorForImport(
          sortedMulti(
            2,
            `[aabbccdd/48h/0h/0h/1h]${MAINNET_XPUB}/0/*`,
            `[11223344/48h/0h/0h/1h]${MAINNET_XPUB_2}/0/*`,
          ),
        );
      }).toThrow();
    });

    it('returns domain validation messages from validateDescriptor', () => {
      const error = validateDescriptor(wpkh('84h/1h/0h'));

      expect(error?.message).toContain('xpub network does not match derivation path coin type');
    });
  });

  describe('Parsed import domain validation', () => {
    const parsedDevice = (
      derivationPath: string,
      xpub = MAINNET_XPUB,
      fingerprint = 'd34db33f',
    ) => ({ fingerprint, derivationPath, xpub });

    it('validates raw descriptor key counts and one fixed branch', () => {
      expect(() => validateRawDescriptorDomain('no descriptor keys here', 0)).not.toThrow();
      expect(() => validateRawDescriptorDomain(wpkh('84h/0h/0h'), 1)).not.toThrow();
      expect(() => validateRawDescriptorDomain(wpkh('84h/0h/0h'), 2))
        .toThrow('Invalid descriptor key expression');
      expect(() => validateRawDescriptorDomain(
        `wpkh([d34db33f/84h/0h/0h]xpubCandidateWithoutSuffix)`,
        1,
      )).toThrow('Descriptor key paths must end in /0/* or /1/*');
      expect(() => validateRawDescriptorDomain(
        sortedMulti(
          2,
          `[aabbccdd/48h/0h/0h/2h]${MAINNET_XPUB}/0/*`,
          `[11223344/48h/0h/0h/2h]${MAINNET_XPUB_2}/1/*`,
        ),
        2,
      )).toThrow('single receive/change branch');
    });

    it('rejects malformed parsed quorum and derivation components', () => {
      const multisig = (quorum: number | undefined): ParsedDescriptor => ({
        type: 'multi_sig',
        scriptType: 'native_segwit',
        devices: [
          parsedDevice("m/48'/0'/0'/2'"),
          parsedDevice("m/48'/0'/0'/2'", MAINNET_XPUB_2, '11223344'),
        ],
        network: 'mainnet',
        isChange: false,
        quorum,
        totalSigners: 2,
      });
      expect(() => validateParsedDescriptorDomain(multisig(undefined)))
        .toThrow('positive integer');
      expect(() => validateParsedDescriptorDomain(multisig(3)))
        .toThrow('cannot exceed signer count');

      const single = (path: string): ParsedDescriptor => ({
        type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet', isChange: false,
        devices: [parsedDevice(path)],
      });
      expect(() => validateParsedDescriptorDomain(single("m/84'/word/0'")))
        .toThrow('Invalid descriptor derivation path component');
      expect(() => validateParsedDescriptorDomain(single("m/84'/0'/9007199254740993'")))
        .toThrow('component is out of range');
      expect(() => validateParsedDescriptorDomain(single('m'), { allowAccountRootPath: false }))
        .toThrow('Invalid descriptor derivation path');
      expect(() => validateParsedDescriptorDomain(single("m/84'/2'/0'")))
        .toThrow('coin type is unsupported');
    });

    it('enforces script-purpose semantics for every supported policy family', () => {
      const validate = (
        type: ParsedDescriptor['type'],
        scriptType: ParsedDescriptor['scriptType'],
        path: string,
      ) => validateParsedDescriptorDomain({
        type,
        scriptType,
        network: 'mainnet',
        isChange: false,
        devices: type === 'single_sig'
          ? [parsedDevice(path)]
          : [
            parsedDevice(path),
            parsedDevice(path, MAINNET_XPUB_2, '11223344'),
          ],
        ...(type === 'multi_sig' ? { quorum: 2, totalSigners: 2 } : {}),
      }, { enforceScriptPurpose: true });

      expect(() => validate('single_sig', 'native_segwit', "m/49'/0'/0'"))
        .toThrow('script type does not match');
      expect(() => validate('single_sig', 'native_segwit', 'm')).not.toThrow();
      expect(() => validate('multi_sig', 'legacy', "m/44'/0'/0'"))
        .toThrow('script type does not match');
      expect(() => validate('multi_sig', 'legacy', "m/45'/0'/0'"))
        .not.toThrow();
      expect(() => validate('multi_sig', 'native_segwit', "m/45'/0'/0'"))
        .toThrow('script type does not match');
      expect(() => validate('multi_sig', 'nested_segwit', "m/48'/0'/0'/2'"))
        .toThrow('script type does not match');
      expect(() => validate('multi_sig', 'nested_segwit', "m/48'/0'/0'/1'"))
        .not.toThrow();
      expect(() => validate('multi_sig', 'native_segwit', "m/48'/0'/0'/1'"))
        .toThrow('script type does not match');
      expect(() => validate('multi_sig', 'native_segwit', "m/48'/0'/0'/2'"))
        .not.toThrow();
    });

    it('rejects mixed parsed networks and duplicate multisig signer rows', () => {
      expect(() => validateParsedDescriptorDomain({
        type: 'multi_sig', scriptType: 'native_segwit', network: 'mainnet', isChange: false,
        quorum: 2, totalSigners: 2,
        devices: [
          parsedDevice("m/48'/0'/0'/2'"),
          parsedDevice("m/48'/1'/0'/2'", TESTNET_TPUB, '11223344'),
        ],
      })).toThrow('same network family');

      const duplicate = parsedDevice("m/48'/0'/0'/2'");
      expect(() => validateParsedDescriptorDomain({
        type: 'multi_sig', scriptType: 'native_segwit', network: 'mainnet', isChange: false,
        quorum: 2, totalSigners: 2, devices: [duplicate, { ...duplicate }],
      })).toThrow('Duplicate multisig cosigner key');
    });

    it('rejects malformed parsed single-sig descriptors with no signer', () => {
      const parsed: ParsedDescriptor = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [],
        network: 'mainnet',
        isChange: false,
      };

      expect(() => validateParsedDescriptorDomain(parsed)).toThrow(
        'Single-sig descriptors must contain exactly one signer',
      );
    });

    it('rejects private extended keys in JSON import configs', () => {
      const config: JsonImportConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [{
          fingerprint: 'd34db33f',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xprv9s21ZrQH143K3privateKeyMaterial',
        }],
      };

      expect(() => parseJsonImport(config)).toThrow('Private extended keys are not allowed');
    });

    it('rejects JSON imports whose derivation coin type conflicts with the xpub network', () => {
      const config: JsonImportConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [{
          fingerprint: 'd34db33f',
          derivationPath: "m/84'/1'/0'",
          xpub: MAINNET_XPUB,
        }],
      };

      expect(() => parseJsonImport(config)).toThrow('xpub network does not match derivation path coin type');
    });

    it('rejects JSON imports with unsupported extended public key prefixes', () => {
      const config: JsonImportConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [{
          fingerprint: 'd34db33f',
          derivationPath: "m/84'/0'/0'",
          xpub: `apub${MAINNET_XPUB.slice(4)}`,
        }],
      };

      expect(() => parseJsonImport(config)).toThrow('Unsupported extended public key prefix');
    });

    it('rejects JSON imports whose declared network conflicts with the xpub network', () => {
      const config: JsonImportConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        devices: [{
          fingerprint: 'd34db33f',
          derivationPath: "m/84'/0'/0'",
          xpub: MAINNET_XPUB,
        }],
      };

      expect(() => parseJsonImport(config)).toThrow(
        'Descriptor network does not match extended public key network',
      );
    });

    it('rejects JSON imports that declare mainnet for testnet xpubs', () => {
      const config: JsonImportConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [{
          fingerprint: 'd34db33f',
          derivationPath: "m/84'/1'/0'",
          xpub: TESTNET_TPUB,
        }],
      };

      expect(() => parseJsonImport(config)).toThrow(
        'Descriptor network does not match extended public key network',
      );
    });

    it('rejects quorum/device mismatches in BlueWallet text imports', () => {
      const text = [
        '# BlueWallet Multisig setup file',
        'Policy: 3 of 2',
        'Sorted: true',
        "Derivation: m/48'/0'/0'/2'",
        'Format: P2WSH',
        `aabbccdd: ${MAINNET_XPUB}`,
        `11223344: ${MAINNET_XPUB_2}`,
      ].join('\n');

      expect(() => parseBlueWalletTextImport(text)).toThrow(
        'BlueWallet Policy quorum must be within the declared signer count',
      );
    });
  });
}
