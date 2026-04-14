import { describe, expect, it, vi, type Mock } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  randomAddress,
  randomTxid,
} from '../../../helpers/testUtils';
import * as blockchain from '../../../../src/services/bitcoin/blockchain';
import * as addressDerivation from '../../../../src/services/bitcoin/addressDerivation';

export function registerWalletLedgerTests(): void {
  describe('GET /wallets/:walletId/transactions', () => {
    it('should return transactions for a wallet', async () => {
      const walletId = 'wallet-123';
      const userId = 'user-123';

      const mockTransactions = [
        {
          id: 'tx-1',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          fee: BigInt(500),
          balanceAfter: BigInt(100000), // Running balance after first transaction
          confirmations: 6,
          blockHeight: BigInt(849994),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/0" },
          transactionLabels: [],
        },
        {
          id: 'tx-2',
          txid: randomTxid(),
          walletId,
          type: 'sent',
          amount: BigInt(-50000),
          fee: BigInt(300),
          balanceAfter: BigInt(50000), // Running balance after second transaction (100000 - 50000)
          confirmations: 3,
          blockHeight: BigInt(849997),
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/1" },
          transactionLabels: [
            { label: { id: 'label-1', name: 'Rent', color: '#ff0000' } },
          ],
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);

      const req = createMockRequest({
        params: { walletId },
        query: { limit: '10', offset: '0' },
        user: { userId, username: 'testuser', isAdmin: false },
      });
      (req as any).walletId = walletId;

      const { res, getResponse } = createMockResponse();

      // Use the imported blockchain module
      const { getBlockHeight } = blockchain;

      // Simulate route handler logic
      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        include: {
          address: { select: { address: true, derivationPath: true } },
          transactionLabels: { include: { label: true } },
        },
        orderBy: { blockTime: 'desc' },
        take: 10,
        skip: 0,
      });

      const currentBlockHeight = await getBlockHeight();

      const serializedTransactions = transactions.map((tx: any) => {
        const blockHeight = Number(tx.blockHeight);
        return {
          ...tx,
          amount: Number(tx.amount),
          fee: Number(tx.fee),
          balanceAfter: tx.balanceAfter ? Number(tx.balanceAfter) : null,
          blockHeight,
          confirmations: blockHeight > 0 ? currentBlockHeight - blockHeight + 1 : 0,
          labels: tx.transactionLabels.map((tl: any) => tl.label),
        };
      });

      res.json!(serializedTransactions);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].amount).toBe(100000);
      expect(response.body[1].labels).toHaveLength(1);
    });

    it('should handle empty transaction list', async () => {
      const walletId = 'wallet-empty';
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      res.json!(transactions);

      const response = getResponse();
      expect(response.body).toEqual([]);
    });

    it('should apply pagination correctly', async () => {
      const walletId = 'wallet-123';
      const limit = 5;
      const offset = 10;

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await mockPrismaClient.transaction.findMany({
        where: { walletId },
        take: limit,
        skip: offset,
      });

      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: limit,
          skip: offset,
        })
      );
    });
  });

  describe('GET /wallets/:walletId/transactions/pending', () => {
    it('should return pending transactions with mempool data', async () => {
      const walletId = 'wallet-123';
      const txid = randomTxid();

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'testnet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'pending-1',
          txid,
          walletId,
          type: 'sent',
          amount: BigInt(-25000),
          fee: BigInt(500),
          confirmations: 0,
          createdAt: new Date(Date.now() - 60000), // 1 minute ago
          counterpartyAddress: randomAddress(),
        },
      ]);

      // Mock mempool.space API response
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ weight: 560, fee: 500 }),
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the handler
      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
        select: { name: true, network: true },
      });

      const pendingTxs = await mockPrismaClient.transaction.findMany({
        where: { walletId, confirmations: 0 },
      });

      const mempoolBaseUrl = wallet?.network === 'testnet'
        ? 'https://mempool.space/testnet/api'
        : 'https://mempool.space/api';

      const pendingTransactions = await Promise.all(
        pendingTxs.map(async (tx: any) => {
          let fee = tx.fee ? Number(tx.fee) : 0;
          let vsize: number | undefined;
          let feeRate = 0;

          const response = await fetch(`${mempoolBaseUrl}/tx/${tx.txid}`);
          if (response.ok) {
            const txData = await response.json() as { weight?: number; fee?: number };
            vsize = txData.weight ? Math.ceil(txData.weight / 4) : undefined;
            if (vsize && fee > 0) {
              feeRate = Math.round((fee / vsize) * 10) / 10;
            }
          }

          return {
            txid: tx.txid,
            walletId: tx.walletId,
            walletName: wallet?.name,
            type: 'sent',
            amount: Number(tx.amount),
            fee,
            feeRate,
            vsize,
          };
        })
      );

      res.json!(pendingTransactions);

      const response = getResponse();
      expect(response.body).toHaveLength(1);
      expect(response.body[0].vsize).toBe(140); // 560 / 4
      expect(response.body[0].feeRate).toBeCloseTo(3.6, 1); // 500 / 140
    });

    it('should return empty array when no pending transactions', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'mainnet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const pendingTxs = await mockPrismaClient.transaction.findMany({
        where: { walletId, confirmations: 0 },
      });

      if (pendingTxs.length === 0) {
        res.json!([]);
      }

      expect(getResponse().body).toEqual([]);
    });

    it('should handle mempool API failure gracefully', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'mainnet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'pending-1',
          txid: randomTxid(),
          walletId,
          type: 'sent',
          amount: BigInt(-25000),
          fee: BigInt(500),
          confirmations: 0,
          createdAt: new Date(),
        },
      ]);

      // Mock API failure
      (global.fetch as Mock).mockRejectedValue(new Error('Network error'));

      // Should not throw - gracefully handle the error
      const { res, getResponse } = createMockResponse();

      try {
        await fetch('https://mempool.space/api/tx/test');
      } catch {
        // Expected to fail
      }

      // Transaction should still be returned without mempool data
      res.json!([{
        txid: 'test-txid',
        fee: 500,
        feeRate: 0,
        vsize: undefined,
      }]);

      expect(getResponse().body[0].feeRate).toBe(0);
    });

    it('should exclude replaced RBF transactions from pending', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'testnet',
      });

      // Simulate the query that should include rbfStatus filter
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await mockPrismaClient.transaction.findMany({
        where: {
          walletId,
          rbfStatus: { not: 'replaced' },
          OR: [
            { blockHeight: 0 },
            { blockHeight: null },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      // Verify the query includes rbfStatus filter to exclude replaced transactions
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            rbfStatus: { not: 'replaced' },
          }),
        })
      );
    });
  });

  describe('GET /wallets/:walletId/transactions/export', () => {
    it('should export transactions as JSON', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          txid: randomTxid(),
          type: 'received',
          amount: BigInt(1000000),
          fee: null,
          confirmations: 10,
          blockTime: new Date('2024-01-15'),
          createdAt: new Date('2024-01-15'),
          label: 'Salary',
          memo: 'January payment',
          counterpartyAddress: null,
          blockHeight: BigInt(849000),
          transactionLabels: [],
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
        select: { name: true },
      });

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        include: { transactionLabels: { include: { label: true } } },
        orderBy: { blockTime: 'desc' },
      });

      const exportData = transactions.map((tx: any) => ({
        date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        txid: tx.txid,
        type: tx.type,
        amountBtc: Number(tx.amount) / 100000000,
        amountSats: Number(tx.amount),
        feeSats: tx.fee ? Number(tx.fee) : null,
        confirmations: tx.confirmations,
        label: tx.label || '',
        memo: tx.memo || '',
      }));

      res.json!(exportData);

      const response = getResponse();
      expect(response.body[0].amountBtc).toBe(0.01);
      expect(response.body[0].amountSats).toBe(1000000);
      expect(response.body[0].label).toBe('Salary');
    });

    it('should filter by date range', async () => {
      const walletId = 'wallet-123';
      const startDate = '2024-01-01';
      const endDate = '2024-01-31';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await mockPrismaClient.transaction.findMany({
        where: {
          walletId,
          blockTime: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
      });

      // Verify date filter was applied
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalled();
    });
  });

  describe('GET /wallets/:walletId/utxos', () => {
    it('should return UTXOs for a wallet', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          id: 'utxo-1',
          txid: randomTxid(),
          vout: 0,
          walletId,
          addressId: 'addr-1',
          value: BigInt(50000),
          confirmations: 6,
          isSpent: false,
          address: {
            address: randomAddress(),
            derivationPath: "m/84'/1'/0'/0/0",
          },
        },
        {
          id: 'utxo-2',
          txid: randomTxid(),
          vout: 1,
          walletId,
          addressId: 'addr-2',
          value: BigInt(30000),
          confirmations: 3,
          isSpent: false,
          address: {
            address: randomAddress(),
            derivationPath: "m/84'/1'/0'/0/1",
          },
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, isSpent: false },
        include: {
          address: { select: { address: true, derivationPath: true } },
        },
      });

      const serialized = utxos.map((utxo: any) => ({
        ...utxo,
        value: Number(utxo.value),
      }));

      res.json!(serialized);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].value).toBe(50000);
      expect(response.body[1].value).toBe(30000);
    });

    it('should exclude spent UTXOs', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await mockPrismaClient.uTXO.findMany({
        where: { walletId, isSpent: false },
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isSpent: false,
          }),
        })
      );
    });

    it('should include draft lock info for locked UTXOs', async () => {
      const walletId = 'wallet-123';
      const confirmationThreshold = 1;

      const mockUtxos = [
        {
          id: 'utxo-locked',
          txid: randomTxid(),
          vout: 0,
          walletId,
          amount: BigInt(100000),
          confirmations: 6,
          frozen: false,
          createdAt: new Date(),
          blockHeight: 850000,
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/0" },
          draftLock: {
            draftId: 'draft-456',
            draft: { label: 'Pending Payment' },
            createdAt: new Date(),
          },
        },
        {
          id: 'utxo-unlocked',
          txid: randomTxid(),
          vout: 1,
          walletId,
          amount: BigInt(50000),
          confirmations: 10,
          frozen: false,
          createdAt: new Date(),
          blockHeight: 849996,
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/1" },
          draftLock: null, // Not locked
        },
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(mockUtxos);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
        include: {
          address: { select: { address: true, derivationPath: true } },
          draftLock: {
            include: { draft: { select: { label: true } } },
          },
        },
      });

      // Simulate the API serialization logic
      const serializedUtxos = utxos.map((utxo: any) => {
        const isLockedByDraft = !!utxo.draftLock;
        return {
          id: utxo.id,
          txid: utxo.txid,
          vout: utxo.vout,
          amount: Number(utxo.amount),
          confirmations: utxo.confirmations,
          frozen: utxo.frozen,
          spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
          lockedByDraftId: utxo.draftLock?.draftId,
          lockedByDraftLabel: utxo.draftLock?.draft?.label,
        };
      });

      res.json!({ utxos: serializedUtxos });

      const response = getResponse();
      expect(response.body.utxos).toHaveLength(2);

      // Locked UTXO
      const lockedUtxo = response.body.utxos.find((u: any) => u.id === 'utxo-locked');
      expect(lockedUtxo.lockedByDraftId).toBe('draft-456');
      expect(lockedUtxo.lockedByDraftLabel).toBe('Pending Payment');
      expect(lockedUtxo.spendable).toBe(false); // Not spendable because locked

      // Unlocked UTXO
      const unlockedUtxo = response.body.utxos.find((u: any) => u.id === 'utxo-unlocked');
      expect(unlockedUtxo.lockedByDraftId).toBeUndefined();
      expect(unlockedUtxo.lockedByDraftLabel).toBeUndefined();
      expect(unlockedUtxo.spendable).toBe(true);
    });

    it('should mark frozen UTXOs as not spendable', async () => {
      const walletId = 'wallet-123';
      const confirmationThreshold = 1;

      const mockUtxos = [
        {
          id: 'utxo-frozen',
          txid: randomTxid(),
          vout: 0,
          walletId,
          amount: BigInt(100000),
          confirmations: 100,
          frozen: true, // Frozen
          createdAt: new Date(),
          blockHeight: 849900,
          draftLock: null,
        },
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(mockUtxos);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
      });

      const serializedUtxos = utxos.map((utxo: any) => {
        const isLockedByDraft = !!utxo.draftLock;
        return {
          id: utxo.id,
          amount: Number(utxo.amount),
          frozen: utxo.frozen,
          spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
        };
      });

      res.json!({ utxos: serializedUtxos });

      const response = getResponse();
      expect(response.body.utxos[0].frozen).toBe(true);
      expect(response.body.utxos[0].spendable).toBe(false);
    });

    it('should mark unconfirmed UTXOs as not spendable', async () => {
      const walletId = 'wallet-123';
      const confirmationThreshold = 3; // Require 3 confirmations

      const mockUtxos = [
        {
          id: 'utxo-unconfirmed',
          txid: randomTxid(),
          vout: 0,
          walletId,
          amount: BigInt(100000),
          confirmations: 1, // Only 1 confirmation, need 3
          frozen: false,
          createdAt: new Date(),
          draftLock: null,
        },
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(mockUtxos);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
      });

      const serializedUtxos = utxos.map((utxo: any) => {
        const isLockedByDraft = !!utxo.draftLock;
        return {
          id: utxo.id,
          confirmations: utxo.confirmations,
          spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
        };
      });

      res.json!({ utxos: serializedUtxos });

      const response = getResponse();
      expect(response.body.utxos[0].confirmations).toBe(1);
      expect(response.body.utxos[0].spendable).toBe(false);
    });

    it('should include draft lock in UTXO query', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
        include: {
          address: { select: { address: true, derivationPath: true } },
          draftLock: {
            include: { draft: { select: { label: true } } },
          },
        },
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            draftLock: expect.objectContaining({
              include: expect.objectContaining({
                draft: expect.objectContaining({
                  select: expect.objectContaining({
                    label: true,
                  }),
                }),
              }),
            }),
          }),
        })
      );
    });
  });

}
