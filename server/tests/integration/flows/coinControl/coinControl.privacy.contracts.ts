import { describe, expect, it } from 'vitest';

import { mockPrismaClient } from '../../../mocks/prisma';
import {
  ADDRESS_1,
  ADDRESS_2,
  ADDRESS_3,
  calculateSpendPrivacy,
  calculateWalletPrivacy,
  createTestUtxo,
  WALLET_ID,
} from './coinControlIntegrationTestHarness';

export const registerCoinControlPrivacyContracts = () => {
  describe('Wallet Privacy Analysis', () => {
    it('should calculate privacy scores for entire wallet', async () => {
      const utxos = [
        createTestUtxo({
          id: 'good',
          address: ADDRESS_1,
          amount: BigInt(123456),
          confirmations: 50,
        }),
        createTestUtxo({
          id: 'round',
          address: ADDRESS_2,
          amount: BigInt(100_000_000),
          confirmations: 10,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'reuse-1',
          address: ADDRESS_3,
          amount: BigInt(50000),
          confirmations: 20,
          txid: 'c'.repeat(64),
        }),
        createTestUtxo({
          id: 'reuse-2',
          address: ADDRESS_3,
          amount: BigInt(50000),
          confirmations: 20,
          txid: 'd'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const utxo = utxos.find(u => u.id === where.id);
        return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
      });
      mockPrismaClient.uTXO.count.mockImplementation(async ({ where }: any) => {
        if (where?.address) {
          return utxos.filter(u => u.address === where.address && !u.spent).length;
        }
        return 1;
      });

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.summary.utxoCount).toBe(4);
      expect(result.summary.addressReuseCount).toBe(1);
      expect(result.summary.roundAmountCount).toBeGreaterThanOrEqual(1);
      expect(result.summary.averageScore).toBeGreaterThan(0);
      expect(result.summary.averageScore).toBeLessThanOrEqual(100);
      expect(result.summary.recommendations.length).toBeGreaterThan(0);
    });

    it('should handle empty wallet', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.summary.utxoCount).toBe(0);
      expect(result.summary.averageScore).toBe(100);
      expect(result.summary.grade).toBe('excellent');
    });
  });

  describe('Spend Privacy Analysis', () => {
    it('should analyze privacy impact before spending', async () => {
      const utxo1 = createTestUtxo({
        id: 'utxo-1',
        address: ADDRESS_1,
        amount: BigInt(100000),
      });
      const utxo2 = createTestUtxo({
        id: 'utxo-2',
        address: ADDRESS_2,
        amount: BigInt(100000),
        txid: 'b'.repeat(64),
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([utxo1]);

      const singleAddressResult = await calculateSpendPrivacy(['utxo-1']);
      expect(singleAddressResult.linkedAddresses).toBe(1);
      expect(singleAddressResult.score).toBeGreaterThan(90);

      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([utxo1, utxo2]);
      const multiAddressResult = await calculateSpendPrivacy(['utxo-1', 'utxo-2']);
      expect(multiAddressResult.linkedAddresses).toBe(2);
      expect(multiAddressResult.score).toBeLessThan(singleAddressResult.score);
      expect(multiAddressResult.warnings.some(w => w.includes('address'))).toBe(true);
    });

    it('should give bonus for already-linked UTXOs', async () => {
      const sharedTxid = 'shared'.padEnd(64, '0');

      const linkedUtxos = [
        createTestUtxo({
          id: 'linked-1',
          txid: sharedTxid,
          vout: 0,
          address: ADDRESS_1,
        }),
        createTestUtxo({
          id: 'linked-2',
          txid: sharedTxid,
          vout: 1,
          address: ADDRESS_2,
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(linkedUtxos);

      const result = await calculateSpendPrivacy(['linked-1', 'linked-2']);

      expect(result.score).toBeGreaterThan(70);
    });

    it('should warn about dust UTXOs', async () => {
      const utxos = [
        createTestUtxo({
          id: 'dust',
          amount: BigInt(500),
        }),
        createTestUtxo({
          id: 'normal',
          amount: BigInt(100000),
          txid: 'b'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateSpendPrivacy(['dust', 'normal']);

      expect(result.warnings.some(w => w.includes('dust'))).toBe(true);
    });
  });
};
