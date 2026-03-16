/**
 * BIP-173 (Bech32) and BIP-350 (Bech32m) Official Test Vector Verification
 *
 * Tests bech32/bech32m encoding and SegWit address validation against
 * official test vectors from:
 * - BIP-173: https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
 * - BIP-350: https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki
 *
 * These vectors verify that:
 * - Bech32 encoding/decoding works correctly
 * - Bech32m encoding/decoding works correctly
 * - SegWit v0 addresses use bech32 encoding
 * - SegWit v1+ addresses use bech32m encoding
 * - Invalid addresses are properly rejected
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { bech32, bech32m } from 'bech32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import {
  VALID_BECH32_STRINGS,
  INVALID_BECH32_STRINGS,
  BIP173_VALID_ADDRESSES,
  BIP173_INVALID_ADDRESSES,
  VALID_BECH32M_STRINGS,
  INVALID_BECH32M_STRINGS,
  BIP350_VALID_ADDRESSES,
  BIP350_INVALID_ADDRESSES,
} from '@fixtures/bip173-bip350-test-vectors';

describe('BIP-173 Bech32 Encoding', () => {
  describe('Valid Bech32 strings', () => {
    VALID_BECH32_STRINGS.forEach((str) => {
      it(`should decode valid bech32: ${str.substring(0, 40)}...`, () => {
        expect(() => {
          bech32.decode(str, 120);
        }).not.toThrow();
      });

      it(`should round-trip: ${str.substring(0, 40)}...`, () => {
        const decoded = bech32.decode(str, 120);
        const reencoded = bech32.encode(decoded.prefix, decoded.words, 120);
        expect(reencoded.toLowerCase()).toBe(str.toLowerCase());
      });
    });
  });

  describe('Invalid Bech32 strings', () => {
    INVALID_BECH32_STRINGS.forEach((vector) => {
      it(`should reject: ${vector.reason}`, () => {
        expect(() => {
          bech32.decode(vector.str);
        }).toThrow();
      });
    });
  });
});

describe('BIP-350 Bech32m Encoding', () => {
  describe('Valid Bech32m strings', () => {
    VALID_BECH32M_STRINGS.forEach((str) => {
      it(`should decode valid bech32m: ${str.substring(0, 40)}...`, () => {
        expect(() => {
          bech32m.decode(str, 120);
        }).not.toThrow();
      });

      it(`should round-trip: ${str.substring(0, 40)}...`, () => {
        const decoded = bech32m.decode(str, 120);
        const reencoded = bech32m.encode(decoded.prefix, decoded.words, 120);
        expect(reencoded.toLowerCase()).toBe(str.toLowerCase());
      });
    });
  });

  describe('Invalid Bech32m strings', () => {
    INVALID_BECH32M_STRINGS.forEach((vector) => {
      it(`should reject: ${vector.reason}`, () => {
        expect(() => {
          bech32m.decode(vector.str);
        }).toThrow();
      });
    });
  });
});

describe('BIP-173 SegWit v0 Address Validation', () => {
  describe('Valid SegWit v0 addresses', () => {
    BIP173_VALID_ADDRESSES.forEach((vector) => {
      it(`should decode address: ${vector.address.substring(0, 40)}...`, () => {
        const decoded = decodeSegwitAddress(vector.address);
        expect(decoded).not.toBeNull();

        const scriptPubKey = buildScriptPubKey(decoded!.version, decoded!.program);
        expect(scriptPubKey.toString('hex')).toBe(vector.scriptPubKeyHex);
      });
    });
  });

  describe('Invalid SegWit v0 addresses', () => {
    BIP173_INVALID_ADDRESSES.forEach((vector) => {
      it(`should reject: ${vector.reason}`, () => {
        const decoded = decodeSegwitAddress(vector.address);
        expect(decoded).toBeNull();
      });
    });
  });
});

describe('BIP-350 SegWit Address Validation (v0 + v1+)', () => {
  describe('Valid BIP-350 addresses', () => {
    BIP350_VALID_ADDRESSES.forEach((vector) => {
      it(`should produce correct scriptPubKey: ${vector.address.substring(0, 40)}...`, () => {
        const decoded = decodeSegwitAddress(vector.address);
        expect(decoded).not.toBeNull();

        const scriptPubKey = buildScriptPubKey(decoded!.version, decoded!.program);
        expect(scriptPubKey.toString('hex')).toBe(vector.scriptPubKeyHex);
      });
    });
  });

  describe('Invalid BIP-350 addresses', () => {
    BIP350_INVALID_ADDRESSES.forEach((vector) => {
      it(`should reject: ${vector.reason}`, () => {
        const decoded = decodeSegwitAddress(vector.address);
        expect(decoded).toBeNull();
      });
    });
  });
});

describe('SegWit encoding version selection', () => {
  beforeAll(() => {
    bitcoin.initEccLib(ecc);
  });

  it('witness v0 addresses should use bech32', () => {
    const p2wpkh = 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4';
    const decoded = decodeSegwitAddress(p2wpkh);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(0);
  });

  it('witness v1 addresses should use bech32m', () => {
    const p2tr = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
    const decoded = decodeSegwitAddress(p2tr);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(1);
  });

  it('bitcoinjs-lib should create valid P2WPKH addresses', () => {
    const pubkey = Buffer.from(
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      'hex'
    );
    const payment = bitcoin.payments.p2wpkh({ pubkey });
    expect(payment.address).toBeDefined();
    expect(payment.address!.startsWith('bc1q')).toBe(true);

    const decoded = decodeSegwitAddress(payment.address!);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(0);
  });

  it('bitcoinjs-lib should create valid P2TR addresses', () => {
    const xOnlyPubkey = Buffer.from(
      '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      'hex'
    );
    const payment = bitcoin.payments.p2tr({ internalPubkey: xOnlyPubkey });
    expect(payment.address).toBeDefined();
    expect(payment.address!.startsWith('bc1p')).toBe(true);

    const decoded = decodeSegwitAddress(payment.address!);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(1);
  });
});

// ============================================================
// Helper functions for SegWit address decoding
// ============================================================

interface DecodedSegwit {
  version: number;
  program: Buffer;
}

/**
 * Decode a SegWit address per BIP-173/BIP-350 rules.
 * v0 must use bech32, v1+ must use bech32m.
 * Mixed case is rejected.
 */
