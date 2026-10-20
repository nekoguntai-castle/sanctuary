import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  calculatePsbtFee,
  validatePayjoinProposal,
} from '../../../../../src/services/bitcoin/psbtValidation';
import { validateFeePolicy, validateMinFeeRatePolicy } from '../../../../../src/services/bitcoin/payjoinProposalValidation';
import { TESTNET } from './psbtValidationTestHarness';

/**
 * BIP78 "senders' payjoin proposal checklist": a compliant receiver strips the
 * sender inputs' UTXO and final data and finalizes only its own inputs.
 */

type Prevout = 'witness' | 'nonWitness' | 'none';
type PsbtInputMap = bitcoin.Psbt['data']['inputs'][number];

const SEQUENCE = 0xfffffffd;
const WITNESS = Buffer.from('0201aa0102', 'hex');
const PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
const PAYMENT_SCRIPT = Buffer.from(bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x40), network: TESTNET }).output!);

const p2wpkh = (seed: number): Buffer => Buffer.from(
  bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, seed), network: TESTNET }).output!,
);
const p2tr = (seed: number): Buffer => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, seed)]);
const p2shP2wpkh = (seed: number): Buffer => Buffer.from(bitcoin.payments.p2sh({
  redeem: bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, seed), network: TESTNET }),
  network: TESTNET,
}).output!);

/** Adds an input whose prevout pays `script`; nonWitness prevouts use vout 1 of their parent. */
const addInput = (
  psbt: bitcoin.Psbt,
  { seed, script, value, prevout, sequence = SEQUENCE }: {
    seed: number; script: Buffer; value: number; prevout: Prevout; sequence?: number;
  },
): PsbtInputMap => {
  if (prevout === 'nonWitness') {
    const parent = new bitcoin.Transaction();
    parent.addInput(Buffer.alloc(32, seed), 0);
    parent.addOutput(p2wpkh(0x7f), 1n);
    parent.addOutput(script, BigInt(value));
    psbt.addInput({ hash: parent.getHash(), index: 1, sequence, nonWitnessUtxo: parent.toBuffer() });
  } else {
    psbt.addInput({ hash: Buffer.alloc(32, seed), index: 0, sequence });
    if (prevout === 'witness') {
      psbt.updateInput(psbt.inputCount - 1, { witnessUtxo: { script, value: BigInt(value) } });
    }
  }
  return psbt.data.inputs[psbt.inputCount - 1];
};

/** A finalized BIP78 original: one 100,000 sat sender input paying 90,000 (fee 10,000). */
const buildOriginal = (
  { script = p2wpkh(1), prevout = 'witness' as Prevout } = {},
): bitcoin.Psbt => {
  const original = new bitcoin.Psbt({ network: TESTNET });
  addInput(original, { seed: 1, script, value: 100_000, prevout }).finalScriptWitness = WITNESS;
  original.addOutput({ script: PAYMENT_SCRIPT, value: 90_000n });
  return original;
};

/**
 * The receiver's proposal: sender inputs stripped, one finalized 30,000 sat
 * receiver input, payment raised by 29,000 (fee 11,000).
 */
const buildProposal = (
  original: bitcoin.Psbt,
  {
    receiverScript = p2wpkh(2),
    receiverPrevout = 'witness' as Prevout,
    receiverSequence = SEQUENCE,
    withReceiver = true,
    paymentValue = undefined as bigint | undefined,
  } = {},
): bitcoin.Psbt => {
  const proposal = new bitcoin.Psbt({ network: TESTNET });
  original.txInputs.forEach(input => {
    proposal.addInput({ hash: input.hash, index: input.index, sequence: input.sequence });
  });
  if (withReceiver) {
    addInput(proposal, {
      seed: 2,
      script: receiverScript,
      value: 30_000,
      prevout: receiverPrevout,
      sequence: receiverSequence,
    }).finalScriptWitness = WITNESS;
  }
  proposal.addOutput({ script: PAYMENT_SCRIPT, value: paymentValue ?? (withReceiver ? 119_000n : 90_000n) });
  return proposal;
};

const validate = (original: bitcoin.Psbt, proposal: bitcoin.Psbt) => (
  validatePayjoinProposal(original.toBase64(), proposal.toBase64(), TESTNET)
);

const decode = (base64: string | undefined): bitcoin.Psbt => {
  expect(base64).toBeDefined();
  return bitcoin.Psbt.fromBase64(base64!, { network: TESTNET });
};

