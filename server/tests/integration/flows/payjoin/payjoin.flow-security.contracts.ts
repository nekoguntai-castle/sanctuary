import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import {
  clonePsbt,
  createRealisticPsbt,
  getPsbtInputs,
  isRbfEnabled,
  TESTNET,
  validatePayjoinProposal,
  validatePsbtStructure,
} from './payjoinIntegrationTestHarness';

export const registerPayjoinFlowSecurityContracts = () => {
  describe('Complete Payjoin Flow', () => {
    it('should complete full sender-receiver Payjoin cycle', async () => {
      const senderTxid = 'a'.repeat(64);
      const receiverOutputScript = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x10),
        network: TESTNET,
      }).output!;
      const senderChangeScript = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x11),
        network: TESTNET,
      }).output!;

      const originalPsbt = new bitcoin.Psbt({ network: TESTNET });

      originalPsbt.addInput({
        hash: Buffer.from(senderTxid, 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      originalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(200000),
        },
      });

      originalPsbt.addOutput({ script: receiverOutputScript, value: BigInt(100000) });
      originalPsbt.addOutput({ script: senderChangeScript, value: BigInt(90000) });

      const structureValidation = validatePsbtStructure(originalPsbt.toBase64());
      expect(structureValidation.valid).toBe(true);

      const receiverTxid = 'b'.repeat(64);
      const proposalPsbt = new bitcoin.Psbt({ network: TESTNET });

      proposalPsbt.addInput({
        hash: Buffer.from(senderTxid, 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(200000),
        },
      });

      proposalPsbt.addInput({
        hash: Buffer.from(receiverTxid, 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: BigInt(80000),
        },
      });

      proposalPsbt.addOutput({ script: receiverOutputScript, value: BigInt(178000) });
      proposalPsbt.addOutput({ script: senderChangeScript, value: BigInt(90000) });

      const proposalValidation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        proposalPsbt.toBase64(),
        [0],
        TESTNET,
      );

      expect(proposalValidation.valid).toBe(true);
      expect(proposalValidation.warnings.length).toBeGreaterThanOrEqual(0);

      const originalInputs = getPsbtInputs(originalPsbt);
      const proposalInputs = getPsbtInputs(proposalPsbt);
      expect(proposalInputs.length).toBeGreaterThan(originalInputs.length);
      expect(isRbfEnabled(proposalPsbt)).toBe(true);
    });

    it('should detect and reject malicious proposal that removes sender output', async () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 90000 },
        ],
      });

      const maliciousPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 190000 },
        ],
      });

      maliciousPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      maliciousPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        },
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        maliciousPsbt.toBase64(),
        [0],
        TESTNET,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('removed'))).toBe(true);
    });

    it('should detect and reject proposal with excessive fee increase', async () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 80000 },
        ],
      });

      const badPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 50000 },
        ],
      });

      badPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      badPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        },
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        badPsbt.toBase64(),
        [0],
        TESTNET,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('50%'))).toBe(true);
    });

    it('should warn when receiver adds no inputs', async () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 90000 },
        ],
      });

      const identicalPsbt = clonePsbt(originalPsbt);

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        identicalPsbt.toBase64(),
        [0],
        TESTNET,
      );

      expect(validation.valid).toBe(true);
      expect(validation.warnings.some(w =>
        w.includes('not add any inputs') || w.includes('not a proper Payjoin')
      )).toBe(true);
    });
  });

  describe('Security Scenarios', () => {
    it('should reject proposal that modifies sender input', () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 50000 },
          { value: 40000 },
        ],
      });

      const maliciousPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'c'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 50000 },
          { value: 40000 },
        ],
      });

      maliciousPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      maliciousPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: BigInt(30000),
        },
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        maliciousPsbt.toBase64(),
        [0],
        TESTNET,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('modified'))).toBe(true);
    });

    it('should reject proposal with fewer inputs than original', () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
          { txid: 'b'.repeat(64), vout: 0, value: 50000 },
        ],
        outputs: [
          { value: 140000 },
        ],
      });

      const badPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        badPsbt.toBase64(),
        [0, 1],
        TESTNET,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('fewer inputs'))).toBe(true);
    });

    it('should handle multiple sender inputs correctly', () => {
      const outputScript1 = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x10),
        network: TESTNET,
      }).output!;
      const outputScript2 = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x11),
        network: TESTNET,
      }).output!;

      const originalPsbt = new bitcoin.Psbt({ network: TESTNET });

      originalPsbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      originalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(100000),
        },
      });
      originalPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 1,
        sequence: 0xfffffffd,
      });
      originalPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 2),
            network: TESTNET,
          }).output!,
          value: BigInt(80000),
        },
      });

      originalPsbt.addOutput({ script: outputScript1, value: BigInt(100000) });
      originalPsbt.addOutput({ script: outputScript2, value: BigInt(70000) });

      const proposalPsbt = new bitcoin.Psbt({ network: TESTNET });

      proposalPsbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: BigInt(100000),
        },
      });
      proposalPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 1,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 2),
            network: TESTNET,
          }).output!,
          value: BigInt(80000),
        },
      });

      proposalPsbt.addInput({
        hash: Buffer.from('c'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(2, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: BigInt(50000),
        },
      });

      proposalPsbt.addOutput({ script: outputScript1, value: BigInt(148000) });
      proposalPsbt.addOutput({ script: outputScript2, value: BigInt(70000) });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        proposalPsbt.toBase64(),
        [0, 1],
        TESTNET,
      );

      expect(validation.valid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid original PSBT gracefully', () => {
      const validPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const validation = validatePayjoinProposal(
        'invalid-base64-psbt',
        validPsbt.toBase64(),
        [0],
        TESTNET,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should handle invalid proposal PSBT gracefully', () => {
      const validPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const validation = validatePayjoinProposal(
        validPsbt.toBase64(),
        'invalid-base64-psbt',
        [0],
        TESTNET,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should handle empty sender input indices', () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const proposalPsbt = clonePsbt(originalPsbt);

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        proposalPsbt.toBase64(),
        [],
        TESTNET,
      );

      expect(validation.valid).toBe(true);
    });
  });
};
