import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  authenticateProjectedTransactionOutput,
  authenticateRawTransactionOutput,
  MAX_AUTHENTICATED_TRANSACTION_WEIGHT,
  measureCanonicalRawTransactionWeight,
  parseAuthenticatedRawTransactionBytes,
  parseAuthenticatedRawTransaction,
  rawTransactionBytesFromHex,
  RawTransactionEvidenceError,
  type RawTransactionEvidenceReason,
} from '../../../../src/services/bitcoin/rawTransactionEvidence';

const SCRIPT = Uint8Array.from([0x00, 0x14, ...new Uint8Array(20).fill(0xab)]);

const EXPECTED_ERROR_MESSAGES: Record<RawTransactionEvidenceReason, string> = {
  invalid_expected_txid: 'Expected transaction id is invalid',
  malformed_raw_transaction: 'Raw transaction is malformed',
  non_canonical_raw_transaction: 'Raw transaction encoding is not canonical',
  txid_mismatch: 'Raw transaction id does not match the expected transaction id',
  invalid_vout: 'Transaction output index is invalid',
  missing_output: 'Transaction output does not exist',
  invalid_expected_script: 'Expected output script is invalid',
  amount_mismatch: 'Transaction output amount does not match expected evidence',
  script_mismatch: 'Transaction output script does not match expected evidence',
  transaction_complexity_exceeded: 'Transaction evidence exceeds the safe sync complexity limit',
  evidence_digest_mismatch: 'Transaction evidence digest does not match the sealed bytes',
};

const makeTransaction = (): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(SCRIPT, 1_234n);
  transaction.addOutput(Uint8Array.from([0x51]), 0n);
  transaction.addOutput(new Uint8Array(0), 1n);
  return transaction;
};

const makeLargeLegacyTransaction = (scriptBytes: number): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(new Uint8Array(scriptBytes), 1n);
  return transaction;
};

const makeLargeWitnessTransaction = (witnessBytes: number): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(new Uint8Array(0), 1n);
  transaction.setWitness(0, [new Uint8Array(witnessBytes)]);
  return transaction;
};

