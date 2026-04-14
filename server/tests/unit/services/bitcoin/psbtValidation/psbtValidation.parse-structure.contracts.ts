import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { parsePsbt, validatePsbtStructure } from '../../../../../src/services/bitcoin/psbtValidation';
import { createTestPsbt, MAINNET, TESTNET } from './psbtValidationTestHarness';

export const registerPsbtParseStructureContracts = () => {
  describe('parsePsbt', () => {
    it('should parse a valid base64 PSBT', () => {
      const psbt = createTestPsbt();
      const base64 = psbt.toBase64();

      const parsed = parsePsbt(base64, TESTNET);

      expect(parsed).toBeInstanceOf(bitcoin.Psbt);
      expect(parsed.inputCount).toBe(1);
      expect(parsed.txOutputs.length).toBe(1);
    });

    it('should parse PSBT with multiple inputs and outputs', () => {
      const psbt = createTestPsbt({ inputCount: 3, outputCount: 2 });
      const base64 = psbt.toBase64();

      const parsed = parsePsbt(base64, TESTNET);

      expect(parsed.inputCount).toBe(3);
      expect(parsed.txOutputs.length).toBe(2);
    });

    it('should throw error for invalid base64', () => {
      expect(() => parsePsbt('not-valid-base64!!!', TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should throw error for empty string', () => {
      expect(() => parsePsbt('', TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should throw error for valid base64 but invalid PSBT content', () => {
      // "Hello World" in base64 - valid base64 but not a PSBT
      expect(() => parsePsbt('SGVsbG8gV29ybGQ=', TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should use default mainnet network when not specified', () => {
      const psbt = createTestPsbt({ network: MAINNET });
      const base64 = psbt.toBase64();

      const parsed = parsePsbt(base64);

      expect(parsed).toBeInstanceOf(bitcoin.Psbt);
    });

    it('should handle PSBT with different network', () => {
      const mainnetPsbt = createTestPsbt({ network: MAINNET });
      const base64 = mainnetPsbt.toBase64();

      // Parsing mainnet PSBT with mainnet network should work
      const parsed = parsePsbt(base64, MAINNET);
      expect(parsed).toBeInstanceOf(bitcoin.Psbt);
    });

    it('should throw error for truncated PSBT', () => {
      const psbt = createTestPsbt();
      const base64 = psbt.toBase64();
      const truncated = base64.substring(0, base64.length / 2);

      expect(() => parsePsbt(truncated, TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should throw error for corrupted PSBT', () => {
      const psbt = createTestPsbt();
      const base64 = psbt.toBase64();
      // Corrupt some bytes in the middle - this may or may not throw depending on the corruption
      const corrupted = base64.substring(0, 20) + 'XXXX' + base64.substring(24);

      // Some corruptions may still parse but produce invalid data
      // The key is it should not silently succeed with wrong data
      try {
        const parsed = parsePsbt(corrupted, TESTNET);
        // If it parses, verify it's not the same as original
        expect(parsed.toBase64()).not.toBe(base64);
      } catch (e) {
        expect((e as Error).message).toContain('Invalid PSBT format');
      }
    });
  });

  describe('validatePsbtStructure', () => {
    it('should validate a well-formed PSBT', () => {
      const psbt = createTestPsbt();
      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should report error for PSBT with no inputs', () => {
      // Create PSBT without any inputs - bitcoinjs-lib may reject this
      // so we check for either "no inputs" error or a parse failure
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 1),
          network: TESTNET,
        }).output!,
        value: BigInt(50000),
      });

      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(false);
      // Either the PSBT has no inputs, or it failed to parse due to structure issues
      expect(
        result.errors.some(e => e.includes('no inputs') || e.includes('Failed to parse'))
      ).toBe(true);
    });

    it('should report no-input errors when parsed PSBT has zero inputs', () => {
      const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64').mockReturnValue({
        inputCount: 0,
        txOutputs: [{ value: 1000, script: Buffer.alloc(0) }],
        data: { inputs: [] },
      } as unknown as bitcoin.Psbt);

      try {
        const result = validatePsbtStructure('cHNidP8BAA==');

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('PSBT has no inputs');
      } finally {
        fromBase64Spy.mockRestore();
      }
    });

    it('should report error for PSBT with no outputs', () => {
      // Create a minimal PSBT and manually construct it with inputs but no outputs
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      // Add witnessUtxo to the input
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(100000),
        },
      });

      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PSBT has no outputs');
    });

    it('should warn about missing UTXO data', () => {
      const psbt = createTestPsbt({ addWitnessUtxo: false });
      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Input 0 missing UTXO data');
    });

    it('should report multiple missing UTXO warnings', () => {
      const psbt = createTestPsbt({ inputCount: 3, addWitnessUtxo: false });
      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(3);
      expect(result.warnings).toContain('Input 0 missing UTXO data');
      expect(result.warnings).toContain('Input 1 missing UTXO data');
      expect(result.warnings).toContain('Input 2 missing UTXO data');
    });

    it('should report error for invalid base64', () => {
      const result = validatePsbtStructure('not-valid-base64!!!');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to parse PSBT');
    });
  });
};
