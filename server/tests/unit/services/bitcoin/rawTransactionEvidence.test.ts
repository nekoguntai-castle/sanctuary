import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import {
  authenticateProjectedTransactionOutput,
  authenticateRawTransactionOutput,
  parseAuthenticatedRawTransaction,
  RawTransactionEvidenceError,
  type RawTransactionEvidenceReason,
} from '../../../../src/services/bitcoin/rawTransactionEvidence';

const SCRIPT = Uint8Array.from([0x00, 0x14, ...new Uint8Array(20).fill(0xab)]);

const makeTransaction = (): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(SCRIPT, 1_234n);
  transaction.addOutput(Uint8Array.from([0x51]), 0n);
  transaction.addOutput(new Uint8Array(0), 1n);
  return transaction;
};

const expectReason = (
  operation: () => unknown,
  reason: RawTransactionEvidenceReason,
): RawTransactionEvidenceError => {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RawTransactionEvidenceError);
    expect(error).toMatchObject({ name: 'RawTransactionEvidenceError', reason });
    return error as RawTransactionEvidenceError;
  }
  throw new Error('Expected raw transaction authentication to fail');
};

describe('raw transaction evidence', () => {
  it('parses canonical bytes and binds them to a case-insensitive expected txid', () => {
    const transaction = makeTransaction();
    const rawHex = transaction.toHex();

    const result = parseAuthenticatedRawTransaction({
      expectedTxid: transaction.getId().toUpperCase(),
      rawHex: rawHex.toUpperCase(),
    });

    expect(result.txid).toBe(transaction.getId());
    expect(result.canonicalHex).toBe(rawHex);
    expect(result.transaction.toHex()).toBe(rawHex);
  });

  it.each([
    ['', 'malformed_raw_transaction'],
    ['0', 'malformed_raw_transaction'],
    ['zz', 'malformed_raw_transaction'],
    [`${makeTransaction().toHex()}00`, 'malformed_raw_transaction'],
  ] as const)('rejects malformed raw hex %#', (rawHex, reason) => {
    expectReason(() => parseAuthenticatedRawTransaction({
      expectedTxid: makeTransaction().getId(),
      rawHex,
    }), reason);
  });

  it('rejects a parseable transaction with non-canonical CompactSize encoding', () => {
    const transaction = makeTransaction();
    const canonical = transaction.toHex();
    const nonCanonical = `${canonical.slice(0, 8)}fd0100${canonical.slice(10)}`;

    expectReason(() => parseAuthenticatedRawTransaction({
      expectedTxid: transaction.getId(),
      rawHex: nonCanonical,
    }), 'non_canonical_raw_transaction');
  });

  it('rejects invalid and mismatched expected transaction ids without exposing raw bytes', () => {
    const transaction = makeTransaction();
    const rawHex = transaction.toHex();
    expectReason(() => parseAuthenticatedRawTransaction({
      expectedTxid: 'not-a-txid',
      rawHex,
    }), 'invalid_expected_txid');

    const error = expectReason(() => parseAuthenticatedRawTransaction({
      expectedTxid: '11'.repeat(32),
      rawHex,
    }), 'txid_mismatch');
    expect(error.message).not.toContain(rawHex);
    expect(JSON.stringify(error)).not.toContain(rawHex);
  });

  it('authenticates an exact output using bigint satoshis and script bytes', () => {
    const transaction = makeTransaction();
    const result = authenticateRawTransactionOutput({
      expectedTxid: transaction.getId(),
      rawHex: transaction.toHex(),
      vout: 0,
      expectedValueSats: 1_234n,
      expectedScriptPubKeyHex: Buffer.from(SCRIPT).toString('hex').toUpperCase(),
    });

    expect(result).toMatchObject({
      txid: transaction.getId(),
      vout: 0,
      valueSats: 1_234n,
      scriptPubKeyHex: Buffer.from(SCRIPT).toString('hex'),
    });
  });

  it('preserves a zero-satoshi output when optional evidence is omitted', () => {
    const transaction = makeTransaction();
    const result = authenticateRawTransactionOutput({
      expectedTxid: transaction.getId(),
      rawHex: transaction.toHex(),
      vout: 1,
    });

    expect(result.valueSats).toBe(0n);
    expect(result.scriptPubKeyHex).toBe('51');
  });

  it('supports byte-exact authentication of an empty output script', () => {
    const transaction = makeTransaction();
    const result = authenticateRawTransactionOutput({
      expectedTxid: transaction.getId(),
      rawHex: transaction.toHex(),
      vout: 2,
      expectedValueSats: 1n,
      expectedScriptPubKeyHex: '',
    });

    expect(result.scriptPubKeyHex).toBe('');
  });

  it.each([Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid output index %s',
    (vout) => {
      const transaction = makeTransaction();
      expectReason(() => authenticateRawTransactionOutput({
        expectedTxid: transaction.getId(), rawHex: transaction.toHex(), vout,
      }), 'invalid_vout');
    },
  );

  it('rejects a missing output', () => {
    const transaction = makeTransaction();
    expectReason(() => authenticateRawTransactionOutput({
      expectedTxid: transaction.getId(), rawHex: transaction.toHex(), vout: 3,
    }), 'missing_output');
  });

  it('rejects non-canonical expected script evidence', () => {
    const transaction = makeTransaction();
    expectReason(() => authenticateRawTransactionOutput({
      expectedTxid: transaction.getId(),
      rawHex: transaction.toHex(),
      vout: 0,
      expectedScriptPubKeyHex: '0',
    }), 'invalid_expected_script');
  });

  it('rejects exact amount and script mismatches independently', () => {
    const transaction = makeTransaction();
    const base = {
      expectedTxid: transaction.getId(), rawHex: transaction.toHex(), vout: 0,
    };
    expectReason(() => authenticateRawTransactionOutput({
      ...base, expectedValueSats: 1_235n,
    }), 'amount_mismatch');
    expectReason(() => authenticateRawTransactionOutput({
      ...base, expectedScriptPubKeyHex: '51',
    }), 'script_mismatch');
  });

  it('validates an already-authenticated compact projection without reparsing raw bytes', () => {
    const txid = 'ab'.repeat(32);
    expect(authenticateProjectedTransactionOutput({
      expectedTxid: txid.toUpperCase(),
      authenticatedTxid: txid,
      vout: 2,
      output: { value: 0.00001234, scriptPubKeyHex: '0014AB' },
      expectedValueSats: 1_234n,
      expectedScriptPubKeyHex: '0014ab',
    })).toEqual({ vout: 2, valueSats: 1_234n, scriptPubKeyHex: '0014ab' });

    expect(authenticateProjectedTransactionOutput({
      expectedTxid: txid,
      authenticatedTxid: txid,
      vout: 0,
      output: { value: 0 },
    })).toEqual({ vout: 0, valueSats: 0n, scriptPubKeyHex: '' });
  });

  it.each([
    ['invalid_expected_txid', { expectedTxid: 'bad' }],
    ['txid_mismatch', { authenticatedTxid: 'cd'.repeat(32) }],
    ['invalid_vout', { vout: -1 }],
    ['invalid_expected_script', { expectedScriptPubKeyHex: '0' }],
    ['missing_output', { output: undefined }],
    ['amount_mismatch', { expectedValueSats: 2n }],
    ['script_mismatch', { expectedScriptPubKeyHex: '51' }],
  ] as const)('rejects compact projected output evidence: %s', (reason, overrides) => {
    const txid = 'ab'.repeat(32);
    expectReason(() => authenticateProjectedTransactionOutput({
      expectedTxid: txid,
      authenticatedTxid: txid,
      vout: 0,
      output: { value: 0.00000001, scriptPubKeyHex: '0014ab' },
      expectedValueSats: 1n,
      expectedScriptPubKeyHex: '0014ab',
      ...overrides,
    }), reason);
  });
});
