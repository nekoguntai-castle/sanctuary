import { describe, expect, it } from 'vitest';
import {
  computeDescriptorChecksum,
  extractDescriptorFromText,
  extractDescriptorPairFromText,
  isDescriptorTextFormat,
  parseBlueWalletTextImport,
  parseColdcardExport,
  parseDescriptorForImport,
  resolveDescriptorTextPair,
  testXpubs,
  type ScriptType,
} from './descriptorParserTestHarness';

const BLUEWALLET_XPUB_1 = 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL';
const BLUEWALLET_XPUB_2 = 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5';

export function registerDescriptorParserTextColdcardChecksumContracts(): void {
  describe('parseBlueWalletTextImport', () => {
    it('requires an explicit Policy field even when one signer row is present', () => {
      const input = `Derivation: m/84'/0'/0'
Format: P2WPKH
aabbccdd: ${BLUEWALLET_XPUB_1}`;
      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'BlueWallet import requires an explicit Policy field',
      );
    });
    it('rejects a missing Format instead of defaulting to native SegWit', () => {
      const input = `Policy: 2 of 2
Sorted: true
Derivation: m/48'/0'/0'/2'

aabbccdd: ${BLUEWALLET_XPUB_1}
11223344: ${BLUEWALLET_XPUB_2}`;
      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'BlueWallet import requires an explicit Format field',
      );
    });

    it('should throw when no device lines are present', () => {
      const input = `# BlueWallet Multisig setup file
Policy: 2 of 3
Sorted: true
Derivation: m/48'/0'/0'/2'
Format: P2WSH`;

      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'No devices found in BlueWallet text file'
      );
    });

    it('rejects a missing derivation instead of defaulting to BIP48', () => {
      const input = `# BlueWallet setup file
Policy: 1 of 1
Format: P2WPKH

aabbccdd: ${BLUEWALLET_XPUB_1}`;
      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'BlueWallet derivation path does not match the declared wallet policy',
      );
    });

    it('maps only recognized single-sig formats to matching policies', () => {
      const cases: Array<{ format: string; path: string; expected: ScriptType }> = [
        { format: 'P2PKH', path: "m/44'/0'/0'", expected: 'legacy' },
        { format: 'P2TR', path: "m/86'/0'/0'", expected: 'taproot' },
        { format: 'P2WPKH', path: "m/84'/0'/0'", expected: 'native_segwit' },
        { format: 'P2SH-P2WPKH', path: "m/49'/0'/0'", expected: 'nested_segwit' },
        { format: 'P2WPKH-P2SH', path: "m/49'/0'/0'", expected: 'nested_segwit' },
      ];

      for (const { format, path, expected } of cases) {
        const input = `# BlueWallet setup file
Policy: 1 of 1
Derivation: ${path}
Format: ${format}

aabbccdd: ${BLUEWALLET_XPUB_1}`;

        expect(parseBlueWalletTextImport(input).scriptType).toBe(expected);
      }
    });

    it.each(['SOMETHING-ELSE', 'P2SH-P2TR', 'P2TR-P2SH'])(
      'rejects unsupported Format %s instead of relabeling it',
      (format) => {
        const input = `Policy: 1 of 1
Derivation: m/84'/0'/0'
Format: ${format}
aabbccdd: ${BLUEWALLET_XPUB_1}`;
        expect(() => parseBlueWalletTextImport(input)).toThrow(`Unsupported BlueWallet Format: ${format}`);
      },
    );

    it.each([undefined, 'false'])('rejects multisig when Sorted is %s', (sorted) => {
      const sortedLine = sorted === undefined ? '' : `Sorted: ${sorted}\n`;
      const input = `Policy: 2 of 2
${sortedLine}Derivation: m/48'/0'/0'/2'
Format: P2WSH
aabbccdd: ${BLUEWALLET_XPUB_1}
11223344: ${BLUEWALLET_XPUB_2}`;
      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'BlueWallet multisig import requires Sorted: true',
      );
    });

    it('rejects Policy N that differs from the device row count', () => {
      const input = `Policy: 2 of 3
Sorted: true
Derivation: m/48'/0'/0'/2'
Format: P2WSH
aabbccdd: ${BLUEWALLET_XPUB_1}
11223344: ${BLUEWALLET_XPUB_2}`;
      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'BlueWallet Policy signer count must equal the number of device rows',
      );
    });

    it('rejects an invalid 2-of-1 policy instead of treating it as single-sig', () => {
      const input = `Policy: 2 of 1
Derivation: m/84'/0'/0'
Format: P2WPKH
aabbccdd: ${BLUEWALLET_XPUB_1}`;
      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'BlueWallet Policy quorum must be within the declared signer count',
      );
    });

    it('rejects duplicate underlying signer keys', () => {
      const input = `Policy: 2 of 2
Sorted: true
Derivation: m/48'/0'/0'/2'
Format: P2WSH
aabbccdd: ${BLUEWALLET_XPUB_1}
11223344: ${BLUEWALLET_XPUB_1}`;
      expect(() => parseBlueWalletTextImport(input)).toThrow(
        'BlueWallet import requires unique fingerprint and extended-key rows',
      );
    });

    it('should ignore non-device lines that are not recognized metadata', () => {
      const input = `# BlueWallet setup file
Policy: 1 of 1
Derivation: m/84'/0'/0'
Format: P2WPKH
Unrecognized metadata line

aabbccdd: ${BLUEWALLET_XPUB_1}`;

      const result = parseBlueWalletTextImport(input);

      expect(result.type).toBe('single_sig');
      expect(result.devices).toHaveLength(1);
    });

    it('validates testnet signer paths against the testnet derivation family', () => {
      const input = `Policy: 1 of 1
Derivation: m/84'/1'/0'
Format: P2WPKH
aabbccdd: ${testXpubs.testnet.bip84}`;

      expect(parseBlueWalletTextImport(input)).toMatchObject({
        network: 'testnet',
        scriptType: 'native_segwit',
      });
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

    it('rejects BIP48 key exports that do not define a complete multisig policy', () => {
      expect(() => parseColdcardExport({
        xfp: 'AABBCCDD',
        bip48_2: {
          xpub: testXpubs.mainnet.bip84,
          deriv: "m/48'/0'/0'/2'",
        },
      })).toThrow('Coldcard BIP48 key exports do not define a complete multisig wallet policy');
      expect(() => parseColdcardExport({
        xfp: 'AABBCCDD',
        bip48_1: {
          xpub: testXpubs.mainnet.bip49,
          deriv: "m/48'/0'/0'/1'",
        },
      })).toThrow('Coldcard BIP48 key exports do not define a complete multisig wallet policy');
    });

    it.each([
      { p2sh: testXpubs.mainnet.bip44, p2sh_deriv: "m/45'" },
      { p2wsh: testXpubs.mainnet.bip84, p2wsh_deriv: "m/48'/0'/0'/2'" },
      { p2sh_p2wsh: testXpubs.mainnet.bip49, p2sh_p2wsh_deriv: "m/48'/0'/0'/1'" },
    ])('rejects incomplete flat-format multisig key exports', (fields) => {
      expect(() => parseColdcardExport({ xfp: 'AABBCCDD', ...fields })).toThrow(
        'Coldcard multisig key exports do not define a complete wallet policy',
      );
    });

    it('rejects a derivation path that contradicts the selected policy', () => {
      expect(() => parseColdcardExport({
        xfp: 'AABBCCDD',
        bip84: { xpub: testXpubs.mainnet.bip84, deriv: "m/86'/0'/0'" },
      })).toThrow('Coldcard derivation path does not match the selected wallet policy');
    });

    it('rejects an invalid lower-priority path instead of hiding it behind bip84', () => {
      expect(() => parseColdcardExport({
        xfp: 'AABBCCDD',
        bip84: { xpub: testXpubs.mainnet.bip84, deriv: "m/84'/0'/0'" },
        bip49: { xpub: testXpubs.mainnet.bip49, deriv: "m/84'/0'/0'" },
      })).toThrow('Coldcard derivation path does not match the selected wallet policy');
    });

    it('rejects contradictory Coldcard chain metadata', () => {
      expect(() => parseColdcardExport({
        xfp: 'AABBCCDD',
        chain: 'XTN',
        bip84: { xpub: testXpubs.mainnet.bip84, deriv: "m/84'/0'/0'" },
      })).toThrow('Coldcard chain does not match the extended public key network');
    });

    it('rejects unsupported Coldcard chain identifiers', () => {
      expect(() => parseColdcardExport({
        xfp: 'AABBCCDD',
        chain: 'BCH',
        bip84: { xpub: testXpubs.mainnet.bip84, deriv: "m/84'/0'/0'" },
      })).toThrow('Coldcard export uses an unsupported chain identifier');
    });

    it('rejects partially populated standard Coldcard path records', () => {
      expect(() => parseColdcardExport({
        xfp: 'AABBCCDD',
        bip84: { xpub: testXpubs.mainnet.bip84 },
      } as any)).toThrow('Coldcard BIP path requires both an extended public key and derivation');
    });

    it('should throw when nested format has no recognized BIP paths', () => {
      expect(() => parseColdcardExport({ xfp: 'AABBCCDD' })).toThrow(
        'Coldcard export does not contain any recognized BIP derivation paths'
      );
    });
  });

  describe('Descriptor text helpers', () => {
    const descriptorXpub = 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL';
    const receiveDescriptor = `wpkh([aabbccdd/84h/0h/0h]${descriptorXpub}/0/*)`;
    const changeDescriptor = `wpkh([aabbccdd/84h/0h/0h]${descriptorXpub}/1/*)`;

    it('preserves one unlabelled descriptor token', () => {
      expect(extractDescriptorPairFromText(receiveDescriptor)).toEqual({
        receiveDescriptor,
      });
    });

    it('returns no pair when unlabelled text has no descriptor token', () => {
      expect(extractDescriptorPairFromText('ordinary recovery notes')).toBeNull();
    });

    it('extracts an exact checksummed receive/change pair from a Sanctuary recovery export', () => {
      const receiveToken = `${receiveDescriptor}#${computeDescriptorChecksum(receiveDescriptor)}`;
      const changeToken = `${changeDescriptor}#${computeDescriptorChecksum(changeDescriptor)}`;
      const input = [
        '# Wallet: Recovery',
        '# Receive Descriptor (external chain)',
        receiveToken,
        '',
        '# Change Descriptor (internal chain)',
        changeToken,
        '',
        '# Exported: 2026-08-09T00:00:00.000Z',
      ].join('\n');

      expect(extractDescriptorPairFromText(input)).toEqual({
        receiveDescriptor: receiveToken,
        changeDescriptor: changeToken,
      });
    });

    it('preserves a single multipath recovery descriptor without inventing a pair', () => {
      const multipath = receiveDescriptor.replace('/0/*', '/<0;1>/*');
      const token = `${multipath}#${computeDescriptorChecksum(multipath)}`;

      expect(extractDescriptorPairFromText([
        '# Receive Descriptor (external chain)',
        token,
      ].join('\n'))).toEqual({ receiveDescriptor: token });
    });

    it('rejects a separately supplied change token that differs from the embedded token', () => {
      const input = [
        '# Receive Descriptor (external chain)',
        receiveDescriptor,
        '# Change Descriptor (internal chain)',
        changeDescriptor,
      ].join('\n');

      expect(() => resolveDescriptorTextPair(
        input,
        changeDescriptor.replace('aabbccdd', '11223344'),
      )).toThrow('do not match exactly');
    });

    it.each([
      [
        'an unlabeled second descriptor',
        `${receiveDescriptor}\n${changeDescriptor}`,
        'multiple descriptors without receive/change labels',
      ],
      [
        'a missing labeled change descriptor',
        `# Receive Descriptor (external chain)\n${receiveDescriptor}\n# Change Descriptor (internal chain)`,
        'Change descriptor section is missing a descriptor',
      ],
      [
        'a duplicate receive descriptor',
        `# Receive Descriptor (external chain)\n${receiveDescriptor}\n${receiveDescriptor}`,
        'Receive descriptor section contains multiple descriptors',
      ],
      [
        'a descriptor outside a labeled section',
        `${receiveDescriptor}\n# Receive Descriptor (external chain)\n${receiveDescriptor}`,
        'descriptor outside its receive/change section',
      ],
      [
        'a labeled receive section without a descriptor',
        '# Receive Descriptor (external chain)\n# metadata only',
        'Receive descriptor section is missing a descriptor',
      ],
      [
        'a duplicate labeled section',
        `# Receive Descriptor (external chain)\n${receiveDescriptor}\n# Receive Descriptor (external chain)`,
        'Receive descriptor section appears more than once',
      ],
      [
        'a duplicate labeled change section',
        `# Receive Descriptor (external chain)\n${receiveDescriptor}\n# Change Descriptor (internal chain)\n${changeDescriptor}\n# Change Descriptor (internal chain)`,
        'Change descriptor section appears more than once',
      ],
    ])('fails closed on %s', (_case, input, message) => {
      expect(() => extractDescriptorPairFromText(input)).toThrow(message);
    });

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
    const validBody = `wpkh([d34db33f/84'/0'/0']${testXpubs.mainnet.bip84}/0/*)`;

    it('should reject descriptors with unsupported key expression suffixes', () => {
      const body = validBody.replace('/0/*)', '/0/*:foo)');
      const descriptor = `${body}#${computeDescriptorChecksum(body)}`;

      expect(() => parseDescriptorForImport(descriptor)).toThrow('Descriptor key paths must end');
    });

    it('rejects checksummed trailing descriptor input rather than prefix parsing it', () => {
      const body = `${validBody}_`;
      expect(() => parseDescriptorForImport(`${body}#${computeDescriptorChecksum(body)}`))
        .toThrow('Unsupported descriptor format');
    });

    it('should accept descriptor with valid checksum', () => {
      const descriptor = `${validBody}#${computeDescriptorChecksum(validBody)}`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should accept descriptor without checksum', () => {
      const descriptor = validBody;

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.devices[0].fingerprint).toBe('d34db33f');
    });

    it('should strip checksum and parse descriptor correctly', () => {
      const descriptor = `${validBody}#${computeDescriptorChecksum(validBody)}`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.devices).toHaveLength(1);
    });
  });
}
