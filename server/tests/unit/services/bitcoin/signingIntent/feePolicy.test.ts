import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  buildSigningIntentFeePolicy,
  calculatePsbtFee,
  estimatePsbtMaximumSignedVsize,
} from '../../../../../src/services/bitcoin/signingIntent/feePolicy';
import { MAX_FEE_RATE, MIN_FEE_RATE } from '../../../../../src/constants';
import {
  SIGNING_INTENT_MAX_FEE_RATE,
  SIGNING_INTENT_MIN_FEE_RATE,
} from '../../../../../src/services/bitcoin/signingIntent/types';
import { GENERATED_SIGNED_PSBT_VECTORS } from '../../../../fixtures/generated-signed-psbt-vectors';
import { estimateTransactionWeight } from '../../../../../src/services/bitcoin/transactionWeight';

const script = Buffer.from(`0014${'11'.repeat(20)}`, 'hex');

function witnessPsbt(inputValue = 10_000n, outputValue = 9_000n): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({
    hash: '22'.repeat(32),
    index: 0,
    witnessUtxo: { script, value: inputValue },
  });
  psbt.addOutput({ script, value: outputValue });
  return psbt;
}

describe('signing intent fee policy construction', () => {
  it('keeps persisted fee-policy limits aligned with transaction admission limits', () => {
    expect(SIGNING_INTENT_MIN_FEE_RATE).toBe(MIN_FEE_RATE);
    expect(SIGNING_INTENT_MAX_FEE_RATE).toBe(MAX_FEE_RATE);
  });

  it('binds the exact PSBT fee and a finite unsigned-size tolerance', () => {
    const psbt = witnessPsbt();
    const requestedRate = 999.5 / estimatePsbtMaximumSignedVsize(psbt);
    expect(buildSigningIntentFeePolicy(psbt.toBase64(), requestedRate, 1_000)).toEqual({
      version: 1,
      expectedFeeSats: 1_000,
      requestedFeeRateSatsPerVbyte: requestedRate,
      roundingMode: 'ceil',
      roundingToleranceSats: expect.any(Number),
    });
  });

  it('rejects a builder-reported fee that differs from authenticated PSBT values', () => {
    const psbt = witnessPsbt();
    const requestedRate = 1_000 / estimatePsbtMaximumSignedVsize(psbt);
    expect(() => buildSigningIntentFeePolicy(psbt.toBase64(), requestedRate, 999))
      .toThrow('does not match its PSBT');
  });

  it('derives legacy input value from the exact referenced previous output', () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(Buffer.from(`76a914${'33'.repeat(20)}88ac`, 'hex'), 20_000n);
    const psbt = new bitcoin.Psbt();
    psbt.addInput({ hash: previous.getId(), index: 0, nonWitnessUtxo: previous.toBuffer() });
    psbt.addOutput({ script, value: 18_500n });
    expect(calculatePsbtFee(psbt)).toBe(1_500);
  });

  it('fails closed when prevout value evidence is absent', () => {
    const psbt = new bitcoin.Psbt();
    psbt.addInput({ hash: '44'.repeat(32), index: 0 });
    psbt.addOutput({ script, value: 1_000n });
    expect(() => calculatePsbtFee(psbt)).toThrow('complete prevout values');
  });

  it('rejects negative fees', () => {
    expect(() => calculatePsbtFee(witnessPsbt(1_000n, 1_001n)))
      .toThrow('outside the supported range');
  });

  it('rejects fees above the safe integer range', () => {
    expect(() => calculatePsbtFee(witnessPsbt(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0n)))
      .toThrow('outside the supported range');
  });

  it('rejects inconsistent witness and non-witness prevout evidence', () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(script, 10_000n);
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
      hash: previous.getId(),
      index: 0,
      nonWitnessUtxo: previous.toBuffer(),
      witnessUtxo: { script, value: 10_001n },
    });
    psbt.addOutput({ script, value: 9_000n });
    expect(() => calculatePsbtFee(psbt)).toThrow('prevout evidence is inconsistent');
  });

  it('rejects a script-only conflict between witness and non-witness prevout evidence', () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(script, 10_000n);
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
      hash: previous.getId(),
      index: 0,
      nonWitnessUtxo: previous.toBuffer(),
      witnessUtxo: { script: Buffer.from(`0014${'99'.repeat(20)}`, 'hex'), value: 10_000n },
    });
    psbt.addOutput({ script, value: 9_000n });

    expect(() => calculatePsbtFee(psbt)).toThrow('prevout evidence is inconsistent');
  });

  it('falls back to witness evidence when a supplied previous transaction lacks the referenced output', () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(script, 10_000n);
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
      hash: previous.getId(),
      index: 1,
      nonWitnessUtxo: previous.toBuffer(),
      witnessUtxo: { script, value: 10_000n },
    });
    psbt.addOutput({ script, value: 9_000n });

    expect(calculatePsbtFee(psbt)).toBe(1_000);
  });

  it('rejects a non-multisig witness script before classifying its wrapped input', () => {
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
      hash: '66'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(`0020${'77'.repeat(32)}`, 'hex'), value: 10_000n },
      witnessScript: Buffer.from('51', 'hex'),
    });
    psbt.addOutput({ script, value: 9_000n });

    expect(() => estimatePsbtMaximumSignedVsize(psbt)).toThrow('witness script is not supported');
  });

  it('rejects a P2SH witness-script input without its redeem-script evidence', () => {
    const multisigScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_1,
      Buffer.from(`02${'88'.repeat(32)}`, 'hex'),
      bitcoin.opcodes.OP_1,
      bitcoin.opcodes.OP_CHECKMULTISIG,
    ]);
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
      hash: '77'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(`a914${'99'.repeat(20)}87`, 'hex'), value: 10_000n },
      witnessScript: multisigScript,
    });
    psbt.addOutput({ script, value: 9_000n });

    expect(() => estimatePsbtMaximumSignedVsize(psbt)).toThrow('spend policy is unsupported');
  });

  it.each(GENERATED_SIGNED_PSBT_VECTORS)(
    'binds Core-backed fee and conservative signed size for $scriptType',
    (vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64);
      const requestedRate = (vector.expectedFee - 0.5) / estimatePsbtMaximumSignedVsize(psbt);
      const policy = buildSigningIntentFeePolicy(
        vector.unsignedPsbtBase64,
        requestedRate,
        vector.expectedFee,
      );

      expect(policy.expectedFeeSats).toBe(vector.expectedFee);
      expect(policy.requestedFeeRateSatsPerVbyte).toBe(requestedRate);
      expect(
        Math.abs(vector.expectedFee - Math.ceil(requestedRate * vector.expectedVsize)),
      ).toBeLessThanOrEqual(policy.roundingToleranceSats);
      expect(vector.mempoolAccept.allowed).toBe(true);
      expect(vector.coreProof.decodedTransaction.vsize).toBe(vector.expectedVsize);
    },
  );

  it('rejects a builder-reported fee on either side of the authenticated value', () => {
    const psbt = witnessPsbt();
    const requestedRate = 999.5 / estimatePsbtMaximumSignedVsize(psbt);
    const encoded = psbt.toBase64();
    expect(() => buildSigningIntentFeePolicy(encoded, requestedRate, 999)).toThrow('does not match its PSBT');
    expect(() => buildSigningIntentFeePolicy(encoded, requestedRate, 1_001)).toThrow('does not match its PSBT');
  });

  it('rejects unsupported prevout scripts when authorizing a requested rate', () => {
    const unsupported = new bitcoin.Psbt();
    unsupported.addInput({
      hash: '55'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from([0x6a]), value: 10_000n },
    });
    unsupported.addOutput({ script, value: 9_000n });
    expect(() => buildSigningIntentFeePolicy(unsupported.toBase64(), 5, 1_000))
      .toThrow('spend policy is unsupported');
  });

  it.each([0, 0.099, 1_000.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an unsafe requested fee rate: %s',
    (feeRate) => {
      expect(() => buildSigningIntentFeePolicy(witnessPsbt().toBase64(), feeRate, 1_000))
        .toThrow('Fee rate must be between');
    },
  );

  it.each([-1, 55_000, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects an unsafe dust authorization: %s',
    (dustAllowance) => {
      const psbt = witnessPsbt();
      const requestedRate = 999.5 / estimatePsbtMaximumSignedVsize(psbt);
      expect(() => buildSigningIntentFeePolicy(
        psbt.toBase64(), requestedRate, 1_000, dustAllowance,
      )).toThrow('dust allowance');
    },
  );

  it('does not let a missing change output widen its own authorization', () => {
    const psbt = witnessPsbt(1_000_000n, 1_000n);
    expect(() => buildSigningIntentFeePolicy(psbt.toBase64(), 5, 999_000, 9_999))
      .toThrow('outside the requested policy');
  });

  it('reports both sides of the requested-rate policy boundary', () => {
    const psbt = witnessPsbt();
    const maximumVsize = estimatePsbtMaximumSignedVsize(psbt);

    expect(() => buildSigningIntentFeePolicy(
      psbt.toBase64(), (1_001 - 0.5) / maximumVsize, 1_000,
    )).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'fee_too_low' }) }));
    expect(() => buildSigningIntentFeePolicy(
      psbt.toBase64(), (999 - 0.5) / maximumVsize, 1_000,
    )).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'fee_too_high' }) }));
  });

  it('allows only an explicit independently bounded dust absorption', () => {
    const psbt = witnessPsbt(10_000n, 9_000n);
    const maximumFee = estimatePsbtMaximumSignedVsize(psbt) * 5;
    const surplus = 1_000 - maximumFee;
    expect(surplus).toBeGreaterThan(0);
    expect(() => buildSigningIntentFeePolicy(psbt.toBase64(), 5, 1_000, surplus - 1))
      .toThrow('outside the requested policy');
    expect(buildSigningIntentFeePolicy(psbt.toBase64(), 5, 1_000, surplus).expectedFeeSats)
      .toBe(1_000);
  });

  it('does not authorize any surplus for a change-bearing construction', () => {
    const psbt = witnessPsbt(10_000n, 9_000n);
    const maximumFee = estimatePsbtMaximumSignedVsize(psbt) * 5;
    expect(() => buildSigningIntentFeePolicy(psbt.toBase64(), 5, 1_000, 0))
      .toThrow('outside the requested policy');
    expect(buildSigningIntentFeePolicy(
      witnessPsbt(10_000n, BigInt(10_000 - maximumFee)).toBase64(),
      5,
      maximumFee,
      0,
    ).expectedFeeSats).toBe(maximumFee);
  });

  it('bounds the 252-output CompactSize change-omission transition exactly', () => {
    const recipientScripts = Array.from({ length: 252 }, () => ({ scriptPubKey: script }));
    const withoutChange = estimateTransactionWeight({
      inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: script }],
      outputs: recipientScripts,
    }).vsize;
    const p2trChange = Buffer.from(`5120${'33'.repeat(32)}`, 'hex');
    const withChange = estimateTransactionWeight({
      inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: script }],
      outputs: [...recipientScripts, { scriptPubKey: p2trChange }],
    }).vsize;

    expect(withChange - withoutChange).toBe(45);
  });
});
