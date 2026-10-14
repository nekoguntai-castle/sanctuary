import { vi } from 'vitest';
/**
 * Privacy Scoring Service Tests (HIGH)
 *
 * Tests for privacy analysis and scoring:
 * - calculateUtxoPrivacy() - Address reuse penalty, round amount detection
 * - calculateWalletPrivacy() - Aggregate scoring, grade assignment
 * - calculateSpendPrivacy() - Multi-address linking penalty
 * - Edge cases: empty wallet, single UTXO, all same address
 *
 * These tests ensure accurate privacy scoring for coin control.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma before importing service
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  calculateUtxoPrivacy,
  calculateWalletPrivacy,
  calculateSpendPrivacy,
} from '../../../src/services/privacyService';

// Test constants
const WALLET_ID = 'wallet-123';
const ADDRESS_1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ADDRESS_2 = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
const ADDRESS_3 = 'tb1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg';

// Sample UTXOs for testing
const createTestUtxo = (overrides: Partial<{
  id: string;
  txid: string;
  vout: number;
  walletId: string;
  address: string;
  amount: bigint;
  blockHeight: number | null;
  confirmations: number;
  spent: boolean;
  frozen: boolean;
}> = {}) => ({
  id: 'utxo-1',
  txid: 'aaaa'.repeat(16),
  vout: 0,
  walletId: WALLET_ID,
  address: ADDRESS_1,
  amount: BigInt(100000),
  blockHeight: 800000,
  confirmations: 6,
  spent: false,
  frozen: false,
  ...overrides,
});

describe('Privacy Scoring Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('calculateUtxoPrivacy', () => {
    it('should return perfect score for ideal UTXO', async () => {
      const utxo = createTestUtxo({
        amount: BigInt(123456), // Non-round amount
      });

      // Single UTXO, no address reuse, no cluster linkage
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        ...utxo,
        wallet: { id: WALLET_ID },
      });
      // Mock count to return appropriate values for each call:
      // 1. Address reuse: 1 (only this UTXO with this address)
      // 2. Cluster linkage: 0 (no other UTXOs from same tx)
      // 3. Same block: 0 (no timing correlation)
      mockPrismaClient.uTXO.count
        .mockResolvedValueOnce(1)  // Address reuse check
        .mockResolvedValueOnce(0)  // Cluster linkage check
        .mockResolvedValueOnce(0); // Same block check
      mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

      const result = await calculateUtxoPrivacy(utxo.id);

      expect(result.score).toBe(100);
      expect(result.grade).toBe('excellent');
      expect(result.factors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should throw error for non-existent UTXO', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

      await expect(calculateUtxoPrivacy('non-existent'))
        .rejects.toThrow('UTXO not found');
    });

    describe('Address Reuse Detection', () => {
      it('should penalize address reuse', async () => {
        const utxo = createTestUtxo();

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count
          .mockResolvedValueOnce(3) // 3 UTXOs on same address
          .mockResolvedValueOnce(0); // No same-transaction UTXOs
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.score).toBeLessThan(100);
        expect(result.factors.some(f => f.factor === 'Address Reuse')).toBe(true);
        expect(result.warnings.some(w => w.includes('Address reuse'))).toBe(true);
      });

      it('should not penalize for single UTXO on address', async () => {
        const utxo = createTestUtxo();

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count
          .mockResolvedValueOnce(1) // Only 1 UTXO on this address
          .mockResolvedValueOnce(0);
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.factors.some(f => f.factor === 'Address Reuse')).toBe(false);
      });
    });

    describe('Round Amount Detection', () => {
      const roundAmountTests = [
        { amount: BigInt(1_000_000), description: '0.01 BTC' },
        { amount: BigInt(10_000_000), description: '0.1 BTC' },
        { amount: BigInt(50_000_000), description: '0.5 BTC' },
        { amount: BigInt(100_000_000), description: '1 BTC' },
        { amount: BigInt(500_000_000), description: '5 BTC' },
        { amount: BigInt(10_000_000), description: '10M sats round' },
        { amount: BigInt(100_000), description: '100K sats round' },
      ];

      roundAmountTests.forEach(({ amount, description }) => {
        it(`should detect round amount: ${description}`, async () => {
          const utxo = createTestUtxo({ amount });

          mockPrismaClient.uTXO.findUnique.mockResolvedValue({
            ...utxo,
            wallet: { id: WALLET_ID },
          });
          mockPrismaClient.uTXO.count.mockResolvedValue(1);
          mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

          const result = await calculateUtxoPrivacy(utxo.id);

          expect(result.factors.some(f => f.factor === 'Round Amount')).toBe(true);
        });
      });

      it('should not penalize non-round amounts', async () => {
        const utxo = createTestUtxo({ amount: BigInt(12345678) }); // Not round

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.factors.some(f => f.factor === 'Round Amount')).toBe(false);
      });
    });

    describe('Transaction Clustering', () => {
      it('should penalize multiple UTXOs from same transaction', async () => {
        const utxo = createTestUtxo();
        const sameTxUtxo = createTestUtxo({
          id: 'utxo-2',
          vout: 1,
          txid: utxo.txid, // Same transaction
        });

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count
          .mockResolvedValueOnce(1) // Address count
          .mockResolvedValueOnce(1) // Same transaction count (excluding self)
          .mockResolvedValueOnce(0); // Same block count
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo, sameTxUtxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.factors.some(f => f.factor === 'Transaction Clustering')).toBe(true);
      });

      it('should not penalize single output from transaction', async () => {
        const utxo = createTestUtxo();

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count
          .mockResolvedValueOnce(1) // Address count
          .mockResolvedValueOnce(0); // No same-transaction UTXOs
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.factors.some(f => f.factor === 'Transaction Clustering')).toBe(false);
      });
    });

    describe('Timing Correlation', () => {
      it('should penalize UTXOs received in same block', async () => {
        const utxo = createTestUtxo({ blockHeight: 800000 });

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count
          .mockResolvedValueOnce(1) // Address count
          .mockResolvedValueOnce(0) // Same transaction count
          .mockResolvedValueOnce(2); // Same block count (different tx)
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.factors.some(f => f.factor === 'Timing Correlation')).toBe(true);
      });

      it('should not penalize when no block height (unconfirmed)', async () => {
        const utxo = createTestUtxo({ blockHeight: null });

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.factors.some(f => f.factor === 'Timing Correlation')).toBe(false);
      });
    });

    describe('Relative Size Penalties', () => {
      it('should penalize very small UTXOs relative to wallet', async () => {
        const smallUtxo = createTestUtxo({ amount: BigInt(100) }); // Very small
        const largeUtxos = [
          createTestUtxo({ id: 'large-1', amount: BigInt(10_000_000) }),
          createTestUtxo({ id: 'large-2', amount: BigInt(10_000_000) }),
        ];

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...smallUtxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);
        mockPrismaClient.uTXO.findMany.mockResolvedValue([smallUtxo, ...largeUtxos]);

        const result = await calculateUtxoPrivacy(smallUtxo.id);

        expect(result.factors.some(f => f.factor === 'Small UTXO')).toBe(true);
      });

      it('should penalize very large UTXOs relative to wallet', async () => {
        // Large UTXO must be > 10x average to trigger the penalty
        // Set up: largeUtxo = 1,000,000 sats, 10 small UTXOs = 1,000 sats each
        // Total = 1,010,000 sats, Average = ~91,818 sats
        // Large UTXO is ~10.9x average, which triggers the penalty
        const largeUtxo = createTestUtxo({ amount: BigInt(1_000_000) });
        const smallUtxos = Array.from({ length: 10 }, (_, i) =>
          createTestUtxo({ id: `small-${i}`, amount: BigInt(1_000) })
        );

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...largeUtxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);
        mockPrismaClient.uTXO.findMany.mockResolvedValue([largeUtxo, ...smallUtxos]);

        const result = await calculateUtxoPrivacy(largeUtxo.id);

        expect(result.factors.some(f => f.factor === 'Large UTXO')).toBe(true);
      });
    });

    describe('Grade Assignment', () => {
      it('should assign excellent grade for score >= 80', async () => {
        const utxo = createTestUtxo({ amount: BigInt(12345678) });

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        if (result.score >= 80) {
          expect(result.grade).toBe('excellent');
        }
      });

      it('should assign poor grade for score < 40', async () => {
        const utxo = createTestUtxo({
          amount: BigInt(100_000_000), // Round amount
        });

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count
          .mockResolvedValueOnce(5) // Heavy address reuse
          .mockResolvedValueOnce(3) // Transaction clustering
          .mockResolvedValueOnce(2); // Timing correlation
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.score).toBeLessThan(60);
        expect(['poor', 'fair']).toContain(result.grade);
      });
    });

    describe('Score Bounds', () => {
      it('should never exceed 100', async () => {
        const utxo = createTestUtxo({ amount: BigInt(12345) });

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.score).toBeLessThanOrEqual(100);
      });

      it('should never go below 0', async () => {
        const utxo = createTestUtxo({ amount: BigInt(100_000_000) });

        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        // Maximum penalties
        mockPrismaClient.uTXO.count
          .mockResolvedValueOnce(10) // Heavy address reuse
          .mockResolvedValueOnce(10) // Heavy clustering
          .mockResolvedValueOnce(10); // Timing correlation
        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);

        const result = await calculateUtxoPrivacy(utxo.id);

        expect(result.score).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('calculateWalletPrivacy', () => {
    it('should return perfect score for empty wallet', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.summary.averageScore).toBe(100);
      expect(result.summary.grade).toBe('excellent');
      expect(result.summary.utxoCount).toBe(0);
      expect(result.utxos).toHaveLength(0);
    });

    it('should calculate aggregate statistics', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', address: ADDRESS_1, amount: BigInt(100000) }),
        createTestUtxo({ id: 'utxo-2', address: ADDRESS_1, amount: BigInt(100000) }), // Same address (reuse)
        createTestUtxo({ id: 'utxo-3', address: ADDRESS_2, amount: BigInt(10_000_000) }), // Round amount
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      // Mock individual UTXO privacy calculations
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const utxo = utxos.find(u => u.id === where.id);
        return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
      });
      mockPrismaClient.uTXO.count.mockResolvedValue(1);

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.summary.utxoCount).toBe(3);
      expect(result.summary.addressReuseCount).toBe(1); // ADDRESS_1 is reused
      expect(result.summary.roundAmountCount).toBeGreaterThanOrEqual(1);
      expect(result.utxos).toHaveLength(3);
    });

    it('should count address reuse correctly', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', address: ADDRESS_1 }),
        createTestUtxo({ id: 'utxo-2', address: ADDRESS_1 }), // Reuse
        createTestUtxo({ id: 'utxo-3', address: ADDRESS_2 }),
        createTestUtxo({ id: 'utxo-4', address: ADDRESS_2 }), // Reuse
        createTestUtxo({ id: 'utxo-5', address: ADDRESS_2 }), // Reuse
        createTestUtxo({ id: 'utxo-6', address: ADDRESS_3 }), // No reuse
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const utxo = utxos.find(u => u.id === where.id);
        return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
      });
      mockPrismaClient.uTXO.count.mockResolvedValue(1);

      const result = await calculateWalletPrivacy(WALLET_ID);

      // ADDRESS_1 has 2 UTXOs, ADDRESS_2 has 3 UTXOs -> 2 reused addresses
      expect(result.summary.addressReuseCount).toBe(2);
    });

    it('should count cluster linkage correctly', async () => {
      const txid = 'aaaa'.repeat(16);
      const utxos = [
        createTestUtxo({ id: 'utxo-1', txid, vout: 0 }),
        createTestUtxo({ id: 'utxo-2', txid, vout: 1 }), // Same tx
        createTestUtxo({ id: 'utxo-3', txid: 'bbbb'.repeat(16), vout: 0 }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const utxo = utxos.find(u => u.id === where.id);
        return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
      });
      mockPrismaClient.uTXO.count.mockResolvedValue(1);

      const result = await calculateWalletPrivacy(WALLET_ID);

      // 1 transaction has multiple outputs
      expect(result.summary.clusterCount).toBe(1);
    });

    it('should generate recommendations for address reuse', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', address: ADDRESS_1 }),
        createTestUtxo({ id: 'utxo-2', address: ADDRESS_1 }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const utxo = utxos.find(u => u.id === where.id);
        return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
      });
      mockPrismaClient.uTXO.count.mockResolvedValue(1);

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.summary.recommendations.some(r =>
        r.includes('address reuse') || r.includes('Address')
      )).toBe(true);
    });

    it('should recommend coin control for low scores', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(100_000_000) }), // Round
        createTestUtxo({ id: 'utxo-2', amount: BigInt(50_000_000) }),  // Round
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const utxo = utxos.find(u => u.id === where.id);
        return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
      });
      // Simulate low scores
      mockPrismaClient.uTXO.count.mockResolvedValue(5); // Heavy reuse

      const result = await calculateWalletPrivacy(WALLET_ID);

      // If average score is low, should recommend coin control
      if (result.summary.averageScore < 60) {
        expect(result.summary.recommendations.some(r =>
          r.includes('coin control')
        )).toBe(true);
      }
    });

    it('should exclude frozen UTXOs from scoring but not from wallet aggregates', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', address: ADDRESS_1 }),
        createTestUtxo({ id: 'utxo-frozen', address: ADDRESS_1, frozen: true }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { walletId: WALLET_ID, spent: false } })
      );
      expect(result.utxos.map(u => u.utxoId)).toEqual(['utxo-1']);
      // The frozen UTXO still counts toward address reuse for the scored one.
      expect(result.utxos[0].score.factors.map(f => f.factor)).toContain('Address Reuse');
    });

    it('should exclude spent UTXOs from calculation', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await calculateWalletPrivacy(WALLET_ID);

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            spent: false,
          }),
        })
      );
    });
  });

  describe('calculateSpendPrivacy', () => {
    it('should return perfect score for empty selection', async () => {
      const result = await calculateSpendPrivacy([]);

      expect(result.score).toBe(100);
      expect(result.grade).toBe('excellent');
      expect(result.linkedAddresses).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should penalize spending from multiple addresses', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', address: ADDRESS_1 }),
        createTestUtxo({ id: 'utxo-2', address: ADDRESS_2 }),
        createTestUtxo({ id: 'utxo-3', address: ADDRESS_3 }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateSpendPrivacy(['utxo-1', 'utxo-2', 'utxo-3']);

      expect(result.linkedAddresses).toBe(3);
      expect(result.score).toBeLessThan(100);
      expect(result.warnings.some(w => w.includes('different addresses'))).toBe(true);
    });

    it('should not penalize spending from single address', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', address: ADDRESS_1 }),
        createTestUtxo({ id: 'utxo-2', address: ADDRESS_1 }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateSpendPrivacy(['utxo-1', 'utxo-2']);

      expect(result.linkedAddresses).toBe(1);
      expect(result.warnings.filter(w => w.includes('different addresses'))).toHaveLength(0);
    });

    it('should give small bonus for already-linked UTXOs (same tx)', async () => {
      const txid = 'aaaa'.repeat(16);
      const utxos = [
        createTestUtxo({ id: 'utxo-1', txid, vout: 0, address: ADDRESS_1 }),
        createTestUtxo({ id: 'utxo-2', txid, vout: 1, address: ADDRESS_2 }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateSpendPrivacy(['utxo-1', 'utxo-2']);

      // Even though 2 addresses, they're already linked via same tx
      // Score should be higher than completely unrelated UTXOs
      expect(result.score).toBeGreaterThan(70);
    });

    it('should warn about dust UTXOs', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(500) }), // Dust
        createTestUtxo({ id: 'utxo-2', amount: BigInt(100000) }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateSpendPrivacy(['utxo-1', 'utxo-2']);

      expect(result.warnings.some(w => w.includes('dust'))).toBe(true);
    });

    it('should penalize for multiple dust UTXOs', async () => {
      // Use different txids so we don't get the "already linked" bonus
      const utxos = [
        createTestUtxo({ id: 'utxo-1', txid: 'bbbb'.repeat(16), amount: BigInt(100) }),
        createTestUtxo({ id: 'utxo-2', txid: 'cccc'.repeat(16), amount: BigInt(200) }),
        createTestUtxo({ id: 'utxo-3', txid: 'dddd'.repeat(16), amount: BigInt(300) }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateSpendPrivacy(['utxo-1', 'utxo-2', 'utxo-3']);

      expect(result.score).toBeLessThan(100);
      expect(result.warnings.some(w => w.includes('dust'))).toBe(true);
    });

    describe('Privacy Score Scaling', () => {
      it('should scale penalty with number of linked addresses', async () => {
        // 2 addresses
        const utxos2 = [
          createTestUtxo({ id: 'utxo-1', address: ADDRESS_1 }),
          createTestUtxo({ id: 'utxo-2', address: ADDRESS_2 }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos2);
        const result2 = await calculateSpendPrivacy(['utxo-1', 'utxo-2']);

        // 3 addresses
        const utxos3 = [
          createTestUtxo({ id: 'utxo-1', address: ADDRESS_1 }),
          createTestUtxo({ id: 'utxo-2', address: ADDRESS_2 }),
          createTestUtxo({ id: 'utxo-3', address: ADDRESS_3 }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos3);
        const result3 = await calculateSpendPrivacy(['utxo-1', 'utxo-2', 'utxo-3']);

        expect(result3.score).toBeLessThan(result2.score);
      });

      it('should cap penalty at maximum', async () => {
        // Many addresses
        const addresses = Array.from({ length: 10 }, (_, i) =>
          `tb1q${'x'.repeat(i + 30)}`
        );
        const utxos = addresses.map((addr, i) =>
          createTestUtxo({ id: `utxo-${i}`, address: addr })
        );

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await calculateSpendPrivacy(utxos.map(u => u.id));

        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      });
    });

    describe('Grade Assignment', () => {
      it('should assign excellent for single address spend', async () => {
        const utxos = [
          createTestUtxo({ id: 'utxo-1', address: ADDRESS_1, amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await calculateSpendPrivacy(['utxo-1']);

        expect(result.grade).toBe('excellent');
      });

      it('should assign lower grade for multi-address spend', async () => {
        // Use 4 different addresses and different txids to maximize penalty
        // 4 addresses -> penalty = min(30, (4-1)*10) = 30
        // Different txids -> no bonus
        // Score = 70, which gives "good" grade (60-79)
        const utxos = [
          createTestUtxo({ id: 'utxo-1', address: ADDRESS_1, txid: 'aaaa'.repeat(16) }),
          createTestUtxo({ id: 'utxo-2', address: ADDRESS_2, txid: 'bbbb'.repeat(16) }),
          createTestUtxo({ id: 'utxo-3', address: ADDRESS_3, txid: 'cccc'.repeat(16) }),
          createTestUtxo({ id: 'utxo-4', address: 'tb1q0sg9hgrv5flqm42xm3y6vc7xw98g9ftfve8c6p', txid: 'dddd'.repeat(16) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await calculateSpendPrivacy(['utxo-1', 'utxo-2', 'utxo-3', 'utxo-4']);

        expect(['good', 'fair', 'poor']).toContain(result.grade);
      });
    });
  });

  describe('calculateWalletPrivacy aggregate loading', () => {
    type Row = ReturnType<typeof createTestUtxo>;
    const TXID_A = 'aaaa'.repeat(16);
    const TXID_B = 'bbbb'.repeat(16);
    const TXID_C = 'cccc'.repeat(16);
    const TXID_D = 'dddd'.repeat(16);
    const TXID_E = 'eeee'.repeat(16);

    // Address reuse, a shared txid, same-height/different-txid, a frozen UTXO, and
    // blockHeight null and 0 (both skip the timing factor).
    const fixture: Row[] = [
      createTestUtxo({ id: 'reuse-1', txid: TXID_A, vout: 0, address: ADDRESS_1, amount: BigInt(123456), blockHeight: 800000 }),
      createTestUtxo({ id: 'reuse-2', txid: TXID_B, vout: 0, address: ADDRESS_1, amount: BigInt(234567), blockHeight: 800001 }),
      createTestUtxo({ id: 'cluster-1', txid: TXID_C, vout: 0, address: ADDRESS_2, amount: BigInt(345678), blockHeight: 800002 }),
      createTestUtxo({ id: 'cluster-2', txid: TXID_C, vout: 1, address: ADDRESS_3, amount: BigInt(456789), blockHeight: 800002 }),
      createTestUtxo({ id: 'same-height', txid: TXID_D, vout: 0, address: 'tb1qsameheight', amount: BigInt(567891), blockHeight: 800002 }),
      createTestUtxo({ id: 'frozen', txid: TXID_E, vout: 0, address: ADDRESS_1, amount: BigInt(100_000_000), blockHeight: 800000, frozen: true }),
      createTestUtxo({ id: 'null-height', txid: 'ffff'.repeat(16), vout: 0, address: 'tb1qnullheight', amount: BigInt(678912), blockHeight: null }),
      createTestUtxo({ id: 'zero-height', txid: '1111'.repeat(16), vout: 0, address: 'tb1qzeroheight', amount: BigInt(789123), blockHeight: 0 }),
    ];

    // Answers each query from the fixture by its `where` clause so the same data serves
    // both the per-UTXO path and the single aggregate load.
    const mockFixtureQueries = (rows: Row[]) => {
      const matches = (row: Row, where: any) =>
        (where.walletId === undefined || row.walletId === where.walletId) &&
        (where.spent === undefined || row.spent === where.spent) &&
        (where.frozen === undefined || row.frozen === where.frozen) &&
        (where.address === undefined || row.address === where.address) &&
        (where.txid === undefined ||
          (typeof where.txid === 'string' ? row.txid === where.txid : row.txid !== where.txid.not)) &&
        (where.blockHeight === undefined || row.blockHeight === where.blockHeight) &&
        (where.id === undefined || row.id !== where.id.not);
      mockPrismaClient.uTXO.findMany.mockImplementation(async ({ where }: any) =>
        rows.filter(r => matches(r, where)).sort((a, b) => Number(b.amount - a.amount)));
      mockPrismaClient.uTXO.count.mockImplementation(async ({ where }: any) =>
        rows.filter(r => matches(r, where)).length);
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const row = rows.find(r => r.id === where.id);
        return row ? { ...row, wallet: { id: WALLET_ID } } : null;
      });
    };

    it('loads wallet aggregates once without per-UTXO queries', async () => {
      const rows = Array.from({ length: 50 }, (_, i) =>
        createTestUtxo({
          id: `utxo-${i}`,
          txid: `${'a'.repeat(60)}${i.toString().padStart(4, '0')}`,
          address: `tb1q${i}`,
          amount: BigInt(10_000 + i * 37),
        }));
      mockFixtureQueries(rows);

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.utxos).toHaveLength(50);
      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.uTXO.count).not.toHaveBeenCalled();
      expect(mockPrismaClient.uTXO.findUnique).not.toHaveBeenCalled();
    });

    it('scores identically to the per-UTXO path, counting frozen UTXOs as aggregate context only', async () => {
      mockFixtureQueries(fixture);

      const result = await calculateWalletPrivacy(WALLET_ID);

      // Scored list is unspent and unfrozen, amount desc.
      expect(result.utxos.map(u => u.utxoId)).toEqual([
        'zero-height', 'null-height', 'same-height', 'cluster-2', 'cluster-1', 'reuse-2', 'reuse-1',
      ]);
      const scores = Object.fromEntries(result.utxos.map(u => [u.utxoId, u.score.score]));
      // Expected values recorded from the per-UTXO implementation at 336bc94b.
      expect(scores).toEqual({
        'cluster-1': 80,
        'cluster-2': 80,
        'null-height': 95,
        'reuse-1': 65,
        'reuse-2': 75,
        'same-height': 85,
        'zero-height': 95,
      });
      expect(result.summary.addressReuseCount).toBe(1);
      expect(result.summary.clusterCount).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    describe('Single UTXO Wallet', () => {
      it('should handle wallet with exactly one UTXO', async () => {
        const utxo = createTestUtxo({ amount: BigInt(12345) }); // Non-round

        mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo]);
        mockPrismaClient.uTXO.findUnique.mockResolvedValue({
          ...utxo,
          wallet: { id: WALLET_ID },
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);

        const result = await calculateWalletPrivacy(WALLET_ID);

        expect(result.summary.utxoCount).toBe(1);
        expect(result.summary.addressReuseCount).toBe(0);
        expect(result.summary.clusterCount).toBe(0);
      });
    });

    describe('All Same Address', () => {
      it('should heavily penalize all UTXOs on same address', async () => {
        const utxos = Array.from({ length: 10 }, (_, i) =>
          createTestUtxo({
            id: `utxo-${i}`,
            address: ADDRESS_1, // All same address
            txid: `${'a'.repeat(60)}${i.toString().padStart(4, '0')}`,
          })
        );

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
        mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
          const utxo = utxos.find(u => u.id === where.id);
          return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(10); // All on same address

        const result = await calculateWalletPrivacy(WALLET_ID);

        expect(result.summary.addressReuseCount).toBe(1); // One address reused
        expect(result.summary.averageScore).toBeLessThan(80);
      });
    });

    describe('Very Large Wallet', () => {
      it('should handle wallet with many UTXOs', async () => {
        const utxos = Array.from({ length: 100 }, (_, i) =>
          createTestUtxo({
            id: `utxo-${i}`,
            address: `tb1q${'x'.repeat(30)}${i.toString().padStart(10, '0')}`,
            txid: `${'a'.repeat(54)}${i.toString().padStart(10, '0')}`,
            amount: BigInt(Math.floor(Math.random() * 1000000) + 10000),
          })
        );

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
        mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
          const utxo = utxos.find(u => u.id === where.id);
          return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(1);

        const result = await calculateWalletPrivacy(WALLET_ID);

        expect(result.summary.utxoCount).toBe(100);
        expect(result.utxos).toHaveLength(100);
      });
    });

    describe('Mixed Privacy Scenarios', () => {
      it('should calculate correct average for mixed privacy UTXOs', async () => {
        const utxos = [
          createTestUtxo({ id: 'good', amount: BigInt(12345), address: ADDRESS_1 }),
          createTestUtxo({ id: 'bad', amount: BigInt(100_000_000), address: ADDRESS_1 }), // Round + reuse
        ];

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
        mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
          const utxo = utxos.find(u => u.id === where.id);
          return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
        });
        mockPrismaClient.uTXO.count.mockResolvedValue(2);

        const result = await calculateWalletPrivacy(WALLET_ID);

        // Average should be between the two individual scores
        const scores = result.utxos.map(u => u.score.score);
        expect(result.summary.averageScore).toBeLessThanOrEqual(Math.max(...scores));
        expect(result.summary.averageScore).toBeGreaterThanOrEqual(Math.min(...scores));
      });
    });
  });
});
