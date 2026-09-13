import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { computeVirtualSizeFromRawTx } from '../../../../src/services/bitcoin/transactionVsize';

/**
 * Builds a structurally realistic 1-in/2-out P2WPKH transaction: one
 * witness input (signature + pubkey stack items sized like a real ECDSA
 * signature and compressed pubkey) spending to two P2WPKH outputs. The
 * witness bytes don't need to verify cryptographically for vsize purposes -
 * `virtualSize()` only cares about their length, and `parseAuthenticatedRawTransaction`
 * only checks canonical framing and txid, not signature validity.
 */
const P2WPKH_SCRIPT = Uint8Array.from([0x00, 0x14, ...new Uint8Array(20).fill(0xab)]);
const DUMMY_SIGNATURE = new Uint8Array(71).fill(0x30);
const DUMMY_PUBKEY = new Uint8Array(33).fill(0x02);

const makeSegwitTransaction = (): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32).fill(0x11), 0);
  transaction.addOutput(P2WPKH_SCRIPT, 60_000n);
  transaction.addOutput(P2WPKH_SCRIPT, 39_410n);
  transaction.setWitness(0, [DUMMY_SIGNATURE, DUMMY_PUBKEY]);
  return transaction;
};

describe('computeVirtualSizeFromRawTx', () => {
  it('computes vsize that matches bitcoinjs virtualSize() and differs from hex.length/2', () => {
    const transaction = makeSegwitTransaction();
    const rawHex = transaction.toHex();
    const byteLength = Math.ceil(rawHex.length / 2);

    const vsize = computeVirtualSizeFromRawTx(transaction.getId(), rawHex);

    expect(vsize).toBe(transaction.virtualSize());
    expect(vsize).not.toBe(byteLength);
    expect(vsize).toBeLessThan(byteLength);
  });

  it('returns undefined for missing or empty raw hex', () => {
    expect(computeVirtualSizeFromRawTx('a'.repeat(64), null)).toBeUndefined();
    expect(computeVirtualSizeFromRawTx('a'.repeat(64), undefined)).toBeUndefined();
    expect(computeVirtualSizeFromRawTx('a'.repeat(64), '')).toBeUndefined();
  });

  it('returns undefined for malformed raw hex', () => {
    expect(computeVirtualSizeFromRawTx('a'.repeat(64), 'zz')).toBeUndefined();
    expect(computeVirtualSizeFromRawTx('a'.repeat(64), 'aa'.repeat(120))).toBeUndefined();
  });

  it('returns undefined when the raw hex does not authenticate against txid', () => {
    const transaction = makeSegwitTransaction();
    const rawHex = transaction.toHex();

    expect(computeVirtualSizeFromRawTx('b'.repeat(64), rawHex)).toBeUndefined();
  });
});
