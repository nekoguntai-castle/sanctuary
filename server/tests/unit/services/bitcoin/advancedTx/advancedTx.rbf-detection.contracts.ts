import { describe, expect, it } from 'vitest';

import { mockElectrumClient, createMockTransaction } from '../../../../mocks/electrum';
import { testnetAddresses, sampleTransactions } from '../../../../fixtures/bitcoin';
import './advancedTxTestHarness';
import {
  canReplaceTransaction,
  isRBFSignaled,
} from '../../../../../src/services/bitcoin/advancedTx';

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
        // Mock unconfirmed transaction with RBF
        const mockTx = createMockTransaction({
          txid,
          confirmations: 0,
          inputs: [{ txid: 'b'.repeat(64), vout: 0, value: 0.001, address: testnetAddresses.nativeSegwit[0] }],
          outputs: [{ value: 0.0005, address: testnetAddresses.nativeSegwit[1] }],
        });

        // Use the valid RBF transaction from fixtures
        mockTx.hex = sampleTransactions.rbfEnabled;

        mockElectrumClient.getTransaction.mockResolvedValueOnce(mockTx);
        mockElectrumClient.getTransaction.mockResolvedValueOnce({
          vout: [{ value: 0.001, scriptPubKey: { hex: '0014' + 'a'.repeat(40) } }],
        });

        const result = await canReplaceTransaction(txid);

        expect(result.replaceable).toBe(true);
        expect(result.currentFeeRate).toBeDefined();
        expect(result.minNewFeeRate).toBeDefined();
        expect(result.minNewFeeRate).toBeGreaterThan(result.currentFeeRate!);
      });

      it('should return not replaceable for confirmed transaction', async () => {
        const mockTx = createMockTransaction({
          txid,
          confirmations: 1,
        });
        mockTx.hex = sampleTransactions.rbfEnabled;
        mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

        const result = await canReplaceTransaction(txid);

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
        });
      });

      it('should handle client errors gracefully', async () => {
        mockElectrumClient.getTransaction.mockRejectedValue(new Error('node unavailable'));

        const result = await canReplaceTransaction(txid);
        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('node unavailable');
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
