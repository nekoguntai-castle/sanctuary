/**
 * UTXO Selection Tests
 *
 * Tests for UTXO selection strategies and spendable UTXO retrieval.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

// Mock Prisma before importing the module under test
vi.mock('../../../../src/models/prisma', () => ({
  default: mockPrismaClient,
}));

import {
  selectUTXOs,
  getSpendableUTXOs,
  UTXOSelectionStrategy,
} from '../../../../src/services/bitcoin/utxoSelection';

type MockUtxo = {
  id: string;
  txid: string;
  vout: number;
  amount: bigint;
  address: string;
  scriptPubKey: string | null;
  confirmations: number;
  spent: boolean;
  frozen: boolean;
  walletId: string;
  draftLock: unknown;
};

const DEFAULT_MOCK_UTXO: MockUtxo = {
  id: 'utxo-1',
  txid: 'aaaa'.repeat(16),
  vout: 0,
  amount: BigInt(100000),
  address: 'tb1qtest',
  scriptPubKey: '0014abcdef',
  confirmations: 6,
  spent: false,
  frozen: false,
  walletId: 'wallet-1',
  draftLock: null,
};

function nonNullishOverrides<T extends object>(overrides: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value != null)
  ) as Partial<T>;
}

// Helper to create mock UTXO records as Prisma would return them
function createMockUtxo(overrides: Partial<MockUtxo> = {}): MockUtxo {
  return {
    ...DEFAULT_MOCK_UTXO,
    ...nonNullishOverrides(overrides),
  };
}

describe('UTXO Selection', () => {
  beforeEach(() => {
    resetPrismaMocks();
    // Default: no confirmation threshold override
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);
  });

  // ========================================
  // selectUTXOs - LARGEST_FIRST
  // ========================================
  describe('selectUTXOs - LARGEST_FIRST', () => {
    it('should select the largest UTXO first when it covers the target', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(200000) }),
        createMockUtxo({ id: 'u2', amount: BigInt(50000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUTXOs('wallet-1', 50000, 5, UTXOSelectionStrategy.LARGEST_FIRST);

      expect(result.utxos).toHaveLength(1);
      expect(result.utxos[0].id).toBe('u1');
      expect(result.totalAmount).toBe(200000);
      expect(result.estimatedFee).toBeGreaterThan(0);
      expect(result.changeAmount).toBe(result.totalAmount - 50000 - result.estimatedFee);
    });

    it('should accumulate UTXOs until target + fee is covered', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(30000) }),
        createMockUtxo({ id: 'u2', amount: BigInt(20000) }),
        createMockUtxo({ id: 'u3', amount: BigInt(10000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUTXOs('wallet-1', 40000, 1, UTXOSelectionStrategy.LARGEST_FIRST);

      // 30000 + 20000 = 50000 should be enough for 40000 + low fee
      expect(result.utxos.length).toBeGreaterThanOrEqual(2);
      expect(result.totalAmount).toBeGreaterThanOrEqual(40000 + result.estimatedFee);
    });

    it('should throw when funds are insufficient', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(1000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      await expect(
        selectUTXOs('wallet-1', 100000, 5, UTXOSelectionStrategy.LARGEST_FIRST)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw when no spendable UTXOs available', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await expect(
        selectUTXOs('wallet-1', 10000, 5, UTXOSelectionStrategy.LARGEST_FIRST)
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('should calculate change amount correctly', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(500000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUTXOs('wallet-1', 100000, 10, UTXOSelectionStrategy.LARGEST_FIRST);

      expect(result.changeAmount).toBe(500000 - 100000 - result.estimatedFee);
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it('should map null scriptPubKey to empty string for auto-selected UTXOs', async () => {
      const utxos = [
        {
          id: 'u-auto-null-script',
          txid: 'eeee'.repeat(16),
          vout: 0,
          amount: BigInt(300000),
          address: 'tb1qautonullscript',
          scriptPubKey: null,
          confirmations: 6,
          spent: false,
          frozen: false,
          walletId: 'wallet-1',
          draftLock: null,
        },
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUTXOs('wallet-1', 10000, 1, UTXOSelectionStrategy.LARGEST_FIRST);

      expect(result.utxos).toHaveLength(1);
      expect(result.utxos[0].scriptPubKey).toBe('');
    });
  });

  // ========================================
  // selectUTXOs - SMALLEST_FIRST
  // ========================================
  describe('selectUTXOs - SMALLEST_FIRST', () => {
    it('should accumulate from smallest UTXOs first', async () => {
      const utxos = [
        createMockUtxo({ id: 'small', amount: BigInt(10000) }),
        createMockUtxo({ id: 'medium', amount: BigInt(50000) }),
        createMockUtxo({ id: 'large', amount: BigInt(200000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUTXOs('wallet-1', 50000, 1, UTXOSelectionStrategy.SMALLEST_FIRST);

      // Should take small + medium first, or enough to cover
      expect(result.utxos.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================
  // selectUTXOs - Manual UTXO selection
  // ========================================
  describe('selectUTXOs - user-selected UTXOs', () => {
    it('should use ALL specified UTXOs when selectedUtxoIds provided', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', txid: 'aaa1'.repeat(16), vout: 0, amount: BigInt(100000) }),
        createMockUtxo({ id: 'u2', txid: 'bbb2'.repeat(16), vout: 1, amount: BigInt(200000) }),
        createMockUtxo({ id: 'u3', txid: 'ccc3'.repeat(16), vout: 0, amount: BigInt(50000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const selectedIds = [`${'aaa1'.repeat(16)}:0`, `${'ccc3'.repeat(16)}:0`];
      const result = await selectUTXOs(
        'wallet-1',
        30000,
        5,
        UTXOSelectionStrategy.LARGEST_FIRST,
        selectedIds
      );

      // Should include exactly the 2 selected UTXOs
      expect(result.utxos).toHaveLength(2);
      expect(result.totalAmount).toBe(150000); // 100000 + 50000
    });

    it('should throw when selected UTXOs have insufficient funds', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', txid: 'aaa1'.repeat(16), vout: 0, amount: BigInt(1000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      await expect(
        selectUTXOs(
          'wallet-1',
          100000,
          5,
          UTXOSelectionStrategy.LARGEST_FIRST,
          [`${'aaa1'.repeat(16)}:0`]
        )
      ).rejects.toThrow('Insufficient funds');
    });

    it('should map null scriptPubKey to empty string for selected UTXOs', async () => {
      const txid = 'ddd4'.repeat(16);
      const utxos = [
        {
          id: 'u-null-script',
          txid,
          vout: 0,
          amount: BigInt(200000),
          address: 'tb1qnullscript',
          scriptPubKey: null,
          confirmations: 6,
          spent: false,
          frozen: false,
          walletId: 'wallet-1',
          draftLock: null,
        },
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUTXOs(
        'wallet-1',
        10000,
        1,
        UTXOSelectionStrategy.LARGEST_FIRST,
        [`${txid}:0`]
      );

      expect(result.utxos).toHaveLength(1);
      expect(result.utxos[0].scriptPubKey).toBe('');
    });
  });

  // ========================================
  // selectUTXOs - confirmation threshold
  // ========================================
  describe('selectUTXOs - confirmation threshold', () => {
    it('should use custom confirmation threshold from system settings', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'confirmationThreshold',
        value: '3',
      });

      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      await selectUTXOs('wallet-1', 10000, 5);

      // Verify findMany was called (it uses the threshold internally via Prisma where clause)
      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confirmations: expect.objectContaining({ gte: 3 }),
          }),
        })
      );
    });

    it('should use default threshold when no setting exists', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      await selectUTXOs('wallet-1', 10000, 5);

      // Default threshold is 1
      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confirmations: expect.objectContaining({ gte: 1 }),
          }),
        })
      );
    });
  });

  // ========================================
  // selectUTXOs - fee calculation
  // ========================================
  describe('selectUTXOs - fee calculation', () => {
    it('should estimate higher fees for more inputs', async () => {
      // Scenario with 1 large UTXO
      const singleUtxo = [
        createMockUtxo({ id: 'u1', amount: BigInt(500000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(singleUtxo);
      const result1 = await selectUTXOs('wallet-1', 100000, 10);

      // Scenario with many small UTXOs
      const manyUtxos = Array.from({ length: 5 }, (_, i) =>
        createMockUtxo({ id: `u${i}`, amount: BigInt(30000) })
      );
      mockPrismaClient.uTXO.findMany.mockResolvedValue(manyUtxos);
      const result2 = await selectUTXOs('wallet-1', 100000, 10);

      // More inputs = higher fee
      expect(result2.estimatedFee).toBeGreaterThan(result1.estimatedFee);
    });

    it('should scale fee with fee rate', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(500000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const lowFee = await selectUTXOs('wallet-1', 100000, 1);
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      const highFee = await selectUTXOs('wallet-1', 100000, 50);

      expect(highFee.estimatedFee).toBeGreaterThan(lowFee.estimatedFee);
    });
  });

  // ========================================
  // getSpendableUTXOs
  // ========================================
  describe('getSpendableUTXOs', () => {
    it('should return all spendable UTXOs for a wallet', async () => {
      const utxos = [
        createMockUtxo({ id: 'u1', amount: BigInt(100000) }),
        createMockUtxo({ id: 'u2', amount: BigInt(200000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await getSpendableUTXOs('wallet-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        id: 'u1',
        amount: BigInt(100000),
      }));
    });

    it('should filter by selected UTXO IDs', async () => {
      const txid1 = 'aaa1'.repeat(16);
      const utxos = [
        createMockUtxo({ id: 'u1', txid: txid1, vout: 0, amount: BigInt(100000) }),
        createMockUtxo({ id: 'u2', txid: 'bbb2'.repeat(16), vout: 1, amount: BigInt(200000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await getSpendableUTXOs('wallet-1', [`${txid1}:0`]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('u1');
    });

    it('should return empty array when no UTXOs match', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await getSpendableUTXOs('wallet-1');
      expect(result).toEqual([]);
    });

    it('should map scriptPubKey to empty string when null', async () => {
      // Directly provide a record with null scriptPubKey (bypassing the helper)
      const utxo = {
        id: 'u1',
        txid: 'aaaa'.repeat(16),
        vout: 0,
        amount: BigInt(100000),
        address: 'tb1qtest',
        scriptPubKey: null,
        confirmations: 6,
        spent: false,
        frozen: false,
        walletId: 'wallet-1',
        draftLock: null,
      };
      mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

      const result = await getSpendableUTXOs('wallet-1');
      expect(result[0].scriptPubKey).toBe('');
    });
  });
});
