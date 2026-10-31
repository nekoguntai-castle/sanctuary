import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import {
  authorizeCpfpChildFeeRate,
  measureCpfpParent,
  minimumSignedVsize,
} from '../../../../../src/services/bitcoin/advancedTx/cpfpParent';
import { InvalidInputError } from '../../../../../src/errors/ApiError';
import { SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE } from '../../../../../src/services/bitcoin/signingIntent/types';
import { estimateTransactionWeight, type TransactionWeightInput } from '../../../../../src/services/bitcoin/transactionWeight';

const FUNDING_SATS = 100_000;
const OUTPUT_SATS = 99_000;

const pubkeys = [1, 2, 3].map(scalar =>
  Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, scalar), true)!));
const multisigScript = bitcoin.payments.p2ms({ m: 2, pubkeys }).output!;
const p2wshScript = bitcoin.payments.p2wsh({ redeem: { output: multisigScript } }).output!;
const p2wpkhScript = bitcoin.payments.p2wpkh({ pubkey: pubkeys[0] }).output!;
const p2pkhScript = bitcoin.payments.p2pkh({ pubkey: pubkeys[0] }).output!;
const p2shOf = (redeem: Uint8Array) => bitcoin.payments.p2sh({ redeem: { output: redeem } }).output!;
const p2trScript = Buffer.from(`5120${'dd'.repeat(32)}`, 'hex');
const witnessV2Script = Buffer.from(`5220${'ee'.repeat(32)}`, 'hex');

interface SpentInput {
  prevoutScript: Uint8Array;
  scriptSig?: Uint8Array;
  witness?: Buffer[];
}

/** A parent spending one fresh funding output per input, plus a client that serves the fundings. */
const parentSpending = (...inputs: SpentInput[]) => {
  const fundings = inputs.map((input, salt) => {
    const funding = new bitcoin.Transaction();
    funding.addInput(Buffer.alloc(32, salt), 0xffffffff);
    funding.addOutput(Buffer.from(input.prevoutScript), BigInt(FUNDING_SATS));
    return funding;
  });
  const parent = new bitcoin.Transaction();
  parent.version = 2;
  fundings.forEach((funding, index) => {
    parent.addInput(Buffer.from(funding.getId(), 'hex').reverse(), 0, 0xffffffff, inputs[index].scriptSig);
    if (inputs[index].witness) parent.ins[index].witness = inputs[index].witness!;
  });
  parent.addOutput(p2wpkhScript, BigInt(OUTPUT_SATS));
  const served = new Map(fundings.map(funding => [funding.getId(), { hex: funding.toHex() }]));
  const client = { getTransaction: async (txid: string) => served.get(txid) };
  return {
    parent,
    measure: () => measureCpfpParent(client as Parameters<typeof measureCpfpParent>[0], parent),
  };
};

const vsizeOf = (strippedBytes: number, witnessBytes: number) =>
  Math.ceil((strippedBytes * 4 + 2 + witnessBytes) / 4);

const ecdsaSignature = () => Buffer.alloc(72, 1);
const p2wpkhWitness = () => [ecdsaSignature(), Buffer.from(pubkeys[0])];
const multisigWitness = (script: Uint8Array = multisigScript) =>
  [Buffer.alloc(0), ecdsaSignature(), ecdsaSignature(), Buffer.from(script)];
const padding = () => Buffer.alloc(20_000);