function decodeSegwitAddress(address: string): DecodedSegwit | null {
  // Reject mixed case (bech32 spec requirement)
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    return null;
  }

  const lower = address.toLowerCase();
  const hrp = lower.startsWith('bc1')
    ? 'bc'
    : lower.startsWith('tb1')
      ? 'tb'
      : null;

  if (!hrp) return null;

  // Try bech32 first, then bech32m
  let decoded;
  let encoding: 'bech32' | 'bech32m';

  try {
    decoded = bech32.decode(lower);
    encoding = 'bech32';
  } catch {
    try {
      decoded = bech32m.decode(lower);
      encoding = 'bech32m';
    } catch {
      return null;
    }
  }

  if (decoded.prefix !== hrp) return null;
  if (decoded.words.length < 1) return null;

  const version = decoded.words[0];

  // Version must be 0-16
  if (version > 16) return null;

  // Version 0 must use bech32, version 1+ must use bech32m
  if (version === 0 && encoding !== 'bech32') return null;
  if (version > 0 && encoding !== 'bech32m') return null;

  // Convert 5-bit words to 8-bit program bytes
  let program: Buffer;
  try {
    program = Buffer.from(bech32.fromWords(decoded.words.slice(1)));
  } catch {
    // fromWords throws on invalid padding
    return null;
  }

  // Program length validation: 2-40 bytes
  if (program.length < 2 || program.length > 40) return null;

  // Version 0 program must be exactly 20 or 32 bytes
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;

  return { version, program };
}

/**
 * Build scriptPubKey from witness version and program
 */
function buildScriptPubKey(version: number, program: Buffer): Buffer {
  // OP_0 is 0x00, OP_1 through OP_16 are 0x51 through 0x60
  const versionOpcode = version === 0 ? 0x00 : 0x50 + version;
  return Buffer.concat([
    Buffer.from([versionOpcode, program.length]),
    program,
  ]);
}
