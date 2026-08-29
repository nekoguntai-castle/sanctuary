import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { RawTransactionEvidenceError } from '../../../../../src/services/bitcoin/rawTransactionEvidence';
import {
  extractExactAuthenticatedTransactionOutput,
  extractExactAuthenticatedTransactionOutputs,
  projectCompactAuthenticatedTransaction,
  reprojectFullAuthenticatedTransaction,
  transactionEvidenceDigest,
  transactionEvidenceFitsProjectionLimits,
} from '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection';

const WALLET_SCRIPT = Uint8Array.from([0x00, 0x14, ...new Uint8Array(20).fill(0xab)]);
const OTHER_SCRIPT = Uint8Array.from([0x51]);

const makeTransaction = (): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Uint8Array.from({ length: 32 }, (_value, index) => index), 7);
  transaction.addOutput(OTHER_SCRIPT, 1n);
  transaction.addOutput(WALLET_SCRIPT, 2n);
  transaction.addOutput(WALLET_SCRIPT, 3n);
  return transaction;
};

const projectCompact = () => {
  const transaction = makeTransaction();
  return projectCompactAuthenticatedTransaction({
    expectedTxid: transaction.getId(),
    remoteTxid: transaction.getId().toUpperCase(),
    canonicalBytes: Uint8Array.from(transaction.toBuffer()),
    metadata: {
      time: 123,
      blocktime: 124,
      blockheight: 9,
      confirmations: 2,
      blockhash: 'cd'.repeat(32),
    },
    limits: { maxInputs: 1, maxOutputs: 3, maxScriptHexChars: 90 },
  }, ['51', Buffer.from(WALLET_SCRIPT).toString('hex')]);
};

