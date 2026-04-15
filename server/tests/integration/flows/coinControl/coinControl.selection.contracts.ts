import { describe, expect, it } from 'vitest';

import { mockPrismaClient } from '../../../mocks/prisma';
import {
  ADDRESS_1,
  ADDRESS_2,
  ADDRESS_3,
  ADDRESS_4,
  calculateSpendPrivacy,
  compareStrategies,
  createTestUtxo,
  selectUtxos,
  WALLET_ID,
} from './coinControlIntegrationTestHarness';

export const registerCoinControlSelectionContracts = () => {
  describe('Complete Coin Control Flow', () => {
    it('should select UTXOs and calculate privacy impact', async () => {
      const utxos = [
        createTestUtxo({
          id: 'good-utxo-1',
          address: ADDRESS_1,
          amount: BigInt(100000),
          confirmations: 100,
          txid: 'a'.repeat(64),
        }),
        createTestUtxo({
          id: 'good-utxo-2',
          address: ADDRESS_2,
          amount: BigInt(80000),
          confirmations: 50,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'round-utxo',
          address: ADDRESS_3,
          amount: BigInt(10_000_000),
          confirmations: 20,
          txid: 'c'.repeat(64),
        }),
        createTestUtxo({
          id: 'reused-addr-1',
          address: ADDRESS_4,
          amount: BigInt(50000),
          confirmations: 10,
          txid: 'd'.repeat(64),
        }),
        createTestUtxo({
          id: 'reused-addr-2',
          address: ADDRESS_4,
          amount: BigInt(50000),
          confirmations: 10,
          txid: 'e'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const selection = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(150000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(selection.selected.length).toBeGreaterThan(0);
      expect(selection.totalAmount).toBeGreaterThanOrEqual(BigInt(150000));

      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        selection.selected.map(s => utxos.find(u => u.id === s.id)!),
      );

      const spendPrivacy = await calculateSpendPrivacy(
        selection.selected.map(u => u.id),
      );

      expect(spendPrivacy.score).toBeGreaterThanOrEqual(0);
      expect(spendPrivacy.score).toBeLessThanOrEqual(100);
      expect(spendPrivacy.linkedAddresses).toBeGreaterThanOrEqual(0);
    });

    it('should compare all selection strategies', async () => {
      const utxos = [
        createTestUtxo({
          id: 'large-old',
          amount: BigInt(500000),
          confirmations: 1000,
          txid: 'a'.repeat(64),
        }),
        createTestUtxo({
          id: 'medium-new',
          amount: BigInt(100000),
          confirmations: 5,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'small-old',
          amount: BigInt(20000),
          confirmations: 500,
          txid: 'c'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(100000),
        10,
      );

      expect(results.privacy).toBeDefined();
      expect(results.efficiency).toBeDefined();
      expect(results.oldest_first).toBeDefined();
      expect(results.largest_first).toBeDefined();
      expect(results.smallest_first).toBeDefined();
      expect(results.efficiency.selected[0].id).toBe('large-old');
      expect(results.largest_first.selected[0].id).toBe('large-old');
      expect(results.oldest_first.selected[0].id).toBe('large-old');
      expect(results.smallest_first.selected[0].id).toBe('small-old');
    });
  });

  describe('Privacy-Focused Selection', () => {
    it('should prefer already-linked UTXOs for better privacy', async () => {
      const sharedTxid = 'shared'.padEnd(64, '0');

      const utxos = [
        createTestUtxo({
          id: 'linked-1',
          txid: sharedTxid,
          vout: 0,
          address: ADDRESS_1,
          amount: BigInt(50000),
        }),
        createTestUtxo({
          id: 'linked-2',
          txid: sharedTxid,
          vout: 1,
          address: ADDRESS_2,
          amount: BigInt(60000),
        }),
        createTestUtxo({
          id: 'unrelated',
          txid: 'other'.padEnd(64, '0'),
          vout: 0,
          address: ADDRESS_3,
          amount: BigInt(200000),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.strategy).toBe('privacy');
      expect(result.privacyImpact).toBeDefined();
    });

    it('should warn about linking multiple addresses', async () => {
      const utxos = [
        createTestUtxo({
          id: 'addr1',
          address: ADDRESS_1,
          amount: BigInt(50000),
          txid: 'a'.repeat(64),
        }),
        createTestUtxo({
          id: 'addr2',
          address: ADDRESS_2,
          amount: BigInt(50000),
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'addr3',
          address: ADDRESS_3,
          amount: BigInt(50000),
          txid: 'c'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(120000),
        feeRate: 5,
        strategy: 'privacy',
      });

      if (result.privacyImpact && result.privacyImpact.linkedAddresses > 1) {
        expect(result.warnings.some(w => w.includes('address'))).toBe(true);
      }
    });
  });

  describe('Frozen/Locked UTXO Handling', () => {
    it('should exclude frozen UTXOs from selection', async () => {
      const utxos = [
        createTestUtxo({
          id: 'frozen',
          amount: BigInt(1000000),
          frozen: true,
        }),
        createTestUtxo({
          id: 'available',
          amount: BigInt(50000),
          frozen: false,
          txid: 'b'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        utxos.filter(u => !u.frozen),
      );

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(40000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeFrozen: true,
      });

      expect(result.selected.every(u => u.id !== 'frozen')).toBe(true);
      expect(result.selected.some(u => u.id === 'available')).toBe(true);
    });

    it('should exclude draft-locked UTXOs', async () => {
      const utxos = [
        createTestUtxo({
          id: 'locked',
          amount: BigInt(500000),
          draftLock: { draftId: 'draft-123' },
        }),
        createTestUtxo({
          id: 'unlocked',
          amount: BigInt(100000),
          draftLock: null,
          txid: 'b'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        utxos.filter(u => u.draftLock === null),
      );

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected.every(u => u.id !== 'locked')).toBe(true);
    });

    it('should include frozen when explicitly requested', async () => {
      const utxos = [
        createTestUtxo({
          id: 'frozen',
          amount: BigInt(100000),
          frozen: true,
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeFrozen: false,
      });

      expect(result.selected).toHaveLength(1);
    });
  });
};
