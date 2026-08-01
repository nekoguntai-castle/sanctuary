import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { validatePayjoinProposal } from '../../../../../src/services/bitcoin/psbtValidation';
import {
  resolveLegacySenderInputIndices,
  resolvePayjoinNetwork,
  validateFeePolicy,
  validateLegacySenderInputIndices,
  validateSenderInputs,
} from '../../../../../src/services/bitcoin/payjoinProposalValidation';
import { createNonWitnessPsbt, createOpReturnPsbt, createTestPsbt, TESTNET } from './psbtValidationTestHarness';

type PayjoinInputSpec = {
  txidSeed: number;
  value: number;
  vout?: number;
  sequence?: number;
};

type PayjoinOutputSpec = {
  script: Buffer;
  value: number;
};

const testTxid = (seed: number) => Buffer.alloc(32, seed);

const p2wpkhScript = (seed: number) => bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, seed),
  network: TESTNET,
}).output!;

const opReturnScript = (seed: number) => Buffer.from([0x6a, 0x01, seed]);

const createPayjoinIntegrityPsbt = ({
  inputs,
  outputs,
  version = 2,
  locktime = 0,
}: {
  inputs: PayjoinInputSpec[];
  outputs: PayjoinOutputSpec[];
  version?: number;
  locktime?: number;
}) => {
  const psbt = new bitcoin.Psbt({ network: TESTNET });
  psbt.setVersion(version);
  psbt.setLocktime(locktime);

  inputs.forEach((input, index) => {
    psbt.addInput({
      hash: testTxid(input.txidSeed),
      index: input.vout ?? 0,
      sequence: input.sequence ?? 0xfffffffd,
    });
    psbt.updateInput(index, {
      witnessUtxo: {
        script: p2wpkhScript(input.txidSeed),
        value: BigInt(input.value),
      },
    });
  });

  outputs.forEach(output => {
    psbt.addOutput({
      script: output.script,
      value: BigInt(output.value),
    });
  });

  return psbt;
};

const validateIntegrityProposal = (original: bitcoin.Psbt, proposal: bitcoin.Psbt) => (
  validatePayjoinProposal(original.toBase64(), proposal.toBase64(), [0], TESTNET)
);

