import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import {
  calculateFeeRate,
  createRealisticPsbt,
  generateBip21Uri,
  getPsbtInputs,
  getPsbtOutputs,
  isRbfEnabled,
  parseBip21Uri,
  TEST_ADDRESS_RECEIVER,
  TEST_PAYJOIN_URL,
  TESTNET,
  validatePsbtStructure,
} from './payjoinIntegrationTestHarness';

export const registerPayjoinUriStructureContracts = () => {
  describe('BIP21 URI Flow', () => {
    it('should generate and parse BIP21 URI with Payjoin endpoint', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_RECEIVER, {
        amount: 100000000,
        label: 'Test Payment',
        payjoinUrl: TEST_PAYJOIN_URL,
      });

      expect(uri).toContain('bitcoin:');
      expect(uri).toContain('amount=');
      expect(uri).toContain('pj=');

      const parsed = parseBip21Uri(uri);

      expect(parsed.address).toBe(TEST_ADDRESS_RECEIVER);
      expect(parsed.amount).toBe(100000000);
      expect(parsed.label).toBe('Test Payment');
      expect(parsed.payjoinUrl).toBe(TEST_PAYJOIN_URL);
    });

    it('should handle URI without Payjoin endpoint', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_RECEIVER, {
        amount: 50000000,
      });

      const parsed = parseBip21Uri(uri);

      expect(parsed.address).toBe(TEST_ADDRESS_RECEIVER);
      expect(parsed.amount).toBe(50000000);
      expect(parsed.payjoinUrl).toBeUndefined();
    });

    it('should correctly encode/decode special characters', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_RECEIVER, {
        label: "John's & Mary's Store",
        message: 'Invoice #123: Payment',
        payjoinUrl: 'https://example.com/pj?key=value&other=123',
      });

      const parsed = parseBip21Uri(uri);

      expect(parsed.label).toBe("John's & Mary's Store");
      expect(parsed.message).toBe('Invoice #123: Payment');
      expect(parsed.payjoinUrl).toBe('https://example.com/pj?key=value&other=123');
    });
  });

  describe('PSBT Structure Validation', () => {
    it('should validate complete PSBT structure', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
          { txid: 'b'.repeat(64), vout: 1, value: 50000 },
        ],
        outputs: [
          { value: 80000 },
          { value: 60000 },
        ],
      });

      const validation = validatePsbtStructure(psbt.toBase64());

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should warn about missing UTXO data', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex'),
        index: 0,
        sequence: 0xfffffffd,
      });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 1),
          network: TESTNET,
        }).output!,
        value: BigInt(50000),
      });

      const validation = validatePsbtStructure(psbt.toBase64());

      expect(validation.valid).toBe(true);
      expect(validation.warnings.some(w => w.includes('UTXO data'))).toBe(true);
    });
  });

  describe('Fee Rate Calculation', () => {
    it('should calculate accurate fee rate', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const feeRate = calculateFeeRate(psbt);

      expect(feeRate).toBeGreaterThan(50);
      expect(feeRate).toBeLessThan(150);
    });

    it('should handle multiple inputs and outputs', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
          { txid: 'b'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 80000 },
          { value: 80000 },
          { value: 30000 },
        ],
      });

      const feeRate = calculateFeeRate(psbt);

      expect(feeRate).toBeGreaterThan(0);
    });
  });

  describe('RBF Detection', () => {
    it('should detect RBF-enabled PSBT', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      expect(isRbfEnabled(psbt)).toBe(true);
    });

    it('should detect non-RBF PSBT', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex').reverse(),
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
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 2),
          network: TESTNET,
        }).output!,
        value: BigInt(90000),
      });

      expect(isRbfEnabled(psbt)).toBe(false);
    });
  });

  describe('Input/Output Extraction', () => {
    it('should extract all inputs correctly', () => {
      const txid1 = 'a'.repeat(64);
      const txid2 = 'b'.repeat(64);

      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: txid1, vout: 0, value: 100000 },
          { txid: txid2, vout: 2, value: 50000 },
        ],
        outputs: [
          { value: 140000 },
        ],
      });

      const inputs = getPsbtInputs(psbt);

      expect(inputs).toHaveLength(2);
      expect(inputs[0].txid).toBe(txid1);
      expect(inputs[0].vout).toBe(0);
      expect(inputs[1].txid).toBe(txid2);
      expect(inputs[1].vout).toBe(2);
    });

    it('should extract all outputs correctly', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 50000 },
          { value: 40000 },
        ],
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);

      expect(outputs).toHaveLength(3);
      expect(outputs[0].value).toBe(100000);
      expect(outputs[1].value).toBe(50000);
      expect(outputs[2].value).toBe(40000);
    });
  });
};