describe('CPFP parent measurement', () => {
  it('measures the authenticated fee and keeps an honest native-segwit parent at its served size', async () => {
    const { parent, measure } = parentSpending({ prevoutScript: p2wpkhScript, witness: p2wpkhWitness() });

    const measured = await measure();

    expect(measured.fee).toBe(FUNDING_SATS - OUTPUT_SATS);
    expect(measured.vsizeBound).toBe(vsizeOf(parent.byteLength(false), 109));
    expect(measured.vsize).toBe(parent.virtualSize());
  });

  it('caps a padded witness on a non-witness input at the stripped size', async () => {
    const { parent, measure } = parentSpending({
      prevoutScript: p2pkhScript,
      scriptSig: bitcoin.script.compile([ecdsaSignature(), pubkeys[0]]),
      witness: [padding()],
    });

    const measured = await measure();

    expect(parent.virtualSize()).toBeGreaterThan(5_000);
    expect(measured.vsize).toBe(parent.byteLength(false));
  });

  it('bounds P2SH-nested P2WPKH from the authenticated redeem script', async () => {
    const { parent, measure } = parentSpending({
      prevoutScript: p2shOf(p2wpkhScript),
      scriptSig: bitcoin.script.compile([p2wpkhScript]),
      witness: [...p2wpkhWitness(), padding()],
    });

    expect((await measure()).vsize).toBe(vsizeOf(parent.byteLength(false), 109));
  });

  it.each([
    ['a legacy redeem script', bitcoin.script.compile([multisigScript])],
    ['an empty scriptSig', Buffer.alloc(0)],
  ])('treats a P2SH input with %s as a non-witness spend', async (_name, scriptSig) => {
    const { parent, measure } = parentSpending({ prevoutScript: p2shOf(multisigScript), scriptSig });

    expect((await measure()).vsize).toBe(parent.byteLength(false));
  });

  it('bounds a P2WSH multisig witness by its authenticated threshold', async () => {
    const { parent, measure } = parentSpending({
      prevoutScript: p2wshScript,
      witness: [...multisigWitness().slice(0, 3), padding(), Buffer.from(multisigScript)],
    });
    // count(1) + dummy(1) + 2 * (1 + 73) + (1 + script)
    const maximumWitness = 1 + 1 + 2 * 74 + 1 + multisigScript.length;

    expect((await measure()).vsize).toBe(vsizeOf(parent.byteLength(false), maximumWitness));
  });

  it('bounds a P2SH-nested P2WSH multisig witness', async () => {
    const { measure } = parentSpending({
      prevoutScript: p2shOf(p2wshScript),
      scriptSig: bitcoin.script.compile([p2wshScript]),
      witness: multisigWitness(),
    });

    expect((await measure()).vsizeBound).toBeDefined();
  });

  it('bounds a Taproot key-path spend next to a legacy input', async () => {
    const { parent, measure } = parentSpending(
      { prevoutScript: p2trScript, witness: [Buffer.alloc(64, 1)] },
      { prevoutScript: p2pkhScript, scriptSig: bitcoin.script.compile([ecdsaSignature(), pubkeys[0]]) },
    );

    // Taproot key path: count(1) + (1 + 65); the legacy input's empty stack: 1.
    expect((await measure()).vsizeBound).toBe(vsizeOf(parent.byteLength(false), 67 + 1));
  });

  it.each([
    ['a Taproot script path', { prevoutScript: p2trScript, witness: [Buffer.alloc(64), Buffer.alloc(33)] }],
    ['a future witness version', { prevoutScript: witnessV2Script, witness: [Buffer.alloc(64)] }],
    ['a P2WSH script that does not hash to the program', { prevoutScript: p2wshScript, witness: multisigWitness(p2pkhScript) }],
    ['a non-multisig P2WSH script', {
      prevoutScript: bitcoin.payments.p2wsh({ redeem: { output: p2pkhScript } }).output!,
      witness: [ecdsaSignature(), Buffer.from(pubkeys[0]), Buffer.from(p2pkhScript)],
    }],
    ['an empty P2WSH witness', { prevoutScript: p2wshScript }],
    ['a P2SH-wrapped Taproot program', {
      prevoutScript: p2shOf(p2trScript), scriptSig: bitcoin.script.compile([p2trScript]), witness: [Buffer.alloc(64, 1)],
    }],
    ['a 4-byte version-1 program', { prevoutScript: Buffer.from('5102aabb', 'hex'), witness: [Buffer.alloc(64)] }],
    ['a 42-byte version-16 program', { prevoutScript: Buffer.from(`6028${'ab'.repeat(40)}`, 'hex'), witness: [Buffer.alloc(64)] }],
  ] as const)('leaves %s unbounded at its served size', async (_name, input) => {
    const { parent, measure } = parentSpending(input as SpentInput);

    const measured = await measure();

    expect(measured.vsizeBound).toBeUndefined();
    expect(measured.vsize).toBe(parent.virtualSize());
  });
});

