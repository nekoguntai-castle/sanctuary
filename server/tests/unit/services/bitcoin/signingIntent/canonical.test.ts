import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import fc from 'fast-check';
import {
  buildSigningIntentSnapshot,
  calculateSnapshotDigest,
  defaultInputRoles,
  derivePayjoinInputRoles,
  unsignedPsbtSha256,
} from '../../../../../src/services/bitcoin/signingIntent/canonical';
import type {
  SigningIntentPrevout,
  SigningIntentSnapshotV2,
} from '../../../../../src/services/bitcoin/signingIntent/types';

const feePolicy = {
  version: 1 as const,
  expectedFeeSats: 1_000,
  requestedFeeRateSatsPerVbyte: 10,
  roundingMode: 'ceil' as const,
  roundingToleranceSats: 1,
};

const baseSnapshot: SigningIntentSnapshotV2 = {
  version: 2,
  walletId: 'wallet-1',
  network: 'regtest',
  feePolicy,
  transaction: {
    version: 2,
    locktime: 0,
    inputs: [{
      txid: '11'.repeat(32),
      vout: 0,
      sequence: 0xfffffffd,
      prevout: { amountSats: '10000', scriptPubKeyHex: '0014' + '22'.repeat(20), role: 'wallet' },
    }],
    outputs: [{ amountSats: '9000', scriptPubKeyHex: '0014' + '33'.repeat(20) }],
  },
};

