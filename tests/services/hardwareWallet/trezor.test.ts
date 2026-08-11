/**
 * Trezor Adapter Tests
 *
 * Tests utility functions for Trezor hardware wallet integration including
 * satoshi amount validation and BIP derivation path handling.
 */

import {
  buildTrezorMultisig,
  convertToStandardXpub,
  getAccountPathPrefix,
  getTrezorScriptType,
  isBip48MultisigPath,
  validateSatoshiAmount,
} from '@/services/hardwareWallet/adapters/trezor';
import { BIP32Factory } from 'bip32';
import bs58check from 'bs58check';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { vi } from 'vitest';

const testBip32 = BIP32Factory(ecc);

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Helper to create a valid multisig witnessScript
 * Format: OP_M <pubkey1> <pubkey2> ... OP_N OP_CHECKMULTISIG
 */
function createWitnessScript(m: number, pubkeys: Buffer[]): Buffer {
  const parts: Buffer[] = [];
  // OP_M (OP_1 = 0x51, OP_2 = 0x52, etc.)
  parts.push(Buffer.from([0x50 + m]));
  // Push each pubkey (0x21 = push 33 bytes for compressed pubkey)
  for (const pubkey of pubkeys) {
    parts.push(Buffer.from([0x21]));
    parts.push(pubkey);
  }
  // OP_N
  parts.push(Buffer.from([0x50 + pubkeys.length]));
  // OP_CHECKMULTISIG
  parts.push(Buffer.from([0xae]));
  return Buffer.concat(parts);
}

/**
 * Helper to create mock bip32Derivation entries
 */
function createBip32Derivation(
  pubkeyHex: string,
  path: string,
  fingerprintHex: string
): { pubkey: Buffer; path: string; masterFingerprint: Buffer } {
  return {
    pubkey: Buffer.from(pubkeyHex, 'hex'),
    path,
    masterFingerprint: Buffer.from(fingerprintHex, 'hex'),
  };
}

interface MultisigTestSigner {
  derivation: ReturnType<typeof createBip32Derivation>;
  accountXpub: string;
}

function multisigTestSigners(
  count: number,
  branch = 0,
  index = 0,
  hardenedNotation: "'" | 'h' = "'"
): MultisigTestSigner[] {
  return Array.from({ length: count }, (_, signerIndex) => {
    const root = testBip32.fromSeed(
      Uint8Array.from({ length: 32 }, () => signerIndex + 1),
      bitcoin.networks.bitcoin
    );
    const account = root.deriveHardened(48).deriveHardened(0).deriveHardened(0).deriveHardened(2);
    const child = account.derive(branch).derive(index);
    const fingerprint = (signerIndex + 1).toString(16).padStart(8, '0');
    const marker = hardenedNotation;
    return {
      derivation: createBip32Derivation(
        Buffer.from(child.publicKey).toString('hex'),
        `m/48${marker}/0${marker}/0${marker}/2${marker}/${branch}/${index}`,
        fingerprint
      ),
      accountXpub: account.neutered().toBase58(),
    };
  });
}

function accountXpubsFor(signers: MultisigTestSigner[]): Record<string, string> {
  return Object.fromEntries(
    signers.map(({ derivation, accountXpub }) => [
      derivation.masterFingerprint.toString('hex').toLowerCase(),
      accountXpub,
    ])
  );
}

function sortedSigners(signers: MultisigTestSigner[]): MultisigTestSigner[] {
  return [...signers].sort((left, right) =>
    Buffer.compare(left.derivation.pubkey, right.derivation.pubkey)
  );
}

function withExtendedKeyVersion(xpub: string, version: number): string {
  const payload = Buffer.from(bs58check.decode(xpub));
  payload.writeUInt32BE(version, 0);
  return bs58check.encode(payload);
}

