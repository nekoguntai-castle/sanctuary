import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../mocks/prisma';

import { mockElectrumClient, createMockTransaction } from '../../../../mocks/electrum';
import { testnetAddresses, sampleTransactions } from '../../../../fixtures/bitcoin';
import { fundingTransaction, serveNodeTransactions } from './advancedTxTestHarness';
import { getNodeClient } from '../../../../../src/services/bitcoin/nodeClient';
import {
  canReplaceTransaction,
  isRBFSignaled,
} from '../../../../../src/services/bitcoin/advancedTx';

/** An RBF-signalling original that spends a real funding transaction, served under both real txids. */
function serveReplaceableOriginal(payTo: string): string {
  const funding = fundingTransaction('0014' + 'a'.repeat(40));
  const original = new bitcoin.Transaction();
  original.version = 2;
  original.addInput(funding.getHash(), 0, 0xfffffffd);
  original.addOutput(bitcoin.address.toOutputScript(payTo, bitcoin.networks.testnet), 50_000n);
  serveNodeTransactions(original, funding);
  return original.getId();
}

export function registerRbfDetectionContracts() {
  describe('RBF Detection', () => {
    describe('isRBFSignaled', () => {
      it('should return true for transaction with RBF sequence', () => {
        // Use the sample RBF-enabled transaction from fixtures
        expect(isRBFSignaled(sampleTransactions.rbfEnabled)).toBe(true);
      });

      it('should return false for transaction with final sequence', () => {
        // Use a non-RBF transaction from fixtures
        expect(isRBFSignaled(sampleTransactions.simpleP2pkh)).toBe(false);
      });

      it('should return false for invalid transaction hex', () => {
        expect(isRBFSignaled('invalid-hex')).toBe(false);
        expect(isRBFSignaled('')).toBe(false);
      });
    });

    describe('canReplaceTransaction', () => {
      const txid = 'a'.repeat(64);

      it('should return replaceable for unconfirmed RBF transaction', async () => {
        // Unconfirmed RBF original and its prevout, both authentic for their txids
        const originalTxid = serveReplaceableOriginal(testnetAddresses.nativeSegwit[1]);

        const result = await canReplaceTransaction(originalTxid, 'testnet4');

        expect(getNodeClient).toHaveBeenCalledWith('testnet4');
        expect(result.replaceable).toBe(true);
        expect(result.currentFeeRate).toBeDefined();
        expect(result.minNewFeeRate).toBeDefined();
        expect(result.minNewFeeRate).toBeGreaterThan(result.currentFeeRate!);
      });

      // Electrum's decoded transaction carries no `confirmations` field.
      const electrumShapedTx = (outputAddresses: string[]) => {
        const tx = new bitcoin.Transaction();
        tx.version = 2;
        tx.addInput(Buffer.alloc(32, 1), 0, 0xfffffffd);
        outputAddresses.forEach(address => tx.addOutput(
          bitcoin.address.toOutputScript(address, bitcoin.networks.testnet), 40_000n,
        ));
        return {
          txid,
          hex: tx.toHex(),
          vin: [],
          vout: [{ value: 0.001, scriptPubKey: { hex: '0014' + 'a'.repeat(40) } }],
        };
      };
      const [walletAddress, payeeAddress] = testnetAddresses.nativeSegwit;
      const mockOwned = (...owned: string[]) => mockPrismaClient.address.findFirst.mockImplementation(
        (query: any) => Promise.resolve(owned.includes(query?.where?.address) ? { address: query.where.address } : null),
      );

      it('should return not replaceable when address history shows the original confirmed', async () => {
        mockElectrumClient.getTransaction.mockResolvedValue(electrumShapedTx([payeeAddress]));
        mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 850000 }]);

        const result = await canReplaceTransaction(txid, 'testnet4', 'wallet-1');

        expect(result.replaceable).toBe(false);
        expect(result.reason).toBe('Transaction is already confirmed');
        expect(result.upstreamError).toBeUndefined();
      });

      it('should return not replaceable when the DB row has confirmations', async () => {
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ txid, confirmations: 3, blockHeight: null });
        mockElectrumClient.getTransaction.mockResolvedValue(electrumShapedTx([payeeAddress]));
        mockElectrumClient.getAddressHistory.mockResolvedValue([]);

        const result = await canReplaceTransaction(txid, 'testnet4', 'wallet-1');

        expect(result).toEqual({ replaceable: false, reason: 'Transaction is already confirmed' });
        expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalledWith({
          where: { txid_walletId: { txid, walletId: 'wallet-1' } },
        });
      });

      it('should skip the address-history lookup when the DB row has a block height', async () => {
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ txid, confirmations: 0, blockHeight: 850000 });
        mockElectrumClient.getTransaction.mockResolvedValue(electrumShapedTx([payeeAddress]));

        const result = await canReplaceTransaction(txid, 'testnet4', 'wallet-1');

        expect(result.replaceable).toBe(false);
        expect(result.reason).toBe('Transaction is already confirmed');
        expect(mockElectrumClient.getAddressHistory).not.toHaveBeenCalled();
      });

      it('should stay replaceable when history only lists the original as mempool (height 0)', async () => {
        const originalTxid = serveReplaceableOriginal(payeeAddress);
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ txid: originalTxid, confirmations: 0, blockHeight: null });
        mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: originalTxid, height: 0 }]);

        const result = await canReplaceTransaction(originalTxid, 'testnet4', 'wallet-1');

        expect(result.replaceable).toBe(true);
      });

      it('should fail closed when the address-history lookup errors', async () => {
        mockElectrumClient.getTransaction.mockResolvedValue(electrumShapedTx([payeeAddress]));
        mockElectrumClient.getAddressHistory.mockRejectedValue(new Error('history too large'));

        const result = await canReplaceTransaction(txid, 'testnet4', 'wallet-1');

        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('history too large');
        expect(result.upstreamError).toBe(true);
      });

      it('should query history through a wallet-owned output rather than the payee', async () => {
        mockOwned(walletAddress);
        mockElectrumClient.getTransaction.mockResolvedValue(electrumShapedTx([payeeAddress, walletAddress]));
        mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 850000 }]);

        const result = await canReplaceTransaction(txid, 'testnet4', 'wallet-1');

        expect(result.replaceable).toBe(false);
        expect(mockElectrumClient.getAddressHistory).toHaveBeenCalledTimes(1);
        expect(mockElectrumClient.getAddressHistory).toHaveBeenCalledWith(walletAddress);
      });

      it('should fall back to the first decodable output when none is wallet-owned', async () => {
        mockOwned();
        const withOpReturn = new bitcoin.Transaction();
        withOpReturn.version = 2;
        withOpReturn.addInput(Buffer.alloc(32, 1), 0, 0xfffffffd);
        withOpReturn.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from('hi')]), 0n);
        withOpReturn.addOutput(bitcoin.address.toOutputScript(payeeAddress, bitcoin.networks.testnet), 40_000n);
        mockElectrumClient.getTransaction.mockResolvedValue({ txid, hex: withOpReturn.toHex(), vin: [], vout: [] });

        await canReplaceTransaction(txid, 'testnet4', 'wallet-1');

        expect(mockElectrumClient.getAddressHistory).toHaveBeenCalledWith(payeeAddress);
      });

      it('should return not replaceable for confirmed transaction', async () => {
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ txid, confirmations: 1, blockHeight: 1 });
        mockElectrumClient.getTransaction.mockResolvedValue(electrumShapedTx([payeeAddress]));

        const result = await canReplaceTransaction(txid, 'testnet4', 'wallet-1');

        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('confirmed');
      });

      it('should return not replaceable for non-RBF transaction', async () => {
        const mockTx = createMockTransaction({ txid, confirmations: 0 });
        // Use non-RBF transaction from fixtures
        mockTx.hex = sampleTransactions.simpleP2pkh;

        mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

        const result = await canReplaceTransaction(txid);

        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('RBF');
      });

      it('should return not replaceable when tx hex is unavailable', async () => {
        mockElectrumClient.getTransaction.mockResolvedValue({
          txid,
          confirmations: 0,
          hex: '',
          vin: [],
          vout: [],
        });

        const result = await canReplaceTransaction(txid);

        expect(result).toEqual({
          replaceable: false,
          reason: 'Transaction data not available from server',
          upstreamError: true,
        });
      });

      it('should handle client errors gracefully', async () => {
        mockElectrumClient.getTransaction.mockRejectedValue(new Error('node unavailable'));

        const result = await canReplaceTransaction(txid);
        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('node unavailable');
        // Regression for advancedtx-rbf-cpfp-plain-error-still-surfaces-as-500:
        // an upstream/node failure must stay distinguishable from a
        // business-rule not-replaceable result so callers keep it a 5xx.
        expect(result.upstreamError).toBe(true);
      });

      it('should handle malformed transaction hex in non-RBF debug logging path', async () => {
        mockElectrumClient.getTransaction.mockResolvedValue({
          txid,
          confirmations: 0,
          hex: 'zzzz',
          vin: [],
          vout: [],
        });

        const result = await canReplaceTransaction(txid);
        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('RBF');
      });
    });
  });
}
