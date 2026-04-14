import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { validatePayjoinProposal } from '../../../../../src/services/bitcoin/psbtValidation';
import { createNonWitnessPsbt, createOpReturnPsbt, createTestPsbt, TESTNET } from './psbtValidationTestHarness';

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
        expect(result.errors.some(e => e.includes('Fee increased by more than 50%'))).toBe(true);
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