export const registerPsbtPayjoinContracts = () => {
  describe('validatePayjoinProposal - BIP78 Rules', () => {
    /**
     * BIP78 Rule 1: Sender's outputs must not be removed or decreased
     */
    describe('Rule 1: Sender outputs preserved', () => {
      it('should accept proposal with unchanged sender outputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000], // payment + change
        });

        // Proposal adds receiver input but keeps sender outputs
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
          inputValues: [100000, 30000], // sender + receiver input
          outputValues: [50000, 70000], // payment unchanged, change increased
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });

      it('should reject proposal that removes sender output', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000],
        });

        // Proposal removes the second output
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [80000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('was removed'))).toBe(true);
      });

      it('should reject proposal that decreases sender output', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000],
        });

        // Create proposal with matching addresses but lower value
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
          inputValues: [100000, 30000],
          outputValues: [45000, 40000], // First output decreased!
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('decreased'))).toBe(true);
      });

      it('should warn when sender output is increased (allowed but notable)', () => {
        // Create original with 1 input, 2 outputs
        // Original: 100000 input - 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          inputValues: [100000],
          outputValues: [50000, 40000],
        });

        // For proposal, we need the same output addresses but different values
        // Create proposal manually to ensure output addresses match
        const proposal = new bitcoin.Psbt({ network: TESTNET });

        // Add original input (same txid)
        proposal.addInput({
          hash: Buffer.from('0'.padStart(64, 'a'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: BigInt(100000),
          },
        });

        // Add receiver input (new)
        proposal.addInput({
          hash: Buffer.from('1'.padStart(64, 'b'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(1, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 2),
              network: TESTNET,
            }).output!,
            value: BigInt(30000),
          },
        });

        // Add outputs with same addresses as original but increased first value
        // Proposal: 130000 input - 118000 output = 12000 fee (20% increase, under 50% limit)
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: BigInt(60000), // Increased from 50000 (output increased by 10000)
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: BigInt(58000), // Increased from 40000 to absorb receiver contribution
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.warnings.some(w => w.includes('increased'))).toBe(true);
      });

      it('should skip unknown outputs when comparing sender outputs', () => {
        const original = createOpReturnPsbt(7);
        const proposal = createOpReturnPsbt(7);

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });
    });

    /**
     * BIP78 Rule 2: Sender's inputs must not be modified
     */
    describe('Rule 2: Sender inputs unmodified', () => {
      it('should accept proposal with sender inputs at same positions', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000],
        });

        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
          inputValues: [100000, 30000],
          outputValues: [50000, 70000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.errors.filter(e => e.includes('modified'))).toHaveLength(0);
      });

      it('should reject proposal that modifies sender input txid', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        // Create proposal with different txid for input 0
        const proposal = new bitcoin.Psbt({ network: TESTNET });
        proposal.addInput({
          hash: Buffer.alloc(32, 0xbb), // Different txid
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: BigInt(100000),
          },
        });
        proposal.addInput({
          hash: Buffer.alloc(32, 0xcc),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(1, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 2),
              network: TESTNET,
            }).output!,
            value: BigInt(30000),
          },
        });
        // Add matching outputs
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('modified'))).toBe(true);
      });

      it('should report error for out-of-range sender input index', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
        });

        // Specify sender input index 5 which doesn't exist
        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [5],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('out of range'))).toBe(true);
      });

      it('rejects replacement of a non-first original sender input even when caller supplies only index 0', () => {
        const receiverScript = p2wpkhScript(0x50);
        const changeScript = p2wpkhScript(0x51);
        const original = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xaa, value: 500000 },
            { txidSeed: 0xbb, value: 250000, vout: 1 },
          ],
          outputs: [
            { script: receiverScript, value: 300000 },
            { script: changeScript, value: 430000 },
          ],
        });
        const proposal = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xaa, value: 500000 },
            { txidSeed: 0xcc, value: 420000 },
          ],
          outputs: [
            { script: receiverScript, value: 300000 },
            { script: changeScript, value: 600000 },
          ],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('was not preserved'))).toBe(true);
      });

      it('accepts receiver input insertion without reordering original sender inputs', () => {
        const receiverScript = p2wpkhScript(0x52);
        const changeScript = p2wpkhScript(0x53);
        const original = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xa1, value: 120000 },
            { txidSeed: 0xb1, value: 80000 },
          ],
          outputs: [
            { script: receiverScript, value: 100000 },
            { script: changeScript, value: 80000 },
          ],
        });
        const proposal = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xa1, value: 120000 },
            { txidSeed: 0xc1, value: 50000 },
            { txidSeed: 0xb1, value: 80000 },
          ],
          outputs: [
            { script: receiverScript, value: 100000 },
            { script: changeScript, value: 130000 },
          ],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(true);
      });

      it('rejects sender input sequence mutation', () => {
        const outputScript = p2wpkhScript(0x54);
        const original = createPayjoinIntegrityPsbt({
          inputs: [{ txidSeed: 0xa2, value: 100000, sequence: 0xfffffffd }],
          outputs: [{ script: outputScript, value: 90000 }],
        });
        const proposal = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xa2, value: 100000, sequence: 0xffffffff },
            { txidSeed: 0xc2, value: 20000 },
          ],
          outputs: [{ script: outputScript, value: 110000 }],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('sequence changed'))).toBe(true);
      });

      it('rejects proposals that duplicate an original sender input', () => {
        const messages = { errors: [] as string[], warnings: [] as string[] };
        const input = { txid: 'a'.repeat(64), vout: 0, sequence: 0xfffffffd };

        validateSenderInputs([input], [input, input], messages);

        expect(messages.errors.some(e => e.includes('appears more than once'))).toBe(true);
      });
    });

    describe('Legacy sender-index compatibility', () => {
      it('derives the validation network while preserving only diagnostic legacy indices', () => {
        expect(resolvePayjoinNetwork(undefined, TESTNET)).toBe(bitcoin.networks.bitcoin);
        expect(resolvePayjoinNetwork([0], TESTNET)).toBe(TESTNET);
        expect(resolvePayjoinNetwork(TESTNET, bitcoin.networks.bitcoin)).toBe(TESTNET);
        expect(resolveLegacySenderInputIndices([0])).toEqual([0]);
        expect(resolveLegacySenderInputIndices(TESTNET)).toBeNull();
      });

      it('ignores absent legacy sender indices', () => {
        const errors: string[] = [];

        validateLegacySenderInputIndices(
          null,
          [{ txid: 'a'.repeat(64), vout: 0, sequence: 0xfffffffd }],
          errors,
        );

        expect(errors).toHaveLength(0);
      });
    });

    describe('Rule 2b: Transaction-level fields unchanged', () => {
      it('rejects proposal transaction version mutation', () => {
        const outputScript = p2wpkhScript(0x55);
        const original = createPayjoinIntegrityPsbt({
          version: 2,
          inputs: [{ txidSeed: 0xa3, value: 100000 }],
          outputs: [{ script: outputScript, value: 90000 }],
        });
        const proposal = createPayjoinIntegrityPsbt({
          version: 1,
          inputs: [
            { txidSeed: 0xa3, value: 100000 },
            { txidSeed: 0xc3, value: 20000 },
          ],
          outputs: [{ script: outputScript, value: 110000 }],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('version changed'))).toBe(true);
      });

      it('rejects proposal transaction locktime mutation', () => {
        const outputScript = p2wpkhScript(0x56);
        const original = createPayjoinIntegrityPsbt({
          locktime: 42,
          inputs: [{ txidSeed: 0xa4, value: 100000 }],
          outputs: [{ script: outputScript, value: 90000 }],
        });
        const proposal = createPayjoinIntegrityPsbt({
          locktime: 43,
          inputs: [
            { txidSeed: 0xa4, value: 100000 },
            { txidSeed: 0xc4, value: 20000 },
          ],
          outputs: [{ script: outputScript, value: 110000 }],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('locktime changed'))).toBe(true);
      });
    });

    /**
     * BIP78 Rule 3: Fee must not increase by more than 50%
     */
    describe('Rule 3: Fee increase limit', () => {
      it('should accept proposal with reasonable fee increase', () => {
        // Original: 100000 input, 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          inputValues: [100000],
          outputValues: [90000],
        });

        // Proposal: 130000 input, 117000 output = 13000 fee (30% increase)
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [117000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });

      it('should reject proposal with fee increase over 50%', () => {
        // Original: 100000 input, 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          inputValues: [100000],
          outputValues: [90000],
        });

        // Proposal: 130000 input, 104000 output = 26000 fee (160% increase!)
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [104000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('more than 50%'))).toBe(true);
      });

      it('should warn about significant fee increase (20-50%)', () => {
        // Original: 100000 input, 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          inputValues: [100000],
          outputValues: [90000],
        });

        // Proposal: 130000 input, 112000 output = 18000 fee (80% increase, but less than 50% of original is 15000)
        // Wait, 80% > 50%, so this should fail. Let's use 45%: 14500 fee
        // Actually 10000 * 1.45 = 14500, so output = 130000 - 14500 = 115500
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [117000], // Fee = 13000 = 30% increase
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.warnings.some(w => w.includes('significantly'))).toBe(true);
      });

      it('should evaluate fees from nonWitnessUtxo data', () => {
        const original = createNonWitnessPsbt({
          inputValue: 120000,
          outputValue: 100000,
          seed: 4,
        });
        const proposal = createNonWitnessPsbt({
          inputValue: 120000,
          outputValue: 100000,
          seed: 4,
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });

      it('should handle fee calculation when inputs have no UTXO metadata', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          addWitnessUtxo: false,
          outputValues: [50000],
        });
        const proposal = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          addWitnessUtxo: false,
          outputValues: [50000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Invalid negative Payjoin fee'))).toBe(true);
      });

      it('rejects proposal absolute fees below the original transaction fee', () => {
        const receiverScript = p2wpkhScript(0x57);
        const changeScript = p2wpkhScript(0x58);
        const original = createPayjoinIntegrityPsbt({
          inputs: [{ txidSeed: 0xa5, value: 100000 }],
          outputs: [
            { script: receiverScript, value: 60000 },
            { script: changeScript, value: 30000 },
          ],
        });
        const proposal = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xa5, value: 100000 },
            { txidSeed: 0xc5, value: 50000 },
          ],
          outputs: [
            { script: receiverScript, value: 60000 },
            { script: changeScript, value: 85000 },
          ],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Fee decreased'))).toBe(true);
      });

      it('rejects non-finite fee calculations before comparing fee policy', () => {
        const messages = { errors: [] as string[], warnings: [] as string[] };

        validateFeePolicy(Number.POSITIVE_INFINITY, 1000, messages);

        expect(messages.errors).toContain('Non-finite Payjoin fee calculation: Infinity -> 1000');
        expect(messages.warnings).toHaveLength(0);
      });

      it('rejects positive proposal fees when the original transaction has zero fee', () => {
        const messages = { errors: [] as string[], warnings: [] as string[] };

        validateFeePolicy(0, 1000, messages);

        expect(messages.errors).toContain('Fee increased from zero original fee to 1000');
        expect(messages.warnings).toHaveLength(0);
      });
    });

    describe('Rule 3b: Sender output scripts preserved as an ordered multiset', () => {
      it('rejects duplicate output aliasing when one same-script sender output is removed', () => {
        const duplicateScript = p2wpkhScript(0x59);
        const attackerScript = p2wpkhScript(0x5a);
        const original = createPayjoinIntegrityPsbt({
          inputs: [{ txidSeed: 0xa6, value: 120000 }],
          outputs: [
            { script: duplicateScript, value: 50000 },
            { script: duplicateScript, value: 50000 },
          ],
        });
        const proposal = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xa6, value: 120000 },
            { txidSeed: 0xc6, value: 50000 },
          ],
          outputs: [
            { script: duplicateScript, value: 50000 },
            { script: attackerScript, value: 100000 },
          ],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('was removed'))).toBe(true);
      });

      it('rejects mutation of a non-address sender output script', () => {
        const receiverScript = p2wpkhScript(0x5b);
        const original = createPayjoinIntegrityPsbt({
          inputs: [{ txidSeed: 0xa7, value: 100000 }],
          outputs: [
            { script: opReturnScript(1), value: 0 },
            { script: receiverScript, value: 90000 },
          ],
        });
        const proposal = createPayjoinIntegrityPsbt({
          inputs: [
            { txidSeed: 0xa7, value: 100000 },
            { txidSeed: 0xc7, value: 50000 },
          ],
          outputs: [
            { script: opReturnScript(2), value: 0 },
            { script: receiverScript, value: 140000 },
          ],
        });

        const result = validateIntegrityProposal(original, proposal);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('was removed'))).toBe(true);
      });
    });

    /**
     * BIP78 Rule 4: Input count must not be reduced
     */
    describe('Rule 4: Input count preserved or increased', () => {
      it('should accept proposal with more inputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          inputValues: [100000],
          outputValues: [50000, 40000],
        });

        // Create proposal with 3 inputs and same output addresses
        const proposal = new bitcoin.Psbt({ network: TESTNET });

        // Add original sender input (same txid)
        proposal.addInput({
          hash: Buffer.from('0'.padStart(64, 'a'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: BigInt(100000),
          },
        });

        // Add 2 new receiver inputs
        for (let i = 1; i <= 2; i++) {
          proposal.addInput({
            hash: Buffer.from(i.toString().padStart(64, 'b'), 'hex'),
            index: 0,
            sequence: 0xfffffffd,
          });
          proposal.updateInput(i, {
            witnessUtxo: {
              script: bitcoin.payments.p2wpkh({
                hash: Buffer.alloc(20, i + 10),
                network: TESTNET,
              }).output!,
              value: BigInt(30000),
            },
          });
        }

        // Add outputs with same addresses as original
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: BigInt(100000), // Receiver gets their contribution
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });

      it('should reject proposal with fewer inputs', () => {
        const original = createTestPsbt({
          inputCount: 3,
          outputCount: 2,
        });

        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0, 1, 2],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('fewer inputs'))).toBe(true);
      });
    });

    /**
     * BIP78 Rule 5: Receiver should add inputs
     */
    describe('Rule 5: Receiver contribution', () => {
      it('should accept proposal with new receiver inputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          inputValues: [100000],
          outputValues: [50000, 40000],
        });

        // Create proposal with sender's input plus a new receiver input
        const proposal = new bitcoin.Psbt({ network: TESTNET });

        // Add original sender input (same txid)
        proposal.addInput({
          hash: Buffer.from('0'.padStart(64, 'a'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: BigInt(100000),
          },
        });

        // Add new receiver input (different txid)
        proposal.addInput({
          hash: Buffer.from('1'.padStart(64, 'b'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(1, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 20),
              network: TESTNET,
            }).output!,
            value: BigInt(30000),
          },
        });

        // Add outputs with same addresses as original
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: BigInt(70000), // Increased by receiver contribution
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.warnings.some(w => w.includes('did not add any inputs'))).toBe(false);
      });

      it('should warn when receiver adds no inputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        // Same inputs, just copied
        const proposal = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true); // Valid but not a proper Payjoin
        expect(result.warnings.some(w => w.includes('did not add any inputs'))).toBe(true);
      });
    });

    describe('Error handling', () => {
      it('should handle invalid original PSBT', () => {
        const validPsbt = createTestPsbt();

        const result = validatePayjoinProposal(
          'invalid-psbt',
          validPsbt.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Validation failed'))).toBe(true);
      });

      it('should handle invalid proposal PSBT', () => {
        const validPsbt = createTestPsbt();

        const result = validatePayjoinProposal(
          validPsbt.toBase64(),
          'invalid-psbt',
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Validation failed'))).toBe(true);
      });
    });
  });
};