const VERSION = Buffer.alloc(4);
const MINIMAL_INPUT = Buffer.concat([
  Buffer.from([0x01]), Buffer.alloc(36), Buffer.from([0x00]), Buffer.alloc(4),
]);
const MINIMAL_OUTPUT = Buffer.concat([
  Buffer.from([0x01]), Buffer.alloc(8), Buffer.from([0x00]),
]);

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
  it.each(Object.entries(EXPECTED_ERROR_MESSAGES) as [RawTransactionEvidenceReason, string][])(
    'keeps the %s error contract static and reason-bound',
    (reason, message) => {
      const error = new RawTransactionEvidenceError(reason);
      expect(error.name).toBe('RawTransactionEvidenceError');
      expect(error.reason).toBe(reason);
      expect(error.message).toBe(message);
    },
  );

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

  it('authenticates an owned canonical byte view without hex amplification', () => {
    const transaction = makeTransaction();
    const canonicalBytes = rawTransactionBytesFromHex(transaction.toHex().toUpperCase());

    const result = parseAuthenticatedRawTransactionBytes({
      expectedTxid: transaction.getId().toUpperCase(),
      rawBytes: canonicalBytes,
    });

    expect(result.txid).toBe(transaction.getId());
    expect(result.canonicalBytes).toBe(canonicalBytes);
    expect(result.transaction.toHex()).toBe(transaction.toHex());
  });

  it('rejects invalid and mismatched txids for canonical byte evidence', () => {
    const transaction = makeTransaction();
    const rawBytes = Uint8Array.from(transaction.toBuffer());

    expectReason(() => parseAuthenticatedRawTransactionBytes({
      expectedTxid: 'invalid',
      rawBytes,
    }), 'invalid_expected_txid');
    expectReason(() => parseAuthenticatedRawTransactionBytes({
      expectedTxid: '11'.repeat(32),
      rawBytes,
    }), 'txid_mismatch');
  });

  it('rejects malformed and non-canonical byte evidence', () => {
    const transaction = makeTransaction();
    const canonical = transaction.toBuffer();
    const nonCanonical = Buffer.concat([
      canonical.subarray(0, 4),
      Buffer.from('fd0100', 'hex'),
      canonical.subarray(5),
    ]);

    expect(measureCanonicalRawTransactionWeight(new Uint8Array())).toBeUndefined();
    expectReason(() => parseAuthenticatedRawTransactionBytes({
      expectedTxid: transaction.getId(),
      rawBytes: new Uint8Array(),
    }), 'malformed_raw_transaction');
    expect(measureCanonicalRawTransactionWeight(nonCanonical)).toBeUndefined();
    expectReason(() => parseAuthenticatedRawTransactionBytes({
      expectedTxid: transaction.getId(),
      rawBytes: Uint8Array.from(nonCanonical),
    }), 'non_canonical_raw_transaction');
  });

  it('matches bitcoinjs framing across CompactSize legacy and witness boundaries', () => {
    for (const payloadBytes of [0, 1, 252, 253, 65_535, 65_536]) {
      const legacy = makeLargeLegacyTransaction(payloadBytes);
      const witness = makeLargeWitnessTransaction(payloadBytes);
      expect(measureCanonicalRawTransactionWeight(legacy.toBuffer())).toBe(legacy.weight());
      expect(measureCanonicalRawTransactionWeight(witness.toBuffer())).toBe(witness.weight());
    }
  });

  it('distinguishes legacy framing from witness marker and flag lookalikes', () => {
    const markerLikeHash = new Uint8Array(32);
    markerLikeHash[0] = 0x01;
    const markerLikeInput = new bitcoin.Transaction();
    markerLikeInput.addInput(markerLikeHash, 0);
    markerLikeInput.addOutput(SCRIPT, 1n);
    const zeroInput = new bitcoin.Transaction();
    zeroInput.addOutput(SCRIPT, 1n);
    zeroInput.addOutput(new Uint8Array(0), 1n);

    expect(measureCanonicalRawTransactionWeight(markerLikeInput.toBuffer()))
      .toBe(markerLikeInput.weight());
    expect(measureCanonicalRawTransactionWeight(zeroInput.toBuffer()))
      .toBe(zeroInput.weight());
  });

  it('reads CompactSize payload bytes without consuming adjacent script bytes', () => {
    const transaction = makeLargeLegacyTransaction(253);
    transaction.outs[0].script.fill(0xab);

    expect(measureCanonicalRawTransactionWeight(transaction.toBuffer()))
      .toBe(transaction.weight());
  });

  it.each([
    ['legacy', makeLargeLegacyTransaction(999_936)],
    ['witness', makeLargeWitnessTransaction(3_999_752)],
  ] as const)('matches bitcoinjs weight for canonical %s framing', (_encoding, transaction) => {
    const rawBytes = Uint8Array.from(transaction.toBuffer());

    expect(transaction.weight()).toBe(MAX_AUTHENTICATED_TRANSACTION_WEIGHT);
    expect(measureCanonicalRawTransactionWeight(rawBytes)).toBe(transaction.weight());
    expect(parseAuthenticatedRawTransactionBytes({
      expectedTxid: transaction.getId(),
      rawBytes,
    })).toMatchObject({ txid: transaction.getId() });
  });

  it.each([
    ['legacy', makeLargeLegacyTransaction(999_937)],
    ['witness', makeLargeWitnessTransaction(3_999_753)],
  ] as const)('rejects over-limit canonical %s framing before bitcoinjs allocation', (_encoding, transaction) => {
    const rawBytes = Uint8Array.from(transaction.toBuffer());
    const parser = vi.spyOn(bitcoin.Transaction, 'fromBuffer');

    try {
      expect(transaction.weight()).toBeGreaterThan(MAX_AUTHENTICATED_TRANSACTION_WEIGHT);
      expect(measureCanonicalRawTransactionWeight(rawBytes)).toBe(transaction.weight());
      expectReason(() => parseAuthenticatedRawTransactionBytes({
        expectedTxid: transaction.getId(),
        rawBytes,
      }), 'transaction_complexity_exceeded');
      expect(parser).not.toHaveBeenCalled();
    } finally {
      parser.mockRestore();
    }
  });

  it('rejects the combined 25,000-input and 25,000-output shape before bitcoinjs parsing', () => {
    const transaction = new bitcoin.Transaction();
    transaction.version = 2;
    for (let index = 0; index < 25_000; index += 1) {
      transaction.addInput(new Uint8Array(32), index);
      transaction.addOutput(SCRIPT, 1n);
    }
    const rawBytes = transaction.toBuffer();
    const parser = vi.spyOn(bitcoin.Transaction, 'fromBuffer');

    try {
      expect(transaction.weight()).toBe(7_200_056);
      expect(measureCanonicalRawTransactionWeight(rawBytes)).toBe(transaction.weight());
      expectReason(() => parseAuthenticatedRawTransactionBytes({
        expectedTxid: '00'.repeat(32),
        rawBytes,
      }), 'transaction_complexity_exceeded');
      expect(parser).not.toHaveBeenCalled();
    } finally {
      parser.mockRestore();
    }
  });

  it.each([
    ['empty', new Uint8Array()],
    ['version only', VERSION],
    ['truncated input', Uint8Array.from(Buffer.from('0200000001', 'hex'))],
    ['truncated input before a complete empty tail', Buffer.concat([
      VERSION, Buffer.from([0x01, 0x00]), Buffer.alloc(4),
    ])],
    ['non-canonical input count', Uint8Array.from(Buffer.from('02000000fd0100', 'hex'))],
    ['truncated 16-bit CompactSize', Buffer.concat([VERSION, Buffer.from([0xfd, 0x01])])],
    ['truncated 32-bit CompactSize', Buffer.concat([VERSION, Buffer.from([0xfe, 0x00, 0x00])])],
    ['truncated 64-bit CompactSize', Buffer.concat([VERSION, Buffer.from([0xff]), Buffer.alloc(7)])],
    ['non-canonical 32-bit CompactSize', Buffer.concat([VERSION, Buffer.from('feffff0000', 'hex')])],
    ['non-canonical 32-bit count with a fulfillable 16-bit payload', Buffer.concat([
      VERSION, Buffer.from('fefd000000', 'hex'), Buffer.alloc(253 * 41),
      MINIMAL_OUTPUT, Buffer.alloc(4),
    ])],
    ['non-canonical 64-bit CompactSize', Buffer.concat([VERSION, Buffer.from('ffffffffff00000000', 'hex')])],
    ['unsafe 64-bit CompactSize', Buffer.concat([VERSION, Buffer.from('ffffffffffffffff', 'hex')])],
    ['64-bit count masquerading as a 32-bit count and input prefix', Buffer.concat([
      VERSION, Buffer.from('ff0100000000000000', 'hex'), Buffer.alloc(32),
      Buffer.from([0x00]), Buffer.alloc(4), MINIMAL_OUTPUT, Buffer.alloc(4),
    ])],
    ['unfulfillable 32-bit input count', Buffer.concat([VERSION, Buffer.from('fe00000100', 'hex')])],
    ['unfulfillable 64-bit input count', Buffer.concat([VERSION, Buffer.from('ff0000000001000000', 'hex')])],
    ['missing input script size', Buffer.concat([VERSION, Buffer.from([0x01]), Buffer.alloc(36)])],
    ['truncated input script', Buffer.concat([
      VERSION, Buffer.from([0x01]), Buffer.alloc(36), Buffer.from([0x01]),
    ])],
    ['oversized input script before a complete empty tail', Buffer.concat([
      VERSION, Buffer.from([0x01]), Buffer.alloc(36),
      Buffer.from([0x05, 0x00]), Buffer.alloc(4),
    ])],
    ['missing output count', Buffer.concat([VERSION, MINIMAL_INPUT])],
    ['truncated output value', Buffer.concat([VERSION, MINIMAL_INPUT, Buffer.from([0x01]), Buffer.alloc(7)])],
    ['truncated output value before a complete empty tail', Buffer.concat([
      VERSION, MINIMAL_INPUT, Buffer.from([0x01, 0x00]), Buffer.alloc(4),
    ])],
    ['truncated output value before an exact locktime-sized tail', Buffer.concat([
      VERSION, MINIMAL_INPUT, Buffer.from([0x01]), Buffer.alloc(4),
    ])],
    ['missing output script size', Buffer.concat([
      VERSION, MINIMAL_INPUT, Buffer.from([0x01]), Buffer.alloc(8),
    ])],
    ['truncated output script', Buffer.concat([
      VERSION, MINIMAL_INPUT, Buffer.from([0x01]), Buffer.alloc(8), Buffer.from([0x01]),
    ])],
    ['oversized output script before a complete locktime', Buffer.concat([
      VERSION, MINIMAL_INPUT, Buffer.from([0x01]), Buffer.alloc(8), Buffer.from([0x05]),
      Buffer.alloc(4),
    ])],
    ['missing witness item count', Buffer.concat([
      VERSION, Buffer.from([0x00, 0x01]), MINIMAL_INPUT, MINIMAL_OUTPUT,
    ])],
    ['missing witness item size', Buffer.concat([
      VERSION, Buffer.from([0x00, 0x01]), MINIMAL_INPUT, MINIMAL_OUTPUT, Buffer.from([0x01]),
    ])],
    ['truncated witness item', Buffer.concat([
      VERSION, Buffer.from([0x00, 0x01]), MINIMAL_INPUT, MINIMAL_OUTPUT,
      Buffer.from([0x01, 0x01]),
    ])],
    ['oversized witness item before a complete locktime', Buffer.concat([
      VERSION, Buffer.from([0x00, 0x01]), MINIMAL_INPUT, MINIMAL_OUTPUT,
      Buffer.from([0x01, 0x05]), Buffer.alloc(4),
    ])],
    ['missing locktime', Buffer.concat([VERSION, MINIMAL_INPUT, MINIMAL_OUTPUT])],
    ['trailing byte', Buffer.concat([makeTransaction().toBuffer(), Buffer.from([0x00])])],
  ] as const)('defers malformed or non-canonical %s framing to the authoritative parser', (_case, rawBytes) => {
    expect(measureCanonicalRawTransactionWeight(rawBytes)).toBeUndefined();
  });

  it('defers structurally superfluous witness framing to the authoritative parser', () => {
    const transaction = makeTransaction();
    const legacy = transaction.toBuffer();
    const superfluousWitness = Buffer.concat([
      legacy.subarray(0, 4),
      Buffer.from([0x00, 0x01]),
      legacy.subarray(4, -4),
      Buffer.from([0x00]),
      legacy.subarray(-4),
    ]);

    expect(measureCanonicalRawTransactionWeight(superfluousWitness)).toBeUndefined();
    expectReason(() => parseAuthenticatedRawTransactionBytes({
      expectedTxid: transaction.getId(),
      rawBytes: superfluousWitness,
    }), 'malformed_raw_transaction');
  });

  it('retains the authoritative parsed-weight defense below the preflight ceiling', () => {
    const transaction = makeTransaction();
    const measuredWeight = vi.spyOn(bitcoin.Transaction.prototype, 'weight')
      .mockReturnValue(MAX_AUTHENTICATED_TRANSACTION_WEIGHT + 1);

    try {
      expectReason(() => parseAuthenticatedRawTransactionBytes({
        expectedTxid: transaction.getId(),
        rawBytes: transaction.toBuffer(),
      }), 'transaction_complexity_exceeded');
    } finally {
      measuredWeight.mockRestore();
    }
  });

  it.each(['0', 'zz'])(
    'rejects malformed raw source hex before creating a transferable buffer: %s',
    (rawHex) => {
      expectReason(() => rawTransactionBytesFromHex(rawHex), 'malformed_raw_transaction');
    },
  );

  it.each([
    ['below', MAX_AUTHENTICATED_TRANSACTION_WEIGHT - 1, true],
    ['at', MAX_AUTHENTICATED_TRANSACTION_WEIGHT, true],
    ['above', MAX_AUTHENTICATED_TRANSACTION_WEIGHT + 1, false],
  ] as const)('%s the authenticated transaction-weight ceiling', (_boundary, weight, accepted) => {
    const transaction = makeTransaction();
    const rawHex = transaction.toHex();
    const measuredWeight = vi.spyOn(bitcoin.Transaction.prototype, 'weight')
      .mockReturnValue(weight);

    try {
      const operation = () => parseAuthenticatedRawTransaction({
        expectedTxid: transaction.getId(),
        rawHex,
      });
      if (accepted) expect(operation()).toMatchObject({ txid: transaction.getId() });
      else expectReason(operation, 'transaction_complexity_exceeded');
      expect(measuredWeight).toHaveBeenCalledOnce();
    } finally {
      measuredWeight.mockRestore();
    }
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