describe('compact transaction evidence projection', () => {
  it('seals compact evidence without a full output graph', () => {
    const transaction = makeTransaction();
    const envelope = projectCompact();

    expect(envelope).toEqual(expect.objectContaining({
      txid: transaction.getId(),
      complexity: {
        rawHexChars: transaction.byteLength() * 2,
        inputs: 1,
        outputs: 3,
        scriptHexChars: 90,
      },
      metadata: expect.objectContaining({ time: 123, blockheight: 9 }),
      paidWalletScriptIndexes: Uint32Array.from([0, 1]),
      inputVouts: Uint32Array.from([7]),
    }));
    expect(Buffer.from(envelope.inputTxids).toString('hex'))
      .toBe(Buffer.from(Uint8Array.from({ length: 32 }, (_value, index) => index))
        .reverse().toString('hex'));
    expect(envelope.digest).toBe(transactionEvidenceDigest(envelope.canonicalBytes));
    expect(envelope).not.toHaveProperty('vin');
    expect(envelope).not.toHaveProperty('vout');
  });

  it('reprojects one full transaction locally without retaining raw on the result', () => {
    const envelope = projectCompact();
    const originalBytes = envelope.canonicalBytes;
    const result = reprojectFullAuthenticatedTransaction({
      expectedTxid: envelope.txid,
      canonicalBytes: envelope.canonicalBytes,
      digest: envelope.digest,
      complexity: envelope.complexity,
      metadata: envelope.metadata,
    });

    expect(result.canonicalBytes).toBe(originalBytes);
    expect(result.digest).toBe(envelope.digest);
    expect(result.value).toMatchObject({ txid: envelope.txid, time: 123 });
    expect(result.value.vin).toHaveLength(1);
    expect(result.value.vout).toHaveLength(3);
    expect(result.value).not.toHaveProperty('raw');
    expect(result.value).not.toHaveProperty('hex');
  });

  it('extracts exact bigint output evidence from the sealed bytes', () => {
    const envelope = projectCompact();
    const result = extractExactAuthenticatedTransactionOutput({
      expectedTxid: envelope.txid,
      canonicalBytes: envelope.canonicalBytes,
      digest: envelope.digest,
      complexity: envelope.complexity,
      metadata: envelope.metadata,
    }, 1);

    expect(result).toMatchObject({
      digest: envelope.digest,
      output: {
        vout: 1,
        valueSats: 2n,
        scriptPubKeyHex: Buffer.from(WALLET_SCRIPT).toString('hex'),
      },
    });
    expect(result.canonicalBytes).toBe(envelope.canonicalBytes);
  });

  it('extracts a deduped exact-output set with one authentication result', () => {
    const envelope = projectCompact();
    const result = extractExactAuthenticatedTransactionOutputs({
      expectedTxid: envelope.txid,
      canonicalBytes: envelope.canonicalBytes,
      digest: envelope.digest,
      complexity: envelope.complexity,
      metadata: envelope.metadata,
    }, [2, 0, 2, 9, -1]);

    expect(result.outputs).toEqual([
      { vout: 2, valueSats: 3n, scriptPubKeyHex: Buffer.from(WALLET_SCRIPT).toString('hex') },
      { vout: 0, valueSats: 1n, scriptPubKeyHex: '51' },
    ]);
    expect(result.missingVouts).toEqual([9]);
    expect(result.invalidVouts).toEqual([-1]);
    expect(result.canonicalBytes).toBe(envelope.canonicalBytes);
    expect(result.digest).toBe(envelope.digest);
  });

  it('fails closed for changed bytes, scalar evidence, and out-of-range outputs', () => {
    const envelope = projectCompact();
    const input = {
      expectedTxid: envelope.txid,
      canonicalBytes: envelope.canonicalBytes,
      digest: envelope.digest,
      complexity: envelope.complexity,
      metadata: envelope.metadata,
    };
    const changedBytes = Uint8Array.from(envelope.canonicalBytes);
    changedBytes[changedBytes.length - 1] ^= 1;

    expect(() => reprojectFullAuthenticatedTransaction({
      ...input,
      canonicalBytes: changedBytes,
    })).toThrow(expect.objectContaining({ reason: 'evidence_digest_mismatch' }));
    expect(() => reprojectFullAuthenticatedTransaction({
      ...input,
      complexity: { ...input.complexity, outputs: 2 },
    })).toThrow(expect.objectContaining({ reason: 'evidence_digest_mismatch' }));
    expect(() => extractExactAuthenticatedTransactionOutput(input, 3))
      .toThrow(expect.objectContaining({ reason: 'missing_output' }));
    expect(() => extractExactAuthenticatedTransactionOutput(input, -1))
      .toThrow(expect.objectContaining({ reason: 'invalid_vout' }));

    expect(() => projectCompactAuthenticatedTransaction({
      expectedTxid: envelope.txid,
      remoteTxid: 'ff'.repeat(32),
      canonicalBytes: envelope.canonicalBytes,
      metadata: envelope.metadata,
      limits: { maxInputs: 1, maxOutputs: 3, maxScriptHexChars: 90 },
    }, [])).toThrow(expect.objectContaining({ reason: 'txid_mismatch' }));
  });

  it('enforces exact count/script boundaries before publishing compact evidence', () => {
    const transaction = makeTransaction();
    const base = {
      expectedTxid: transaction.getId(),
      remoteTxid: transaction.getId(),
      canonicalBytes: Uint8Array.from(transaction.toBuffer()),
      metadata: {},
    };

    expect(projectCompactAuthenticatedTransaction({
      ...base,
      limits: { maxInputs: 1, maxOutputs: 3, maxScriptHexChars: 90 },
    }, [])).toMatchObject({ complexity: { inputs: 1, outputs: 3, scriptHexChars: 90 } });
    for (const limits of [
      { maxInputs: 0, maxOutputs: 3, maxScriptHexChars: 90 },
      { maxInputs: 1, maxOutputs: 2, maxScriptHexChars: 90 },
      { maxInputs: 1, maxOutputs: 3, maxScriptHexChars: 89 },
    ]) {
      expect(() => projectCompactAuthenticatedTransaction({ ...base, limits }, []))
        .toThrow(RawTransactionEvidenceError);
    }
  });

  it('keeps independent maximum-shape count checks exact', () => {
    const limits = { maxInputs: 25_000, maxOutputs: 25_000, maxScriptHexChars: 64 };
    expect(transactionEvidenceFitsProjectionLimits({
      inputs: 25_000, outputs: 25_000, scriptHexChars: 64,
    }, limits)).toBe(true);
    expect(transactionEvidenceFitsProjectionLimits({
      inputs: 25_001, outputs: 1, scriptHexChars: 64,
    }, limits)).toBe(false);
    expect(transactionEvidenceFitsProjectionLimits({
      inputs: 1, outputs: 25_001, scriptHexChars: 64,
    }, limits)).toBe(false);
  });
});
