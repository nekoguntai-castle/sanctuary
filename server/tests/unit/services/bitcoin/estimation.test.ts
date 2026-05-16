/**
 * Transaction Estimation Tests
 *
 * Tests for fee estimation and dust threshold lookup.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

// Mock Prisma before importing the module under test
vi.mock('../../../../src/models/prisma', () => ({
  default: mockPrismaClient,
}));

// Mock utxoSelection since estimateTransaction depends on it
vi.mock('../../../../src/services/bitcoin/utxoSelection', () => ({
  selectUTXOs: vi.fn(),
  UTXOSelectionStrategy: {
    LARGEST_FIRST: 'largest_first',
    SMALLEST_FIRST: 'smallest_first',
  },
}));

import { getDustThreshold, estimateTransaction } from '../../../../src/services/bitcoin/estimation';
import { selectUTXOs } from '../../../../src/services/bitcoin/utxoSelection';
import { DEFAULT_DUST_THRESHOLD } from '../../../../src/constants';

describe('Transaction Estimation', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.mocked(selectUTXOs).mockReset();
  });

  // ========================================
  // getDustThreshold
  // ========================================
  describe('getDustThreshold', () => {
    it('should return the default dust threshold when no setting exists', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const threshold = await getDustThreshold();
      expect(threshold).toBe(DEFAULT_DUST_THRESHOLD);
      expect(threshold).toBe(546);
    });

    it('should return custom dust threshold from system settings', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'dustThreshold',
        value: '1000',
      });

      const threshold = await getDustThreshold();
      expect(threshold).toBe(1000);
    });

    it('should fall back to default for invalid setting value', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'dustThreshold',
        value: 'not-a-number',
      });

      const threshold = await getDustThreshold();
      expect(threshold).toBe(DEFAULT_DUST_THRESHOLD);
    });

    it('should query the correct system setting key', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      await getDustThreshold();

      expect(mockPrismaClient.systemSetting.findUnique).toHaveBeenCalledWith({
        where: { key: 'dustThreshold' },
      });
    });
  });

  // ========================================
  // estimateTransaction
  // ========================================
  describe('estimateTransaction', () => {
    it('should return successful estimate when funds are sufficient', async () => {
      // Mock dust threshold
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      // Mock selectUTXOs to return a successful selection
      vi.mocked(selectUTXOs).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(500000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 500000,
        estimatedFee: 1130,
        changeAmount: 398870,
      });

      const result = await estimateTransaction('wallet-1', 'tb1qrecipient', 100000, 10);

      expect(result.sufficient).toBe(true);
      expect(result.fee).toBe(1130);
      expect(result.totalCost).toBe(100000 + 1130);
      expect(result.inputCount).toBe(1);
      expect(result.changeAmount).toBe(398870);
    });

    it('should return 2 outputs when change exceeds dust threshold', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOs).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(200000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 200000,
        estimatedFee: 565,
        changeAmount: 99435, // Well above dust threshold
      });

      const result = await estimateTransaction('wallet-1', 'tb1qrecipient', 100000, 5);

      expect(result.outputCount).toBe(2); // recipient + change
    });

    it('should return 1 output when change is below dust threshold', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOs).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(100600), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 100600,
        estimatedFee: 500,
        changeAmount: 100, // Below dust threshold (546)
      });

      const result = await estimateTransaction('wallet-1', 'tb1qrecipient', 100000, 5);

      expect(result.outputCount).toBe(1); // recipient only, change absorbed into fee
    });

    it('should return insufficient when selectUTXOs throws', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOs).mockRejectedValue(
        new Error('Insufficient funds. Need 150000 sats, have 100000 sats')
      );

      const result = await estimateTransaction('wallet-1', 'tb1qrecipient', 100000, 10);

      expect(result.sufficient).toBe(false);
      expect(result.fee).toBe(0);
      expect(result.inputCount).toBe(0);
      expect(result.error).toContain('Insufficient funds');
    });

    it('should return insufficient when no UTXOs are available', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOs).mockRejectedValue(
        new Error('No spendable UTXOs available')
      );

      const result = await estimateTransaction('wallet-1', 'tb1qrecipient', 50000, 5);

      expect(result.sufficient).toBe(false);
      expect(result.error).toContain('No spendable UTXOs');
    });

    it('should pass selected UTXO IDs to selectUTXOs', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOs).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(100000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 100000,
        estimatedFee: 500,
        changeAmount: 49500,
      });

      const selectedIds = ['txid1:0', 'txid2:1'];
      await estimateTransaction('wallet-1', 'tb1qrecipient', 50000, 5, selectedIds);

      expect(selectUTXOs).toHaveBeenCalledWith(
        'wallet-1',
        50000,
        5,
        'largest_first',
        selectedIds
      );
    });

    it('should handle multiple inputs in estimate', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOs).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(30000), scriptPubKey: '00', address: 'tb1q' },
          { id: 'u2', txid: 'bbb', vout: 0, amount: BigInt(30000), scriptPubKey: '00', address: 'tb1q' },
          { id: 'u3', txid: 'ccc', vout: 0, amount: BigInt(30000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 90000,
        estimatedFee: 2000,
        changeAmount: 38000,
      });

      const result = await estimateTransaction('wallet-1', 'tb1qrecipient', 50000, 20);

      expect(result.inputCount).toBe(3);
      expect(result.sufficient).toBe(true);
    });
  });
});
