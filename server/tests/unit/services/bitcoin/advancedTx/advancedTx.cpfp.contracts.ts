import { describe, expect, it, beforeEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { mockElectrumClient } from '../../../../mocks/electrum';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';
import {
  calculateCPFPFee,
  createCPFPTransaction,
} from '../../../../../src/services/bitcoin/advancedTx';
import {
  rawTransactionWithOutput,
  resolveNextPsbtBindingNetwork,
} from './advancedTxTestHarness';

export function registerCpfpContracts() {
  describe('CPFP Fee Calculation', () => {
    it('should calculate correct child fee for target package rate', () => {
      const parentTxSize = 200; // vBytes
      const parentFeeRate = 5; // sat/vB
      const childTxSize = 140; // vBytes (1 in, 1 out native segwit)
      const targetFeeRate = 20; // sat/vB

      const result = calculateCPFPFee(
        parentTxSize,
        parentFeeRate,
        childTxSize,
        targetFeeRate
      );

      // Parent fee = 200 * 5 = 1000 sats
      // Total needed = (200 + 140) * 20 = 6800 sats
      // Child fee = 6800 - 1000 = 5800 sats
      expect(result.childFee).toBe(5800);
      expect(result.totalFee).toBe(6800);
      expect(result.totalSize).toBe(340);
      expect(result.effectiveFeeRate).toBe(20);
    });

    it('should calculate correct child fee rate', () => {
      const parentTxSize = 150;
      const parentFeeRate = 2;
      const childTxSize = 100;
      const targetFeeRate = 10;

      const result = calculateCPFPFee(
        parentTxSize,
        parentFeeRate,
        childTxSize,
        targetFeeRate
      );

      // Child fee rate should be higher than target to bring package average up
      expect(result.childFeeRate).toBeGreaterThan(targetFeeRate);
    });
  });

  describe('CPFP Transaction Creation', () => {
    // Use valid hex txid (not 'p' which is invalid hex)
    const parentTxid = 'c'.repeat(64);
    const parentVout = 0;
    const walletId = 'test-wallet-id';
    const recipientAddress = testnetAddresses.nativeSegwit[0];
    const segwitScript = '0014' + 'a'.repeat(40);
    const cpfpChain = (parentScript = segwitScript) => {
      const funding = rawTransactionWithOutput('0014cc', 50_100).response;
      const parent = new bitcoin.Transaction();
      parent.version = 2;
      parent.addInput(Buffer.from(funding.txid, 'hex').reverse(), 0);
      parent.addOutput(Buffer.from(parentScript, 'hex'), 50_000n);
      return {
        funding,
        parent: {
          txid: parent.getId(),
          hex: parent.toHex(),
          vin: [],
          vout: [{
            value: 0.0005,
            n: 0,
            scriptPubKey: { hex: parentScript },
          }],
        },
      };
    };

    beforeEach(() => {
      // Mock parent UTXO
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        ...sampleUtxos[0],
        txid: parentTxid,
        vout: parentVout,
        walletId,
        spent: false,
      });
      mockElectrumClient.getTransaction.mockResolvedValue(cpfpChain().parent);
    });

    it('should throw error if UTXO not found', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 30, recipientAddress, walletId, 'testnet3')
      ).rejects.toThrow('UTXO not found');
    });

    it('should throw error if UTXO already spent', async () => {
      // Mock UTXO that is already spent
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: true, // Already spent!
      });

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 30, recipientAddress, walletId, 'testnet3')
      ).rejects.toThrow('already spent');
    });

    it('fails closed when the CPFP wallet identity is unavailable', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);

      await expect(createCPFPTransaction(
        parentTxid,
        parentVout,
        5,
        recipientAddress,
        walletId,
        'testnet3',
      )).rejects.toThrow('Wallet script identity is unavailable');
    });

    it('should throw error if UTXO value insufficient for fee', async () => {
      // UTXO with very small value
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(100), // Only 100 sats
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const chain = cpfpChain();
      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(chain.parent)
        .mockResolvedValueOnce(chain.funding);

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 100, recipientAddress, walletId, 'testnet3')
      ).rejects.toThrow('insufficient');
    });

    it('should create CPFP PSBT for a spendable parent output', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const chain = cpfpChain();
      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(chain.parent)
        .mockResolvedValueOnce(chain.funding);

      const result = await createCPFPTransaction(
        parentTxid,
        parentVout,
        5,
        recipientAddress,
        walletId,
        'testnet3'
      );

      expect(result.psbt).toBeDefined();
      expect(result.childFee).toBeGreaterThan(0);
      expect(result.effectiveFeeRate).toBeGreaterThanOrEqual(5);
      expect(result.psbt.data.inputs[0].witnessUtxo).toEqual({
        script: Buffer.from(segwitScript, 'hex'),
        value: 50_000n,
      });
      expect(result.psbt.data.inputs[0].nonWitnessUtxo).toBeUndefined();
    });

    it('authenticates a legacy CPFP input with the complete parent transaction', async () => {
      const legacyScript = Buffer.from(bitcoin.address.toOutputScript(
        testnetAddresses.legacy[0],
        bitcoin.networks.testnet,
      )).toString('hex');
      const chain = cpfpChain(legacyScript);
      mockPrismaClient.uTXO.findUnique.mockResolvedValueOnce({
        txid: chain.parent.txid,
        vout: 0,
        amount: 50_000n,
        scriptPubKey: legacyScript,
        walletId,
        spent: false,
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        type: 'single_sig',
        network: 'testnet3',
        scriptType: 'legacy',
      });
      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(chain.parent)
        .mockResolvedValueOnce(chain.funding);

      const result = await createCPFPTransaction(
        chain.parent.txid,
        0,
        5,
        testnetAddresses.legacy[1],
        walletId,
        'testnet3',
      );
      const input = result.psbt.data.inputs[0];

      expect(input.witnessUtxo).toBeUndefined();
      expect(input.nonWitnessUtxo).toEqual(Buffer.from(chain.parent.hex, 'hex'));
      expect(bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo!).getId()).toBe(chain.parent.txid);
    });

    it('rejects a CPFP PSBT when account binding reports another network', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });
      const chain = cpfpChain();
      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(chain.parent)
        .mockResolvedValueOnce(chain.funding);
      resolveNextPsbtBindingNetwork('mainnet');

      await expect(createCPFPTransaction(
        parentTxid,
        parentVout,
        5,
        recipientAddress,
        walletId,
        'testnet3',
      )).rejects.toThrow('CPFP network does not match wallet');
    });

    it('should throw when resulting child output would be dust', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValueOnce({
        key: 'dustThreshold',
        value: '1000000000',
      });
      mockPrismaClient.uTXO.findUnique.mockResolvedValueOnce({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const chain = cpfpChain();
      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(chain.parent)
        .mockResolvedValueOnce(chain.funding);

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 5, recipientAddress, walletId, 'testnet3')
      ).rejects.toThrow('Output would be dust');
    });
  });
}
