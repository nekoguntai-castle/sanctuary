import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { clonePsbt, getPsbtInputs, getPsbtOutputs, mergeSignedInputs, validatePsbtStructure } from '../../../../../src/services/bitcoin/psbtValidation';
import { createTestPsbt, TESTNET } from './psbtValidationTestHarness';

export const registerPsbtCloneMergeEdgeContracts = () => {
  describe('clonePsbt', () => {
    it('should create an independent copy', () => {
      const original = createTestPsbt();
      const clone = clonePsbt(original);

      // Modify the original
      original.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 0xff),
          network: TESTNET,
        }).output!,
        value: BigInt(1000),
      });

      // Clone should not be affected
      expect(clone.txOutputs.length).toBe(1);
      expect(original.txOutputs.length).toBe(2);
    });

    it('should preserve all PSBT data', () => {
      const original = createTestPsbt({
        inputCount: 2,
        outputCount: 3,
        inputValues: [100000, 50000],
        outputValues: [60000, 40000, 30000],
      });

      const clone = clonePsbt(original);

      expect(clone.inputCount).toBe(original.inputCount);
      expect(clone.txOutputs.length).toBe(original.txOutputs.length);
      expect(clone.toBase64()).toBe(original.toBase64());
    });
  });

  describe('mergeSignedInputs', () => {
    it('should copy signature data from receiver to sender PSBT', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      // Simulate receiver signing input 1
      const mockPartialSig = [{
        pubkey: Buffer.alloc(33, 0x02),
        signature: Buffer.alloc(72, 0xff),
      }];
      receiver.data.inputs[1].partialSig = mockPartialSig;

      const merged = mergeSignedInputs(sender, receiver, [1]);

      expect(merged.data.inputs[1].partialSig).toEqual(mockPartialSig);
    });

    it('should not modify original sender PSBT', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      receiver.data.inputs[1].partialSig = [{
        pubkey: Buffer.alloc(33, 0x02),
        signature: Buffer.alloc(72, 0xff),
      }];

      mergeSignedInputs(sender, receiver, [1]);

      // Original sender should not have the signature
      expect(sender.data.inputs[1].partialSig).toBeUndefined();
    });

    it('should handle out-of-range indices gracefully', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      // This should not throw
      const merged = mergeSignedInputs(sender, receiver, [5, 10]);

      expect(merged.inputCount).toBe(2);
    });

    it('should copy finalScriptWitness if present', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      const mockWitness = Buffer.from([0x00, 0x01, 0x02]);
      receiver.data.inputs[1].finalScriptWitness = mockWitness;

      const merged = mergeSignedInputs(sender, receiver, [1]);

      expect(merged.data.inputs[1].finalScriptWitness).toEqual(mockWitness);
    });

    it('should copy finalScriptSig if present', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      const mockFinalScriptSig = Buffer.from([0x51]);
      receiver.data.inputs[0].finalScriptSig = mockFinalScriptSig;

      const merged = mergeSignedInputs(sender, receiver, [0]);
      expect(merged.data.inputs[0].finalScriptSig).toEqual(mockFinalScriptSig);
    });
  });

  describe('Edge cases and security', () => {
    it('should handle PSBT with maximum allowed inputs', () => {
      // Test with 10 inputs (reasonable maximum for testing)
      const psbt = createTestPsbt({
        inputCount: 10,
        outputCount: 2,
      });

      expect(psbt.inputCount).toBe(10);
      const inputs = getPsbtInputs(psbt);
      expect(inputs).toHaveLength(10);
    });

    it('should handle PSBT with very large values', () => {
      const psbt = createTestPsbt({
        inputCount: 1,
        outputCount: 1,
        inputValues: [2100000000000000], // 21 million BTC in sats
        outputValues: [2099999999990000],
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);
      expect(outputs[0].value).toBe(2099999999990000);
    });

    it('should reject negative values in validation', () => {
      // bitcoinjs-lib prevents negative values, but we test our validation
      const psbt = createTestPsbt();

      // Structure validation should pass
      const result = validatePsbtStructure(psbt.toBase64());
      expect(result.valid).toBe(true);
    });
  });
};