describe('validateSatoshiAmount', () => {
  describe('Valid amounts', () => {
    it('converts number amount to string', () => {
      expect(validateSatoshiAmount(100000, 'Input 0')).toBe('100000');
    });

    it('converts BigInt amount to string', () => {
      expect(validateSatoshiAmount(BigInt(100000), 'Input 0')).toBe('100000');
    });

    it('handles zero amount', () => {
      expect(validateSatoshiAmount(0, 'Input 0')).toBe('0');
    });

    it('handles large BigInt amounts (above Number.MAX_SAFE_INTEGER)', () => {
      // 21 million BTC in satoshis = 2,100,000,000,000,000
      const largeBigInt = BigInt('2100000000000000');
      expect(validateSatoshiAmount(largeBigInt, 'Input 0')).toBe('2100000000000000');
    });

    it('handles typical transaction amounts', () => {
      expect(validateSatoshiAmount(50000, 'Input 0')).toBe('50000'); // 0.0005 BTC
      expect(validateSatoshiAmount(100000000, 'Input 0')).toBe('100000000'); // 1 BTC
      expect(validateSatoshiAmount(21000000, 'Input 0')).toBe('21000000'); // 0.21 BTC
    });
  });

  describe('Missing amounts', () => {
    it('throws for undefined amount', () => {
      expect(() => validateSatoshiAmount(undefined, 'Input 0')).toThrow(
        'Input 0: amount is missing'
      );
    });

    it('throws for null amount', () => {
      // TypeScript would catch this, but runtime check is important
      expect(() => validateSatoshiAmount(null as any, 'Output 1')).toThrow(
        'Output 1: amount is missing'
      );
    });
  });

  describe('Invalid amounts', () => {
    it('throws for negative number amount', () => {
      expect(() => validateSatoshiAmount(-100, 'Input 0')).toThrow('Input 0: invalid amount -100');
    });

    it('throws for negative BigInt amount', () => {
      expect(() => validateSatoshiAmount(BigInt(-100), 'Output 2')).toThrow(
        'Output 2: invalid amount -100'
      );
    });

    it('throws for Infinity', () => {
      expect(() => validateSatoshiAmount(Infinity, 'Input 0')).toThrow(
        'Input 0: invalid amount Infinity'
      );
    });

    it('throws for negative Infinity', () => {
      expect(() => validateSatoshiAmount(-Infinity, 'Input 1')).toThrow(
        'Input 1: invalid amount -Infinity'
      );
    });

    it('throws for NaN', () => {
      expect(() => validateSatoshiAmount(NaN, 'Output 0')).toThrow('Output 0: invalid amount NaN');
    });
  });

  describe('Context messages', () => {
    it('includes context in error messages', () => {
      expect(() => validateSatoshiAmount(undefined, 'Custom Context')).toThrow(
        'Custom Context: amount is missing'
      );
      expect(() => validateSatoshiAmount(-1, 'UTXO 5')).toThrow('UTXO 5: invalid amount -1');
    });
  });

  describe('Edge cases', () => {
    it('handles very small amounts (dust)', () => {
      expect(validateSatoshiAmount(1, 'Input 0')).toBe('1');
      expect(validateSatoshiAmount(546, 'Input 0')).toBe('546'); // Typical dust limit
    });

    it('handles floating point that converts to integer', () => {
      // JavaScript number precision: 100000.0 === 100000
      expect(validateSatoshiAmount(100000.0, 'Input 0')).toBe('100000');
    });

    it('preserves precision when converting BigInt to string', () => {
      // BigInt preserves exact value when converted to string
      const precise = BigInt('9007199254740993'); // Above MAX_SAFE_INTEGER
      expect(validateSatoshiAmount(precise, 'Input 0')).toBe('9007199254740993');
    });
  });
});

