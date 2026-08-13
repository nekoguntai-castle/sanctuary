/**
 * Transaction Estimation Tests
 *
 * Tests for fee estimation and dust threshold lookup.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleWallets, testnetAddresses } from '../../../fixtures/bitcoin';

// Mock Prisma before importing the module under test
vi.mock('../../../../src/models/prisma', () => ({
  default: mockPrismaClient,
}));

// Mock utxoSelection since estimateTransaction depends on it
vi.mock('../../../../src/services/bitcoin/utxoSelection', () => ({
  selectUTXOsExact: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/transactions/psbtConstruction', () => ({
  resolveWalletSigningInfo: vi.fn(() => ({ scriptType: 'native_segwit' })),
}));

vi.mock('../../../../src/services/bitcoin/transactions/feePolicy', () => ({
  createTransactionSpendPolicyResolver: vi.fn(() => vi.fn()),
  transactionChangeScriptTemplate: vi.fn(() => Buffer.from(`0014${'44'.repeat(20)}`, 'hex')),
}));

import { getDustThreshold, estimateTransaction } from '../../../../src/services/bitcoin/estimation';
import { selectUTXOsExact } from '../../../../src/services/bitcoin/utxoSelection';
import { DEFAULT_DUST_THRESHOLD } from '../../../../src/constants';

describe('Transaction Estimation', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.mocked(selectUTXOsExact).mockReset();
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      ...sampleWallets.singleSigNativeSegwit,
      network: 'testnet3',
      devices: [],
    });
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
    it('fails closed when the wallet no longer exists', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);

      const result = await estimateTransaction(
        'missing-wallet', testnetAddresses.nativeSegwit[0], 100_000, 10,
      );

      expect(result).toMatchObject({
        sufficient: false,
        fee: 0,
        inputCount: 0,
        error: 'Wallet not found',
      });
      expect(selectUTXOsExact).not.toHaveBeenCalled();
    });

    it('should return successful estimate when funds are sufficient', async () => {
      // Mock dust threshold
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOsExact).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(500000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 500000,
        estimatedFee: 1130,
        changeAmount: 398870,
      });

      const result = await estimateTransaction('wallet-1', testnetAddresses.nativeSegwit[0], 100000, 10);

      expect(result.sufficient).toBe(true);
      expect(result.fee).toBe(1130);
      expect(result.totalCost).toBe(100000 + 1130);
      expect(result.inputCount).toBe(1);
      expect(result.changeAmount).toBe(398870);
    });

    it('should return 2 outputs when change exceeds dust threshold', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOsExact).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(200000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 200000,
        estimatedFee: 565,
        changeAmount: 99435, // Well above dust threshold
      });

      const result = await estimateTransaction('wallet-1', testnetAddresses.nativeSegwit[0], 100000, 5);

      expect(result.outputCount).toBe(2); // recipient + change
    });

    it('should return 1 output when change is below dust threshold', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOsExact).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(100600), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 100600,
        estimatedFee: 500,
        changeAmount: 100, // Below dust threshold (546)
      });

      const result = await estimateTransaction('wallet-1', testnetAddresses.nativeSegwit[0], 100000, 5);

      expect(result.outputCount).toBe(1); // recipient only, change absorbed into fee
    });

    it('should return insufficient when selectUTXOs throws', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOsExact).mockRejectedValue(
        new Error('Insufficient funds. Need 150000 sats, have 100000 sats')
      );

      const result = await estimateTransaction('wallet-1', testnetAddresses.nativeSegwit[0], 100000, 10);

      expect(result.sufficient).toBe(false);
      expect(result.fee).toBe(0);
      expect(result.inputCount).toBe(0);
      expect(result.error).toContain('Insufficient funds');
    });

    it('should return insufficient when no UTXOs are available', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOsExact).mockRejectedValue(
        new Error('No spendable UTXOs available')
      );

      const result = await estimateTransaction('wallet-1', testnetAddresses.nativeSegwit[0], 50000, 5);

      expect(result.sufficient).toBe(false);
      expect(result.error).toContain('No spendable UTXOs');
    });

    it('should pass selected UTXO IDs to selectUTXOs', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOsExact).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(100000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 100000,
        estimatedFee: 500,
        changeAmount: 49500,
      });

      const selectedIds = ['txid1:0', 'txid2:1'];
      await estimateTransaction('wallet-1', testnetAddresses.nativeSegwit[0], 50000, 5, selectedIds);

      expect(selectUTXOsExact).toHaveBeenCalledWith(
        'wallet-1',
        50000,
        5,
        expect.objectContaining({
          recipientScript: expect.any(Uint8Array),
          changeScripts: [expect.any(Uint8Array)],
          dustThreshold: 546,
          resolveSpendPolicies: expect.any(Function),
        }),
        selectedIds
      );
    });

    it('should handle multiple inputs in estimate', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      vi.mocked(selectUTXOsExact).mockResolvedValue({
        utxos: [
          { id: 'u1', txid: 'aaa', vout: 0, amount: BigInt(30000), scriptPubKey: '00', address: 'tb1q' },
          { id: 'u2', txid: 'bbb', vout: 0, amount: BigInt(30000), scriptPubKey: '00', address: 'tb1q' },
          { id: 'u3', txid: 'ccc', vout: 0, amount: BigInt(30000), scriptPubKey: '00', address: 'tb1q' },
        ],
        totalAmount: 90000,
        estimatedFee: 2000,
        changeAmount: 38000,
      });

      const result = await estimateTransaction('wallet-1', testnetAddresses.nativeSegwit[0], 50000, 20);

      expect(result.inputCount).toBe(3);
      expect(result.sufficient).toBe(true);
    });
  });
});