describe('CPFP parent measurement outside the witness-program bounds', () => {
  it('treats a 43-byte script that starts with OP_1 as a non-witness spend', async () => {
    const { parent, measure } = parentSpending({ prevoutScript: Buffer.from(`5129${'ab'.repeat(41)}`, 'hex'), witness: [padding()] });

    expect((await measure()).vsize).toBe(parent.byteLength(false));
  });

  it('does not treat a 23-byte script that is not OP_HASH160 <20> OP_EQUAL as P2SH', async () => {
    const notP2sh = Buffer.from(p2shOf(p2wpkhScript));
    notP2sh[22] = 0x88;
    const { parent, measure } = parentSpending({
      prevoutScript: notP2sh, scriptSig: bitcoin.script.compile([p2wpkhScript]), witness: p2wpkhWitness(),
    });

    expect((await measure()).vsize).toBe(parent.byteLength(false));
  });

  // BIP 141: a P2SH input is a nested witness spend only when its scriptSig is exactly one
  // minimal push of the program; any other scriptSig is a legacy spend whose witness must be empty.
  const fifteenPubkeys = Array.from({ length: 15 }, (_, index) =>
    Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, index + 1), true)!));
  const fifteenOfFifteen = bitcoin.payments.p2ms({ m: 15, pubkeys: fifteenPubkeys }).output!;
  const fifteenOfFifteenP2wsh = bitcoin.payments.p2wsh({ redeem: { output: fifteenOfFifteen } }).output!;
  it.each([
    ['an extra push before the program', bitcoin.script.compile([Buffer.from([0x01]), fifteenOfFifteenP2wsh])],
    ['a non-minimal OP_PUSHDATA1 push of the program', Buffer.concat([
      Buffer.from([0x4c, fifteenOfFifteenP2wsh.length]), fifteenOfFifteenP2wsh,
    ])],
  ])('prices a P2SH witness-program redeem script spent with %s at the stripped size', async (_name, scriptSig) => {
    const { parent, measure } = parentSpending({
      prevoutScript: p2shOf(fifteenOfFifteenP2wsh),
      scriptSig,
      witness: [Buffer.alloc(0), ...Array.from({ length: 15 }, () => Buffer.alloc(73, 1)), Buffer.from(fifteenOfFifteen)],
    });

    const measured = await measure();

    expect(parent.virtualSize()).toBeGreaterThan(4 * parent.byteLength(false));
    expect(measured.vsize).toBe(parent.byteLength(false));
    expect(measured.vsizeBound).toBe(parent.byteLength(false));
  });
});

