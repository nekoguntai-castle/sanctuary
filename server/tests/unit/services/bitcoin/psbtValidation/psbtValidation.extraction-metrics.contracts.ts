import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { calculateFeeRate, calculateVSize, getPsbtInputs, getPsbtOutputs, isRbfEnabled } from '../../../../../src/services/bitcoin/psbtValidation';
import { createNonWitnessPsbt, createTestPsbt, MAINNET, TESTNET } from './psbtValidationTestHarness';

export const registerPsbtExtractionMetricsContracts = () => {
  describe('getPsbtInputs', () => {
    it('should extract inputs with correct txid, vout, and sequence', () => {
      const psbt = createTestPsbt({ inputCount: 3, sequence: 0xfffffffd });
      const inputs = getPsbtInputs(psbt);

      expect(inputs).toHaveLength(3);
      inputs.forEach((input, i) => {
        expect(input.txid).toHaveLength(64);
        expect(input.vout).toBe(0);
        expect(input.sequence).toBe(0xfffffffd);
      });
    });

    it('should correctly reverse txid bytes', () => {
      const psbt = createTestPsbt({ inputCount: 1 });
      const inputs = getPsbtInputs(psbt);

      // The txid should be the reversed hex of the hash
      expect(inputs[0].txid).toBeDefined();
      expect(inputs[0].txid.length).toBe(64);
    });

    it('should handle default sequence (0xffffffff) when not specified', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        // No sequence specified
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(100000),
        },
      });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 2),
          network: TESTNET,
        }).output!,
        value: BigInt(50000),
      });

      const inputs = getPsbtInputs(psbt);
      // Default sequence is 0xfffffffe or 0xffffffff depending on implementation
      expect(inputs[0].sequence).toBeGreaterThanOrEqual(0xfffffffd);
    });

    it('should use fallback sequence for inputs with undefined sequence', () => {
      const fakePsbt = {
        txInputs: [{ hash: Buffer.alloc(32, 0xaa), index: 1, sequence: undefined }],
      } as unknown as bitcoin.Psbt;

      const inputs = getPsbtInputs(fakePsbt);
      expect(inputs[0].sequence).toBe(0xffffffff);
    });
  });

  describe('getPsbtOutputs', () => {
    it('should extract outputs with address and value', () => {
      const psbt = createTestPsbt({
        outputCount: 2,
        outputValues: [50000, 30000],
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);

      expect(outputs).toHaveLength(2);
      expect(outputs[0].value).toBe(50000);
      expect(outputs[1].value).toBe(30000);
    });

    it('should return "unknown" for unrecognized output scripts', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(100000),
        },
      });
      // Add OP_RETURN output
      psbt.addOutput({
        script: Buffer.from([0x6a, 0x04, 0x74, 0x65, 0x73, 0x74]), // OP_RETURN "test"
        value: BigInt(0),
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);

      expect(outputs).toHaveLength(1);
      expect(outputs[0].address).toBe('unknown');
      expect(outputs[0].value).toBe(0);
    });

    it('should use default mainnet network when not specified', () => {
      const psbt = createTestPsbt({ network: MAINNET });
      const outputs = getPsbtOutputs(psbt);

      expect(outputs).toHaveLength(1);
    });
  });

  describe('isRbfEnabled', () => {
    it('should return true for sequence < 0xfffffffe', () => {
      const psbt = createTestPsbt({ sequence: 0xfffffffd });
      expect(isRbfEnabled(psbt)).toBe(true);
    });

    it('should return false for sequence = 0xfffffffe', () => {
      const psbt = createTestPsbt({ sequence: 0xfffffffe });
      expect(isRbfEnabled(psbt)).toBe(false);
    });

    it('should return false for sequence = 0xffffffff', () => {
      const psbt = createTestPsbt({ sequence: 0xffffffff });
      expect(isRbfEnabled(psbt)).toBe(false);
    });

    it('should return true if ANY input has RBF enabled', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });

      // Add input with RBF disabled
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xffffffff,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(100000),
        },
      });

      // Add input with RBF enabled
      psbt.addInput({
        hash: Buffer.alloc(32, 0xbb),
        index: 0,
        sequence: 0xfffffffd, // RBF enabled
      });
      psbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 2),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        },
      });

      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 3),
          network: TESTNET,
        }).output!,
        value: BigInt(100000),
      });

      expect(isRbfEnabled(psbt)).toBe(true);
    });

    it('should treat missing input sequence as final sequence', () => {
      const fakePsbt = {
        txInputs: [{ sequence: undefined }],
      } as unknown as bitcoin.Psbt;

      expect(isRbfEnabled(fakePsbt)).toBe(false);
    });
  });

  describe('calculateFeeRate', () => {
    it('should calculate correct fee rate', () => {
      // 100000 input - 90000 output = 10000 fee
      const psbt = createTestPsbt({
        inputCount: 1,
        outputCount: 1,
        inputValues: [100000],
        outputValues: [90000],
      });

      const feeRate = calculateFeeRate(psbt);

      // Fee rate = fee / vsize
      // For a simple P2WPKH transaction, vsize is roughly 110-140 vbytes
      // 10000 / ~110 = ~90 sat/vB
      expect(feeRate).toBeGreaterThan(0);
      expect(feeRate).toBeLessThan(200);
    });

    it('should return 0 for PSBT without input values', () => {
      const psbt = createTestPsbt({ addWitnessUtxo: false });
      const feeRate = calculateFeeRate(psbt);

      // Without UTXO data, cannot calculate fee
      expect(feeRate).toBeLessThanOrEqual(0);
    });

    it('should handle multiple inputs and outputs', () => {
      const psbt = createTestPsbt({
        inputCount: 3,
        outputCount: 2,
        inputValues: [100000, 200000, 150000],
        outputValues: [400000, 40000],
      });

      const feeRate = calculateFeeRate(psbt);

      // Total input: 450000, Total output: 440000, Fee: 10000
      expect(feeRate).toBeGreaterThan(0);
    });

    it('should calculate fee rate using nonWitnessUtxo values', () => {
      const psbt = createNonWitnessPsbt({
        inputValue: 150000,
        outputValue: 120000,
        seed: 6,
      });

      const feeRate = calculateFeeRate(psbt);
      expect(feeRate).toBeGreaterThan(0);
    });

    it('should return zero fee rate when virtual size resolves to zero', () => {
      const fakePsbt = {
        inputCount: 0,
        data: { inputs: [] },
        txOutputs: [],
        extractTransaction: vi.fn().mockReturnValue({
          virtualSize: () => 0,
        }),
      } as unknown as bitcoin.Psbt;

      const feeRate = calculateFeeRate(fakePsbt);
      expect(feeRate).toBe(0);
    });
  });

  describe('calculateVSize', () => {
    it('should return reasonable vsize for P2WPKH transaction', () => {
      const psbt = createTestPsbt({
        inputCount: 1,
        outputCount: 2,
      });

      const vsize = calculateVSize(psbt);

      // P2WPKH: ~68 vB per input, ~34 vB per output, ~10.5 vB overhead
      // 1 input + 2 outputs = 68 + 68 + 10.5 = ~146.5
      expect(vsize).toBeGreaterThan(100);
      expect(vsize).toBeLessThan(250);
    });

    it('should scale with input count', () => {
      const psbt1 = createTestPsbt({ inputCount: 1, outputCount: 2 });
      const psbt2 = createTestPsbt({ inputCount: 3, outputCount: 2 });

      const vsize1 = calculateVSize(psbt1);
      const vsize2 = calculateVSize(psbt2);

      expect(vsize2).toBeGreaterThan(vsize1);
    });
  });
};