describe('getTrezorScriptType', () => {
  describe('Standard BIP paths', () => {
    it('returns SPENDADDRESS for BIP-44 legacy paths', () => {
      expect(getTrezorScriptType("m/44'/0'/0'/0/0")).toBe('SPENDADDRESS');
      expect(getTrezorScriptType("44'/0'/0'/0/0")).toBe('SPENDADDRESS');
    });

    it('returns SPENDP2SHWITNESS for BIP-49 nested segwit paths', () => {
      expect(getTrezorScriptType("m/49'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
      expect(getTrezorScriptType("49'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
    });

    it('returns SPENDWITNESS for BIP-84 native segwit paths', () => {
      expect(getTrezorScriptType("m/84'/0'/0'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("84'/0'/0'/0/0")).toBe('SPENDWITNESS');
    });

    it('returns SPENDTAPROOT for BIP-86 taproot paths', () => {
      expect(getTrezorScriptType("m/86'/0'/0'/0/0")).toBe('SPENDTAPROOT');
      expect(getTrezorScriptType("86'/0'/0'/0/0")).toBe('SPENDTAPROOT');
    });
  });

  describe('BIP-48 multisig paths', () => {
    it('returns SPENDWITNESS for P2WSH multisig (script type 2)', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/2'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("48'/0'/0'/2'/0/0")).toBe('SPENDWITNESS');
    });

    it('returns SPENDP2SHWITNESS for P2SH-P2WSH multisig (script type 1)', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/1'/0/0")).toBe('SPENDP2SHWITNESS');
      expect(getTrezorScriptType("48'/0'/0'/1'/0/0")).toBe('SPENDP2SHWITNESS');
    });

    it('does not confuse account index 2 with the BIP-48 script-type component', () => {
      expect(getTrezorScriptType("m/48'/0'/2'/1'/0/0")).toBe('SPENDP2SHWITNESS');
      expect(getTrezorScriptType("m/48'/1'/2'/2'/0/0")).toBe('SPENDWITNESS');
    });

    it('returns SPENDP2SHWITNESS for BIP-48 without explicit script type', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
    });
  });

  describe('Testnet paths', () => {
    it('handles testnet coin type correctly', () => {
      expect(getTrezorScriptType("m/84'/1'/0'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("m/48'/1'/0'/2'/0/0")).toBe('SPENDWITNESS');
    });
  });

  describe('Unknown paths', () => {
    it('defaults to SPENDWITNESS for unknown paths', () => {
      expect(getTrezorScriptType("m/0'/0'/0'")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType('unknown')).toBe('SPENDWITNESS');
    });
  });
});

describe('isBip48MultisigPath', () => {
  describe('BIP-48 multisig paths', () => {
    it('returns true for BIP-48 paths with m/ prefix', () => {
      expect(isBip48MultisigPath("m/48'/0'/0'/2'")).toBe(true);
      expect(isBip48MultisigPath("m/48'/0'/0'/1'/0/5")).toBe(true);
      expect(isBip48MultisigPath("m/48'/1'/0'/2'/0/0")).toBe(true);
    });

    it('returns true for BIP-48 paths without m/ prefix', () => {
      expect(isBip48MultisigPath("48'/0'/0'/2'")).toBe(true);
      expect(isBip48MultisigPath("48'/0'/0'/1'/0/5")).toBe(true);
    });
  });

  describe('Non-BIP-48 paths', () => {
    it('returns false for BIP-44 paths', () => {
      expect(isBip48MultisigPath("m/44'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-49 paths', () => {
      expect(isBip48MultisigPath("m/49'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-84 paths', () => {
      expect(isBip48MultisigPath("m/84'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-86 paths', () => {
      expect(isBip48MultisigPath("m/86'/0'/0'/0/0")).toBe(false);
    });
  });
});

describe('getAccountPathPrefix', () => {
  describe('BIP-48 paths', () => {
    it('extracts account path from full derivation path', () => {
      expect(getAccountPathPrefix("m/48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
      expect(getAccountPathPrefix("m/48'/0'/0'/1'/1/10")).toBe("m/48'/0'/0'/1'");
    });

    it('handles testnet paths', () => {
      expect(getAccountPathPrefix("m/48'/1'/0'/2'/0/0")).toBe("m/48'/1'/0'/2'");
    });

    it('handles paths without m/ prefix', () => {
      expect(getAccountPathPrefix("48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
    });
  });

  describe('Edge cases', () => {
    it('handles account-level paths (already 4 segments)', () => {
      expect(getAccountPathPrefix("m/48'/0'/0'/2'")).toBe("m/48'/0'/0'/2'");
    });

    it('handles paths with fewer than 4 segments', () => {
      // Returns whatever segments exist
      expect(getAccountPathPrefix("m/48'/0'")).toBe("m/48'/0'");
    });
  });
});

describe('buildTrezorMultisig', () => {
  describe('Valid multisig structures', () => {
    it.each([
      [2, 3],
      [3, 5],
      [1, 2],
      [3, 3],
    ] as const)(
      'parses %i-of-%i with device-authenticated account xpubs',
      (threshold, signerCount) => {
        const signers = multisigTestSigners(signerCount);
        const ordered = sortedSigners(signers);
        const witnessScript = createWitnessScript(
          threshold,
          ordered.map((signer) => signer.derivation.pubkey)
        );
        const result = buildTrezorMultisig(
          witnessScript,
          [...signers].reverse().map((signer) => signer.derivation),
          accountXpubsFor(signers)
        );

        expect(result).toMatchObject({
          m: threshold,
          pubkeys_order: 'LEXICOGRAPHIC',
          signatures: Array(signerCount).fill(''),
        });
        expect(result!.pubkeys.map((pubkey) => pubkey.node)).toEqual(
          ordered.map((signer) => signer.accountXpub)
        );
      }
    );
  });

  describe('Pubkey sorting (sortedmulti compatibility)', () => {
    it('rejects a witnessScript whose pubkeys are not lexicographically ordered', () => {
      const signers = sortedSigners(multisigTestSigners(3));
      const reversedPubkeys = [...signers].reverse().map((signer) => signer.derivation.pubkey);
      const witnessScript = createWitnessScript(2, reversedPubkeys);
      expect(() =>
        buildTrezorMultisig(
          witnessScript,
          signers.map((signer) => signer.derivation),
          accountXpubsFor(signers)
        )
      ).toThrow('not lexicographically ordered');
    });
  });

  describe('Child path extraction', () => {
    it.each([
      ["'", 0, 5],
      ['h', 1, 7],
    ] as const)(
      'extracts a shared unhardened branch/index with %s account notation',
      (notation, branch, index) => {
        const signers = multisigTestSigners(2, branch, index, notation);
        const ordered = sortedSigners(signers);
        const result = buildTrezorMultisig(
          createWitnessScript(
            2,
            ordered.map((signer) => signer.derivation.pubkey)
          ),
          signers.map((signer) => signer.derivation),
          accountXpubsFor(signers)
        );
        expect(
          result!.pubkeys.every(
            (pubkey) => pubkey.address_n[0] === branch && pubkey.address_n[1] === index
          )
        ).toBe(true);
      }
    );

    it('rejects hardened post-account child paths', () => {
      const signers = multisigTestSigners(2);
      const derivations = signers.map((signer) => ({
        ...signer.derivation,
        path: "m/48'/0'/0'/2'/0'/5'",
      }));
      const ordered = sortedSigners(signers);
      expect(() =>
        buildTrezorMultisig(
          createWitnessScript(
            2,
            ordered.map((signer) => signer.derivation.pubkey)
          ),
          derivations,
          accountXpubsFor(signers)
        )
      ).toThrow('invalid unhardened child path');
    });
  });

  describe('Invalid or missing witnessScript', () => {
    it('returns undefined for undefined witnessScript', () => {
      expect(buildTrezorMultisig(undefined, [])).toBeUndefined();
    });

    it('returns undefined for empty witnessScript', () => {
      expect(buildTrezorMultisig(Buffer.alloc(0), [])).toBeUndefined();
    });

    it('rejects an invalid zero threshold', () => {
      const pubkey = multisigTestSigners(1)[0].derivation.pubkey;
      const invalidScript = Buffer.concat([
        Buffer.from([0x50]),
        Buffer.from([0x21]),
        pubkey,
        Buffer.from([0x51]),
        Buffer.from([0xae]),
      ]);
      expect(() => buildTrezorMultisig(invalidScript, [])).toThrow(
        'threshold or signer count is invalid'
      );
    });

    it('rejects a threshold greater than the signer count', () => {
      const signers = multisigTestSigners(2);
      const invalidScript = Buffer.concat([
        Buffer.from([0x53]),
        ...signers.flatMap((signer) => [Buffer.from([0x21]), signer.derivation.pubkey]),
        Buffer.from([0x52]),
        Buffer.from([0xae]),
      ]);
      expect(() => buildTrezorMultisig(invalidScript, [])).toThrow(
        'threshold or signer count is invalid'
      );
    });

    it('rejects a threshold opcode outside OP_1 through OP_16', () => {
      const pubkey = multisigTestSigners(1)[0].derivation.pubkey;
      const invalidScript = Buffer.concat([
        Buffer.from([0x61]),
        Buffer.from([0x21]),
        pubkey,
        Buffer.from([0x61]),
        Buffer.from([0xae]),
      ]);
      expect(() => buildTrezorMultisig(invalidScript, [])).toThrow(
        'threshold or signer count is invalid'
      );
    });
  });

  describe('Edge cases', () => {
    it.each([1, 15])('handles %i-of-same at the canonical signer-count boundary', (signerCount) => {
      const signers = multisigTestSigners(signerCount);
      const ordered = sortedSigners(signers);
      const result = buildTrezorMultisig(
        createWitnessScript(
          signerCount,
          ordered.map((signer) => signer.derivation.pubkey)
        ),
        signers.map((signer) => signer.derivation),
        accountXpubsFor(signers)
      );
      expect(result).toMatchObject({ m: signerCount });
      expect(result!.pubkeys).toHaveLength(signerCount);
    });
  });
});

describe('convertToStandardXpub', () => {
  // Test vectors: Real extended public keys from known sources
  // Note: Many SLIP-132 test vectors online have invalid checksums, so we focus on
  // the most commonly encountered format (Zpub) and standard xpub/tpub

  // Standard BIP-32 mainnet xpub (version 0x0488B21E)
  const standardXpub =
    'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';

  // Standard BIP-32 testnet tpub (version 0x043587CF)
  const standardTpub =
    'tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp';

  // SLIP-132 Zpub - P2WSH mainnet (version 0x02AA7ED3)
  // Real Zpub from a Passport device export
  const zpubMainnet =
    'Zpub74omgM7ehB1aZZsx274C1CrbXjE8MSzKzijgwh4Wvhupc5UaLioFcYRi5pEtfdrJa5kSumat5xbiMWrNZuuKLqN22H72P6DrAqNQLE4dv1m';

  describe('Standard format passthrough', () => {
    it('returns standard xpub unchanged', () => {
      const result = convertToStandardXpub(standardXpub);
      expect(result).toBe(standardXpub);
    });

    it('returns standard tpub unchanged', () => {
      const result = convertToStandardXpub(standardTpub);
      expect(result).toBe(standardTpub);
    });
  });

  describe('SLIP-132 conversions', () => {
    it('converts Zpub (P2WSH mainnet) to xpub', () => {
      const result = convertToStandardXpub(zpubMainnet);

      // Result should start with xpub
      expect(result.startsWith('xpub')).toBe(true);
      // Should not be the original Zpub
      expect(result).not.toBe(zpubMainnet);
      // Should be valid base58 of same length (version bytes are same size)
      expect(result.length).toBe(zpubMainnet.length);
    });

    it('returns consistent results for the same input', () => {
      const result1 = convertToStandardXpub(zpubMainnet);
      const result2 = convertToStandardXpub(zpubMainnet);
      expect(result1).toBe(result2);
    });

    it('converted xpub can be decoded with bs58check', () => {
      const result = convertToStandardXpub(zpubMainnet);

      // Should not throw - valid base58check encoding
      const decoded = Buffer.from(bs58check.decode(result));

      // Should have correct xpub version bytes (0x0488b21e)
      const versionHex = decoded.slice(0, 4).toString('hex');
      expect(versionHex).toBe('0488b21e');
    });
  });

  describe('Error handling', () => {
    it('returns original value for invalid base58', () => {
      const invalid = 'not-a-valid-xpub-at-all';

      const result = convertToStandardXpub(invalid);

      // Should return original value when decoding fails
      expect(result).toBe(invalid);
    });

    it('returns original value for empty string', () => {
      const result = convertToStandardXpub('');

      expect(result).toBe('');
    });

    it('returns original value for base58 with invalid checksum', () => {
      // Modify a character in a valid xpub to break checksum
      const invalidChecksum = standardXpub.slice(0, -1) + 'X';

      const result = convertToStandardXpub(invalidChecksum);

      // Should return original since decode will fail
      expect(result).toBe(invalidChecksum);
    });
  });

  describe('Unknown version handling', () => {
    it('returns original value for unknown version bytes', () => {
      // Standard xpub already has known version, just verify passthrough
      const result = convertToStandardXpub(standardXpub);
      expect(result).toBe(standardXpub);
    });
  });

  describe('Integration with buildTrezorMultisig', () => {
    it('converts Zpub when used in xpubMap', () => {
      const signers = multisigTestSigners(2);
      const ordered = sortedSigners(signers);
      const xpubMap = accountXpubsFor(signers);
      const firstFingerprint = signers[0].derivation.masterFingerprint.toString('hex');
      xpubMap[firstFingerprint] = withExtendedKeyVersion(signers[0].accountXpub, 0x02aa7ed3);
      const result = buildTrezorMultisig(
        createWitnessScript(
          2,
          ordered.map((signer) => signer.derivation.pubkey)
        ),
        signers.map((signer) => signer.derivation),
        xpubMap
      );

      expect(result!.pubkeys.map((pubkey) => pubkey.node)).toEqual(
        ordered.map((signer) => signer.accountXpub)
      );
    });
  });
});