describe('CPFP child fee-rate authorization', () => {
  const child = (vsize: number, minimumSignedVsize = vsize) => ({ vsize, minimumSignedVsize });
  const bounded = { fee: 2_000, vsize: 2_000, vsizeBound: 2_100 };

  it.each([1_000.5, Number.NaN])('refuses a package target of %s', (target) => {
    expect(() => authorizeCpfpChildFeeRate(bounded, child(110), target, 1_000))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/^Target package fee rate/) }));
  });

  it('lets a bounded parent raise the child ceiling up to the stored-policy ceiling', () => {
    expect(authorizeCpfpChildFeeRate(bounded, child(110), 50, 104_500)).toEqual({
      feeRate: 950,
      maximumFeeRate: SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE,
    });
  });

  const refusal = (run: () => unknown): Error => {
    try {
      run();
    } catch (caught) {
      expect(caught).toBeInstanceOf(InvalidInputError);
      return caught as Error;
    }
    throw new Error('expected a refusal');
  };

  it('keeps the per-transaction cap for an unbounded parent', () => {
    const unbounded = { fee: 2_000, vsize: 2_000 };
    expect(authorizeCpfpChildFeeRate(unbounded, child(100), 50, 100_000)).toEqual({ feeRate: 1_000, maximumFeeRate: 1_000 });
    expect(refusal(() => authorizeCpfpChildFeeRate(unbounded, child(100), 50, 100_001)).message)
      .toBe('CPFP child fee rate 1000.01 sat/vB exceeds 1000 sat/vB: the parent size cannot be bounded from authenticated data');
  });

  it('caps a bounded parent\'s child below the PSBT finalizer limit on its smallest signed size', () => {
    // A P2WPKH child: 110 vB at its maximum signed size, 94 vB with the shortest valid signature.
    // bitcoinjs refuses floor(fee / signed vsize) >= 5000, so the largest fee is 5000 * 94 - 1.
    const large = { fee: 0, vsize: 50_000, vsizeBound: 50_000 };
    expect(authorizeCpfpChildFeeRate(large, child(110, 94), 1_000, 469_999))
      .toEqual({ feeRate: 4_272.71818181, maximumFeeRate: 5_000 });
    expect(refusal(() => authorizeCpfpChildFeeRate(large, child(110, 94), 1_000, 470_000)).message)
      .toBe('CPFP child fee rate 5000 sat/vB at its smallest signed size (94 vB) is not below 5000 sat/vB, ' +
        'the PSBT finalizer limit: choose a lower target fee rate');
    // 5000 sat/vB of the estimated size, and pass 4's 10,000 sat/vB of the smallest size, are refused.
    expect(() => authorizeCpfpChildFeeRate(large, child(110, 94), 1_000, 550_000)).toThrow(/the PSBT finalizer limit/);
    expect(() => authorizeCpfpChildFeeRate(large, child(110, 94), 1_000, 940_000)).toThrow(/the PSBT finalizer limit/);
  });

  it('caps a bounded parent\'s child at what a package at the cap needs', () => {
    const small = { fee: 0, vsize: 100, vsizeBound: 100 };
    expect(authorizeCpfpChildFeeRate(small, child(100), 1_000, 200_000)).toEqual({ feeRate: 2_000, maximumFeeRate: 2_000 });
    expect(refusal(() => authorizeCpfpChildFeeRate(small, child(100), 1_000, 200_001)).message)
      .toBe('CPFP child fee rate 2000.01 sat/vB exceeds 2000 sat/vB, what a 1000 sat/vB package needs');
  });
});

describe('CPFP child minimum signed size', () => {
  const recipient = { scriptPubKey: p2wpkhScript };
  const sortedMulti = bitcoin.payments.p2ms({ m: 2, pubkeys: [...pubkeys].sort(Buffer.compare) }).output!;
  const sortedP2wsh = bitcoin.payments.p2wsh({ redeem: { output: sortedMulti } }).output!;

  it.each([
    // [name, input, maximum signed weight, minimum signed vsize]
    ['P2PKH (scriptSig bytes weigh 4)', { spendPolicy: { type: 'p2pkh' }, prevoutScript: p2pkhScript }, 760, 126],
    ['P2WPKH', { spendPolicy: { type: 'p2wpkh' }, prevoutScript: p2wpkhScript }, 439, 94],
    ['P2SH-P2WPKH', {
      spendPolicy: { type: 'p2sh-p2wpkh' }, prevoutScript: p2shOf(p2wpkhScript), redeemScript: p2wpkhScript,
    }, 531, 117],
    ['Taproot key path (64-byte signature)', {
      spendPolicy: { type: 'p2tr-keypath' }, prevoutScript: Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, 7)]),
    }, 397, 99],
    ['2-of-3 P2WSH (two signatures)', {
      spendPolicy: { type: 'p2wsh-sortedmulti', m: 2, n: 3 }, prevoutScript: sortedP2wsh, witnessScript: sortedMulti,
    }, 586, 115],
    ['2-of-3 P2SH-P2WSH (two signatures)', {
      spendPolicy: { type: 'p2sh-p2wsh-sortedmulti', m: 2, n: 3 },
      prevoutScript: p2shOf(sortedP2wsh), redeemScript: sortedP2wsh, witnessScript: sortedMulti,
    }, 726, 150],
  ] as const)('a %s child', (_name, input, weight, minimum) => {
    const estimate = estimateTransactionWeight({ inputs: [input as TransactionWeightInput], outputs: [recipient] });

    expect(estimate.weight).toBe(weight);
    expect(minimumSignedVsize(input.spendPolicy, estimate.weight)).toBe(minimum);
  });
});