describe('signing intent canonical authentication', () => {
  it('is deterministic and commits to prevout amount and script', () => {
    const digest = calculateSnapshotDigest(baseSnapshot);
    expect(calculateSnapshotDigest(structuredClone(baseSnapshot))).toBe(digest);
    expect(calculateSnapshotDigest({
      ...baseSnapshot,
      transaction: {
        ...baseSnapshot.transaction,
        inputs: [{
          ...baseSnapshot.transaction.inputs[0],
          prevout: { ...baseSnapshot.transaction.inputs[0].prevout, amountSats: '10001' },
        }],
      },
    })).not.toBe(digest);
    expect(calculateSnapshotDigest({
      ...baseSnapshot,
      transaction: {
        ...baseSnapshot.transaction,
        inputs: [{
          ...baseSnapshot.transaction.inputs[0],
          prevout: { ...baseSnapshot.transaction.inputs[0].prevout, scriptPubKeyHex: '6a' },
        }],
      },
    })).not.toBe(digest);
  });

  it('rejects empty and non-canonical PSBT base64 encodings', () => {
    expect(() => unsignedPsbtSha256('')).toThrow('canonical base64');
    expect(() => unsignedPsbtSha256('%%%')).toThrow('canonical base64');
  });

  it('classifies only original outpoints as wallet-owned in a Payjoin proposal', () => {
    const original = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
    original.addInput({
      hash: '11'.repeat(32), index: 0,
      witnessUtxo: { script: Buffer.from('0014' + '22'.repeat(20), 'hex'), value: 10_000n },
    });
    original.addOutput({ script: Buffer.from('0014' + '33'.repeat(20), 'hex'), value: 9_000n });
    const proposal = bitcoin.Psbt.fromBase64(original.toBase64());
    proposal.addInput({
      hash: '44'.repeat(32), index: 1,
      witnessUtxo: { script: Buffer.from('0014' + '55'.repeat(20), 'hex'), value: 2_000n },
    });
    expect(derivePayjoinInputRoles(original.toBase64(), proposal.toBase64()))
      .toEqual(['wallet', 'payjoin_peer']);
  });

  it('property: every supported output amount mutation changes the digest', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), amount => {
      fc.pre(amount.toString() !== baseSnapshot.transaction.outputs[0].amountSats);
      const mutated: SigningIntentSnapshotV2 = {
        ...baseSnapshot,
        transaction: {
          ...baseSnapshot.transaction,
          outputs: [{ ...baseSnapshot.transaction.outputs[0], amountSats: amount.toString() }],
        },
      };
      expect(calculateSnapshotDigest(mutated)).not.toBe(calculateSnapshotDigest(baseSnapshot));
    }));
  });

  const committedFieldMutations: Array<[string, (value: SigningIntentSnapshotV2) => void]> = [
    ['snapshot version', value => { (value as { version: number }).version = 1; }],
    ['wallet id', value => { value.walletId = 'wallet-2'; }],
    ['network', value => { value.network = 'testnet3'; }],
    ['requested fee rate', value => { value.feePolicy.requestedFeeRateSatsPerVbyte = 11; }],
    ['expected fee', value => { value.feePolicy.expectedFeeSats = 1_001; }],
    ['rounding tolerance', value => { value.feePolicy.roundingToleranceSats = 2; }],
    ['transaction version', value => { value.transaction.version = 1; }],
    ['locktime', value => { value.transaction.locktime = 1; }],
    ['replacement identity', value => { value.transaction.replacementTxid = 'aa'.repeat(32); }],
    ['input txid', value => { value.transaction.inputs[0].txid = 'bb'.repeat(32); }],
    ['input vout', value => { value.transaction.inputs[0].vout = 1; }],
    ['input sequence', value => { value.transaction.inputs[0].sequence = 0xffffffff; }],
    ['prevout amount', value => { value.transaction.inputs[0].prevout.amountSats = '10001'; }],
    ['prevout script', value => { value.transaction.inputs[0].prevout.scriptPubKeyHex = '6a'; }],
    ['prevout role', value => { value.transaction.inputs[0].prevout.role = 'payjoin_peer'; }],
    ['output amount', value => { value.transaction.outputs[0].amountSats = '9001'; }],
    ['output script', value => { value.transaction.outputs[0].scriptPubKeyHex = '6a'; }],
  ];

  it.each(committedFieldMutations)('commits ordered snapshot field: %s', (_name, mutate) => {
    const candidate = structuredClone(baseSnapshot);
    mutate(candidate);
    expect(calculateSnapshotDigest(candidate)).not.toBe(calculateSnapshotDigest(baseSnapshot));
  });

  it.each(['inputs', 'outputs'] as const)('commits %s ordering', (field) => {
    const candidate = structuredClone(baseSnapshot);
    if (field === 'inputs') {
      candidate.transaction.inputs.push({
        ...structuredClone(candidate.transaction.inputs[0]), txid: 'cc'.repeat(32), vout: 2,
      });
    } else {
      candidate.transaction.outputs.push({ amountSats: '1', scriptPubKeyHex: '6a' });
    }
    const reordered = structuredClone(candidate);
    reordered.transaction[field].reverse();
    expect(calculateSnapshotDigest(reordered)).not.toBe(calculateSnapshotDigest(candidate));
  });

  it('builds a normalized snapshot with explicit replacement identity', () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
    psbt.addInput({
      hash: 'AA'.repeat(32), index: 1,
      witnessUtxo: { script: Buffer.from('0014' + '22'.repeat(20), 'hex'), value: 10_000n },
    });
    psbt.addOutput({ script: Buffer.from('0014' + '33'.repeat(20), 'hex'), value: 9_000n });
    const snapshot = buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [{
      amountSats: '10000',
      scriptPubKeyHex: '0014' + 'AB'.repeat(20),
      role: 'wallet',
    }], feePolicy, 'CC'.repeat(32));

    expect(snapshot.transaction.replacementTxid).toBe('cc'.repeat(32));
    expect(snapshot.transaction.inputs[0].prevout.scriptPubKeyHex).toBe('0014' + 'ab'.repeat(20));
    expect(defaultInputRoles(2)).toEqual(['wallet', 'wallet']);
  });

  it('rejects an expected fee that does not match authenticated inputs minus outputs', () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
    psbt.addInput({ hash: '11'.repeat(32), index: 0 });
    psbt.addOutput({ script: Buffer.from('6a', 'hex'), value: 9_000n });

    expect(() => buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [{
      amountSats: '10000', scriptPubKeyHex: '6a', role: 'wallet',
    }], { ...feePolicy, expectedFeeSats: 999 })).toThrow(
      'fee does not match the authenticated transaction',
    );
  });

  it('distinguishes fee policies below and above the authenticated transaction fee', () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
    psbt.addInput({ hash: '11'.repeat(32), index: 0 });
    psbt.addOutput({ script: Buffer.from('6a', 'hex'), value: 9_000n });
    const prevouts = [{ amountSats: '10000', scriptPubKeyHex: '6a', role: 'wallet' as const }];

    for (const [expectedFeeSats, reason] of [[999, 'fee_too_high'], [1_001, 'fee_too_low']] as const) {
      expect(() => buildSigningIntentSnapshot(
        'wallet-1', 'testnet3', psbt, prevouts, { ...feePolicy, expectedFeeSats },
      )).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason }) }));
    }
  });

  const withoutInputs = new bitcoin.Psbt();
  withoutInputs.addOutput({ script: Buffer.from('6a', 'hex'), value: 0n });
  const withoutOutputs = new bitcoin.Psbt();
  withoutOutputs.addInput({ hash: Buffer.alloc(32), index: 0 });
  const incompleteTransactions: Array<[string, bitcoin.Psbt, SigningIntentPrevout[]]> = [
    ['missing inputs', withoutInputs, []],
    ['missing outputs', withoutOutputs, [{ amountSats: '1', scriptPubKeyHex: '6a', role: 'wallet' }]],
  ];

  it.each(incompleteTransactions)('rejects a transaction with %s', (_name, psbt, prevouts) => {
    expect(() => buildSigningIntentSnapshot(
      'wallet-1',
      'testnet3',
      psbt,
      prevouts,
      feePolicy,
    )).toThrow('requires inputs and outputs');
  });

  it('accepts exact supported amount boundaries and rejects the first unsafe integer', () => {
    const psbt = new bitcoin.Psbt();
    psbt.addInput({ hash: '11'.repeat(32), index: 0 });
    psbt.addOutput({ script: Buffer.from('6a', 'hex'), value: BigInt(Number.MAX_SAFE_INTEGER) });
    expect(buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [{
      amountSats: Number.MAX_SAFE_INTEGER.toString(), scriptPubKeyHex: '6a', role: 'wallet',
    }], { ...feePolicy, expectedFeeSats: 0 }).transaction).toMatchObject({
      inputs: [expect.objectContaining({
        prevout: expect.objectContaining({ amountSats: Number.MAX_SAFE_INTEGER.toString() }),
      })],
      outputs: [expect.objectContaining({ amountSats: Number.MAX_SAFE_INTEGER.toString() })],
    });
    expect(() => buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [{
      amountSats: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
      scriptPubKeyHex: '6a',
      role: 'wallet',
    }], feePolicy)).toThrow('outside the supported range');
  });

  it.each([
    ['empty transaction', () => buildSigningIntentSnapshot(
      'wallet-1', 'testnet3', new bitcoin.Psbt(), [], feePolicy,
    )],
    ['missing prevout', () => {
      const psbt = bitcoin.Psbt.fromBase64((() => {
        const value = new bitcoin.Psbt();
        value.addInput({ hash: '11'.repeat(32), index: 0 });
        value.addOutput({ script: Buffer.from('6a', 'hex'), value: 0n });
        return value.toBase64();
      })());
      return buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [], feePolicy);
    }],
    ['invalid replacement txid', () => {
      const psbt = new bitcoin.Psbt();
      psbt.addInput({ hash: '11'.repeat(32), index: 0 });
      psbt.addOutput({ script: Buffer.from('6a', 'hex'), value: 0n });
      return buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [{
        amountSats: '1', scriptPubKeyHex: '6a', role: 'wallet',
      }], feePolicy, 'invalid');
    }],
    ['invalid script', () => {
      const psbt = new bitcoin.Psbt();
      psbt.addInput({ hash: '11'.repeat(32), index: 0 });
      psbt.addOutput({ script: Buffer.from('6a', 'hex'), value: 0n });
      return buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [{
        amountSats: '1', scriptPubKeyHex: 'not-hex', role: 'wallet',
      }], feePolicy);
    }],
    ['unsupported amount', () => {
      const psbt = new bitcoin.Psbt();
      psbt.addInput({ hash: '11'.repeat(32), index: 0 });
      psbt.addOutput({ script: Buffer.from('6a', 'hex'), value: 0n });
      return buildSigningIntentSnapshot('wallet-1', 'testnet3', psbt, [{
        amountSats: '-1', scriptPubKeyHex: '6a', role: 'wallet',
      }], feePolicy);
    }],
  ])('rejects %s snapshot evidence', (_name, action) => {
    expect(action).toThrow();
  });
});