const hex = (bytes: Uint8Array | undefined): string | undefined => bytes && Buffer.from(bytes).toString('hex');

export const registerPsbtPayjoinChecklistContracts = () => {
  describe('validatePayjoinProposal - BIP78 sender checklist', () => {
    it('accepts a compliant proposal and returns it with the sender prevouts restored', () => {
      const original = buildOriginal();
      const proposal = buildProposal(original);

      const result = validate(original, proposal);

      expect(result).toMatchObject({ valid: true, errors: [] });
      const restored = decode(result.proposalPsbt);
      expect(hex(restored.data.inputs[0].witnessUtxo?.script)).toBe(hex(original.data.inputs[0].witnessUtxo!.script));
      expect(restored.data.inputs[0].witnessUtxo?.value).toBe(100_000n);
      expect(restored.data.inputs[0].finalScriptWitness).toBeUndefined();
      expect(hex(restored.data.inputs[1].witnessUtxo?.script)).toBe(hex(p2wpkh(2)));
      expect(restored.data.inputs[1].witnessUtxo?.value).toBe(30_000n);
      expect(hex(restored.data.inputs[1].finalScriptWitness)).toBe(hex(WITNESS));
    });

    it('restores a P2WPKH sender prevout carried only as nonWitnessUtxo', () => {
      const original = buildOriginal({ prevout: 'nonWitness' });
      const proposal = buildProposal(original);
      expect(proposal.data.inputs[0].nonWitnessUtxo).toBeUndefined();

      const result = validate(original, proposal);

      expect(result).toMatchObject({ valid: true, errors: [] });
      const restored = decode(result.proposalPsbt);
      expect(hex(restored.data.inputs[0].nonWitnessUtxo)).toBe(hex(original.data.inputs[0].nonWitnessUtxo));
      expect(restored.data.inputs[0].witnessUtxo).toBeUndefined();
    });

    it('accepts a P2TR receiver input next to P2TR sender inputs', () => {
      const original = buildOriginal({ script: p2tr(1) });

      expect(validate(original, buildProposal(original, { receiverScript: p2tr(2) })))
        .toMatchObject({ valid: true, errors: [] });
    });

    it('accepts sender UTXO data that is byte-equal to the original (C-D10)', () => {
      const original = buildOriginal();
      const proposal = buildProposal(original);
      proposal.updateInput(0, { witnessUtxo: { script: p2wpkh(1), value: 100_000n } });

      expect(validate(original, proposal)).toMatchObject({ valid: true, errors: [] });
    });

    it('accepts a receiver input with an empty finalScriptSig next to its witness', () => {
      const original = buildOriginal();
      const proposal = buildProposal(original);
      proposal.data.inputs[1].finalScriptSig = Buffer.alloc(0);

      expect(validate(original, proposal)).toMatchObject({ valid: true, errors: [] });
    });

    it('derives the receiver script type from nonWitnessUtxo when that is all it carries', () => {
      const original = buildOriginal();
      const proposal = buildProposal(original, { receiverPrevout: 'nonWitness' });

      expect(validate(original, proposal)).toMatchObject({ valid: true, errors: [] });
    });

    it.each([
      ['a key path on an input', (proposal: bitcoin.Psbt) => {
        proposal.data.inputs[0].bip32Derivation = [{ masterFingerprint: Buffer.alloc(4, 1), pubkey: PUBKEY, path: 'm/0' }];
      }, ['Proposal input 0 must not carry BIP32 key paths']],
      ['a Taproot key path on an input', (proposal: bitcoin.Psbt) => {
        proposal.data.inputs[0].tapBip32Derivation = [{
          masterFingerprint: Buffer.alloc(4, 1), pubkey: PUBKEY.subarray(1), path: 'm/0', leafHashes: [],
        }];
      }, ['Proposal input 0 must not carry BIP32 key paths']],
      ['a key path on an output', (proposal: bitcoin.Psbt) => {
        proposal.updateOutput(0, { bip32Derivation: [{ masterFingerprint: Buffer.alloc(4, 1), pubkey: PUBKEY, path: 'm/0' }] });
      }, ['Proposal output 0 must not carry BIP32 key paths']],
      ['a Taproot key path on an output', (proposal: bitcoin.Psbt) => {
        proposal.data.outputs[0].tapBip32Derivation = [{
          masterFingerprint: Buffer.alloc(4, 1), pubkey: PUBKEY.subarray(1), path: 'm/0', leafHashes: [],
        }];
      }, ['Proposal output 0 must not carry BIP32 key paths']],
      ['a partialSig', (proposal: bitcoin.Psbt) => {
        proposal.data.inputs[0].partialSig = [{ pubkey: PUBKEY, signature: Buffer.from('300602010102010101', 'hex') }];
      }, ['Proposal input 0 must not carry signatures']],
      ['a tapKeySig', (proposal: bitcoin.Psbt) => {
        proposal.data.inputs[0].tapKeySig = Buffer.alloc(64, 1);
      }, ['Proposal input 0 must not carry signatures']],
      ['a tapScriptSig', (proposal: bitcoin.Psbt) => {
        proposal.data.inputs[0].tapScriptSig = [{
          pubkey: PUBKEY.subarray(1), leafHash: Buffer.alloc(32, 3), signature: Buffer.alloc(64, 4),
        }];
      }, ['Proposal input 0 must not carry signatures']],
      ['a finalized sender input', (proposal: bitcoin.Psbt) => {
        proposal.data.inputs[0].finalScriptWitness = WITNESS;
      }, ['Sender input 0 must not be finalized in the proposal']],
      ['an unfinalized receiver input', (proposal: bitcoin.Psbt) => {
        delete proposal.data.inputs[1].finalScriptWitness;
      }, ['Receiver input 1 must be finalized with a witness']],
      ['a receiver input with a non-empty finalScriptSig', (proposal: bitcoin.Psbt) => {
        proposal.data.inputs[1].finalScriptSig = Buffer.from('51', 'hex');
      }, ['Receiver input 1 must not carry a non-empty finalScriptSig']],
      ['sender UTXO data that conflicts with the original', (proposal: bitcoin.Psbt) => {
        proposal.updateInput(0, { witnessUtxo: { script: p2wpkh(1), value: 100_001n } });
      }, ['Sender input 0 UTXO data differs from the original']],
    ])('rejects %s with its own error', (_name, edit, errors) => {
      const original = buildOriginal();
      const proposal = buildProposal(original);
      edit(proposal);

      const result = validate(original, proposal);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(errors);
      expect(Object.keys(result)).not.toContain('proposalPsbt');
    });

    it.each([
      ['NONE on a sender input', 0, 0x02],
      ['SINGLE|ANYONECANPAY on a sender input', 0, 0x83],
      ['ALL|ANYONECANPAY on a sender input', 0, 0x81],
      ['NONE on a receiver input', 1, 0x02],
      ['DEFAULT on a P2WPKH sender input', 0, 0x00],
    ])('rejects a receiver-set sighash type: %s', (_name, index, sighashType) => {
      const original = buildOriginal();
      const proposal = buildProposal(original);
      proposal.data.inputs[index].sighashType = sighashType;

      const result = validate(original, proposal);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        `Proposal input ${index} must not request sighash type 0x${sighashType.toString(16).padStart(2, '0')}`,
      ]);
    });

    it('accepts SIGHASH_ALL on any input and SIGHASH_DEFAULT on P2TR inputs', () => {
      const original = buildOriginal();
      const proposal = buildProposal(original);
      proposal.updateInput(0, { sighashType: bitcoin.Transaction.SIGHASH_ALL });
      proposal.updateInput(1, { sighashType: bitcoin.Transaction.SIGHASH_ALL });
      const taprootOriginal = buildOriginal({ script: p2tr(1) });
      const taprootProposal = buildProposal(taprootOriginal, { receiverScript: p2tr(2) });
      taprootProposal.data.inputs[0].sighashType = bitcoin.Transaction.SIGHASH_DEFAULT;

      expect(validate(original, proposal)).toMatchObject({ valid: true, errors: [] });
      expect(validate(taprootOriginal, taprootProposal)).toMatchObject({ valid: true, errors: [] });
    });

    it('rejects a receiver input without UTXO data before computing any fee', () => {
      const original = buildOriginal();
      const proposal = buildProposal(original, { receiverPrevout: 'none' });

      const result = validate(original, proposal);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Receiver input 1 is missing UTXO data']);
    });

    it('rejects a P2SH-P2WPKH receiver input', () => {
      const original = buildOriginal();

      expect(validate(original, buildProposal(original, { receiverScript: p2shP2wpkh(2) })).errors)
        .toEqual(['Receiver input 1 script type unsupported is not P2WPKH or P2TR']);
    });

    it('rejects a P2TR receiver input next to P2WPKH sender inputs (mixed input types)', () => {
      const original = buildOriginal();

      expect(validate(original, buildProposal(original, { receiverScript: p2tr(2) })).errors)
        .toEqual(['Receiver input 1 script type p2tr does not match sender input type p2wpkh']);
    });

    it('rejects every receiver input when the sender inputs are not a P2WPKH or P2TR type', () => {
      const original = new bitcoin.Psbt({ network: TESTNET });
      addInput(original, { seed: 1, script: p2wpkh(1), value: 50_000, prevout: 'witness' });
      addInput(original, { seed: 3, script: p2tr(3), value: 50_000, prevout: 'witness' });
      original.addOutput({ script: PAYMENT_SCRIPT, value: 90_000n });

      expect(validate(original, buildProposal(original)).errors)
        .toEqual(['Receiver input 2 script type p2wpkh does not match sender input type p2wpkh,p2tr']);
    });

    it('treats a sender nonWitnessUtxo without the spent output as an unsupported type', () => {
      const parent = new bitcoin.Transaction();
      parent.addInput(Buffer.alloc(32, 9), 0);
      parent.addOutput(p2wpkh(1), 100_000n);
      const original = new bitcoin.Psbt({ network: TESTNET });
      original.addInput({ hash: parent.getHash(), index: 5, sequence: SEQUENCE });
      original.data.inputs[0].nonWitnessUtxo = parent.toBuffer();
      original.addOutput({ script: PAYMENT_SCRIPT, value: 90_000n });

      expect(validate(original, buildProposal(original)).errors)
        .toEqual(['Receiver input 1 script type p2wpkh does not match sender input type unsupported']);
    });

    it('rejects proposal inputs with mixed sequences', () => {
      const original = buildOriginal();

      expect(validate(original, buildProposal(original, { receiverSequence: 0xfffffffe })).errors)
        .toEqual(['Proposal inputs use mixed sequences']);
    });

    it('rejects a proposal that adds no receiver input', () => {
      const original = buildOriginal();

      expect(validate(original, buildProposal(original, { withReceiver: false }))).toEqual({
        valid: false,
        errors: ['Receiver did not add any inputs - this is not a proper Payjoin'],
        warnings: [],
      });
    });

    it('holds the proposal to the BIP78 minfeerate, sizing sender inputs with their original witnesses', () => {
      const original = buildOriginal();
      const proposal = buildProposal(original);
      const measured = proposal.clone();
      measured.updateInput(0, { witnessUtxo: { script: p2wpkh(1), value: 100_000n }, finalScriptWitness: WITNESS });
      const proposalRate = 11_000 / measured.extractTransaction(true).virtualSize();
      const atRate = validatePayjoinProposal(original.toBase64(), proposal.toBase64(), TESTNET, TESTNET, {
        minFeeRate: proposalRate,
      });
      const aboveRate = validatePayjoinProposal(original.toBase64(), proposal.toBase64(), TESTNET, TESTNET, {
        minFeeRate: proposalRate + 0.001,
      });

      expect(atRate).toMatchObject({ valid: true, errors: [] });
      expect(aboveRate.valid).toBe(false);
      expect(aboveRate.errors).toEqual([
        `Proposal fee rate ${proposalRate.toFixed(3)} sat/vB is below the minfeerate ${proposalRate + 0.001} sat/vB`,
      ]);
    });

    describe('with a BIP78 minfeerate', () => {
      const RECEIVER_WITNESS = Buffer.concat([Buffer.from([0x02, 72]), Buffer.alloc(72, 0x30), Buffer.from([33]), PUBKEY]);

      /** A receiver that keeps `rateFactor` x the original's rate, paying the fee out of its contribution. */
      const rateKeepingProposal = (rateFactor: number) => {
        const original = buildOriginal();
        const originalRate = 10_000 / original.extractTransaction(true).virtualSize();
        const sized = buildProposal(original);
        sized.updateInput(0, { witnessUtxo: { script: p2wpkh(1), value: 100_000n }, finalScriptWitness: WITNESS });
        sized.data.inputs[1].finalScriptWitness = RECEIVER_WITNESS;
        const fee = Math.ceil(originalRate * rateFactor * sized.extractTransaction(true).virtualSize());
        const proposal = buildProposal(original, { paymentValue: BigInt(130_000 - fee) });
        proposal.data.inputs[1].finalScriptWitness = RECEIVER_WITNESS;
        return { original, proposal, fee, originalRate };
      };

      const withMinFeeRate = (original: bitcoin.Psbt, proposal: bitcoin.Psbt, minFeeRate: number) => (
        validatePayjoinProposal(original.toBase64(), proposal.toBase64(), TESTNET, TESTNET, { minFeeRate })
      );

      it('accepts a receiver that keeps the rate even though the absolute fee rises by more than 50%', () => {
        const { original, proposal, fee, originalRate } = rateKeepingProposal(1);
        expect(fee).toBeGreaterThan(15_000);

        expect(validate(original, proposal).errors[0]).toMatch(/^Fee increased by more than 50%/);
        expect(withMinFeeRate(original, proposal, Math.floor(originalRate * 1000) / 1000))
          .toMatchObject({ valid: true, errors: [] });
      });

      it('bounds the fee-rate increase instead of the absolute fee', () => {
        const { original, proposal, originalRate } = rateKeepingProposal(1.6);
        const minFeeRate = Math.floor(originalRate * 1000) / 1000;

        expect(withMinFeeRate(original, proposal, minFeeRate).errors)
          .toEqual([expect.stringMatching(/^Fee rate increased by more than 50%: /)]);
      });

      it('stops before measuring when the fee amounts are invalid', () => {
        const messages = { errors: [] as string[], warnings: [] as string[] };
        const original = buildOriginal();

        validateMinFeeRatePolicy(original, buildProposal(original), { originalFee: -1, proposalFee: 11_000, minFeeRate: 1 }, messages);

        expect(messages).toEqual({ errors: ['Invalid negative Payjoin fee calculation: -1 -> 11000'], warnings: [] });
      });

      it('measures a sender input finalized by scriptSig alone', () => {
        const messages = { errors: [] as string[], warnings: [] as string[] };
        const original = new bitcoin.Psbt({ network: TESTNET });
        addInput(original, { seed: 1, script: p2wpkh(1), value: 100_000, prevout: 'witness' })
          .finalScriptSig = Buffer.from('51', 'hex');
        original.addOutput({ script: PAYMENT_SCRIPT, value: 90_000n });

        const proposal = buildProposal(original);
        // The checklist restores sender prevouts before the fee policy runs.
        proposal.updateInput(0, { witnessUtxo: { script: p2wpkh(1), value: 100_000n } });

        validateMinFeeRatePolicy(original, proposal, { originalFee: 10_000, proposalFee: 11_000, minFeeRate: 200 }, messages);

        // 11,000 sat over 126 vB: the sender's 1-byte scriptSig and the receiver's witness are both measured.
        expect(messages.errors).toEqual(['Proposal fee rate 87.302 sat/vB is below the minfeerate 200 sat/vB']);
      });

      it('skips the bounded increase for a zero minfeerate', () => {
        const { original, proposal } = rateKeepingProposal(1.6);

        const result = withMinFeeRate(original, proposal, 0);

        expect(result).toMatchObject({ valid: true, errors: [] });
        // Only the raised payment output is noted; no fee or fee-rate bound applies.
        expect(result.warnings).toEqual([expect.stringMatching(/^Original output 0 .* increased from 90000 to /)]);
      });

      it('fails closed when the original is not finalized, since its rate cannot be measured', () => {
        const { original, proposal } = rateKeepingProposal(1);
        delete original.data.inputs[0].finalScriptWitness;

        const result = withMinFeeRate(original, proposal, 1);

        expect(result).toMatchObject({ valid: false, errors: ['Validation failed: Not finalized'] });
        expect(result.proposalPsbt).toBeUndefined();
      });
    });

    it('throws from calculatePsbtFee when an input has no prevout data', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      addInput(psbt, { seed: 1, script: p2wpkh(1), value: 1, prevout: 'none' });
      psbt.addOutput({ script: PAYMENT_SCRIPT, value: 1n });

      expect(() => calculatePsbtFee(psbt)).toThrow('Input 0 is missing UTXO data');
    });

    it('accepts a zero-fee proposal for a zero-fee original', () => {
      const messages = { errors: [] as string[], warnings: [] as string[] };

      validateFeePolicy(0, 0, messages);

      expect(messages).toEqual({ errors: [], warnings: [] });
    });

    it('rejects a negative fee (outputs exceeding inputs) before comparing fee policy', () => {
      const messages = { errors: [] as string[], warnings: [] as string[] };

      validateFeePolicy(1000, -5, messages);

      expect(messages).toEqual({ errors: ['Invalid negative Payjoin fee calculation: 1000 -> -5'], warnings: [] });
    });
  });
};
