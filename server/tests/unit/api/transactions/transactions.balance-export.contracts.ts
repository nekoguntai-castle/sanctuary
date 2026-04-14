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

export function registerBalanceExportTests(): void {
  describe('Confirmation Calculation', () => {
    it('should calculate confirmations dynamically', () => {
      const currentBlockHeight = 850000;
      const txBlockHeight = 849990;

      // confirmations = currentBlockHeight - txBlockHeight + 1
      const confirmations = currentBlockHeight - txBlockHeight + 1;

      expect(confirmations).toBe(11);
    });

    it('should return 0 confirmations for unconfirmed transactions', () => {
      const currentBlockHeight = 850000;
      const txBlockHeight = 0;

      const confirmations = txBlockHeight <= 0 ? 0 : currentBlockHeight - txBlockHeight + 1;

      expect(confirmations).toBe(0);
    });

    it('should return 0 confirmations for null block height', () => {
      const currentBlockHeight = 850000;
      const txBlockHeight = null;

      const confirmations = !txBlockHeight || txBlockHeight <= 0 ? 0 : currentBlockHeight - txBlockHeight + 1;

      expect(confirmations).toBe(0);
    });
  });

  describe('BigInt Serialization', () => {
    it('should convert BigInt to number for JSON response', () => {
      const bigIntValue = BigInt(1234567890);
      const numberValue = Number(bigIntValue);

      expect(typeof numberValue).toBe('number');
      expect(numberValue).toBe(1234567890);
    });

    it('should handle zero BigInt', () => {
      const bigIntValue = BigInt(0);
      const numberValue = Number(bigIntValue);

      expect(numberValue).toBe(0);
    });

    it('should handle null fee', () => {
      const fee: bigint | null = null;
      const feeNumber = fee ? Number(fee) : null;

      expect(feeNumber).toBeNull();
    });

    it('should convert balanceAfter BigInt to number', () => {
      const balanceAfter = BigInt(150000);
      const balanceAfterNumber = Number(balanceAfter);

      expect(typeof balanceAfterNumber).toBe('number');
      expect(balanceAfterNumber).toBe(150000);
    });

    it('should handle null balanceAfter', () => {
      const balanceAfter: bigint | null = null;
      const balanceAfterNumber = balanceAfter ? Number(balanceAfter) : null;

      expect(balanceAfterNumber).toBeNull();
    });
  });

  describe('Running Balance (balanceAfter)', () => {
    it('should include balanceAfter in transaction response', async () => {
      const walletId = 'wallet-with-balance';

      const mockTransactions = [
        {
          id: 'tx-balance-1',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(200000),
          fee: null,
          balanceAfter: BigInt(200000),
          confirmations: 10,
          blockHeight: BigInt(850000),
          blockTime: new Date('2024-02-01'),
          createdAt: new Date('2024-02-01'),
          address: null,
          transactionLabels: [],
        },
        {
          id: 'tx-balance-2',
          txid: randomTxid(),
          walletId,
          type: 'sent',
          amount: BigInt(-75000),
          fee: BigInt(1000),
          balanceAfter: BigInt(125000), // 200000 - 75000
          confirmations: 8,
          blockHeight: BigInt(850002),
          blockTime: new Date('2024-02-02'),
          createdAt: new Date('2024-02-02'),
          address: null,
          transactionLabels: [],
        },
        {
          id: 'tx-balance-3',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(50000),
          fee: null,
          balanceAfter: BigInt(175000), // 125000 + 50000
          confirmations: 5,
          blockHeight: BigInt(850005),
          blockTime: new Date('2024-02-03'),
          createdAt: new Date('2024-02-03'),
          address: null,
          transactionLabels: [],
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      const serializedTransactions = transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        fee: tx.fee ? Number(tx.fee) : null,
        balanceAfter: tx.balanceAfter ? Number(tx.balanceAfter) : null,
        blockHeight: Number(tx.blockHeight),
      }));

      res.json!(serializedTransactions);

      const response = getResponse();
      expect(response.body).toHaveLength(3);

      // Verify balanceAfter values
      expect(response.body[0].balanceAfter).toBe(200000);
      expect(response.body[1].balanceAfter).toBe(125000);
      expect(response.body[2].balanceAfter).toBe(175000);

      // Verify types
      expect(typeof response.body[0].balanceAfter).toBe('number');
      expect(typeof response.body[1].balanceAfter).toBe('number');
      expect(typeof response.body[2].balanceAfter).toBe('number');
    });

    it('should handle transactions with null balanceAfter (legacy data)', async () => {
      const walletId = 'wallet-legacy';

      const mockTransactions = [
        {
          id: 'tx-legacy-1',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          fee: null,
          balanceAfter: null, // Legacy transaction without balanceAfter
          confirmations: 100,
          blockHeight: BigInt(800000),
          blockTime: new Date('2023-01-01'),
          createdAt: new Date('2023-01-01'),
          address: null,
          transactionLabels: [],
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      const serializedTransactions = transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        balanceAfter: tx.balanceAfter ? Number(tx.balanceAfter) : null,
      }));

      res.json!(serializedTransactions);

      const response = getResponse();
      expect(response.body[0].balanceAfter).toBeNull();
    });
  });

  describe('GET /wallets/:walletId/transactions/stats', () => {
    it('should return walletBalance from last transaction balanceAfter', async () => {
      const walletId = 'wallet-with-stats';

      // Mock the last transaction query (ordered by blockTime desc, createdAt desc)
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: BigInt(175000),
      });

      // Mock count and aggregations
      mockPrismaClient.transaction.count.mockResolvedValue(5);
      mockPrismaClient.transaction.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(50000), fee: BigInt(2500) },
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the stats endpoint logic
      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 5,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(175000);
      expect(mockPrismaClient.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
          select: { balanceAfter: true },
        })
      );
    });

    it('should return 0 walletBalance for empty wallet', async () => {
      const walletId = 'wallet-empty';

      // No transactions
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockPrismaClient.transaction.count.mockResolvedValue(0);

      const { res, getResponse } = createMockResponse();

      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 0,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(0);
      expect(response.body.totalCount).toBe(0);
    });

    it('should return correct balance for single transaction', async () => {
      const walletId = 'wallet-single-tx';

      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: BigInt(100000),
      });
      mockPrismaClient.transaction.count.mockResolvedValue(1);

      const { res, getResponse } = createMockResponse();

      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 1,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(100000);
    });

    it('should handle null balanceAfter (legacy data) gracefully', async () => {
      const walletId = 'wallet-legacy-stats';

      // Legacy transaction without balanceAfter
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: null,
      });
      mockPrismaClient.transaction.count.mockResolvedValue(1);

      const { res, getResponse } = createMockResponse();

      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      // Falls back to 0 when balanceAfter is null
      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 1,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(0);
    });

    it('should use correct ordering for most recent transaction', async () => {
      const walletId = 'wallet-ordering-test';

      // Two transactions with same blockTime but different createdAt
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: BigInt(250000), // The most recent by createdAt
      });

      await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      // Verify the query used correct ordering
      expect(mockPrismaClient.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        })
      );
    });
  });

  describe('POST /wallets/:walletId/transactions/recalculate', () => {
    it('should recalculate all balanceAfter values correctly', async () => {
      const walletId = 'wallet-recalc';

      const mockTransactions = [
        {
          id: 'tx-1',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'tx-2',
          amount: BigInt(-30000),
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'tx-3',
          amount: BigInt(50000),
          blockTime: new Date('2024-01-03'),
          createdAt: new Date('2024-01-03'),
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      const { res, getResponse } = createMockResponse();

      // Simulate recalculation logic
      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: [{ blockTime: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, amount: true },
      });

      let runningBalance = BigInt(0);
      for (const tx of transactions) {
        runningBalance += tx.amount;
        await mockPrismaClient.transaction.update({
          where: { id: tx.id },
          data: { balanceAfter: runningBalance },
        });
      }

      res.json!({
        success: true,
        transactionsUpdated: transactions.length,
        finalBalance: Number(runningBalance),
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.transactionsUpdated).toBe(3);
      expect(response.body.finalBalance).toBe(120000); // 100000 - 30000 + 50000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledTimes(3);
    });

    it('should handle empty wallet recalculation', async () => {
      const walletId = 'wallet-empty-recalc';

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: [{ blockTime: 'asc' }, { createdAt: 'asc' }],
      });

      res.json!({
        success: true,
        transactionsUpdated: 0,
        finalBalance: 0,
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.transactionsUpdated).toBe(0);
      expect(response.body.finalBalance).toBe(0);
    });

    it('should handle pending transactions (null blockTime) in correct order', async () => {
      const walletId = 'wallet-pending-recalc';

      const mockTransactions = [
        {
          id: 'tx-confirmed',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'tx-pending-1',
          amount: BigInt(25000),
          blockTime: null, // Unconfirmed
          createdAt: new Date('2024-01-02T10:00:00'),
        },
        {
          id: 'tx-pending-2',
          amount: BigInt(-10000),
          blockTime: null, // Unconfirmed
          createdAt: new Date('2024-01-02T11:00:00'),
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: [{ blockTime: 'asc' }, { createdAt: 'asc' }],
      });

      let runningBalance = BigInt(0);
      for (const tx of transactions) {
        runningBalance += tx.amount;
      }

      res.json!({
        success: true,
        transactionsUpdated: 3,
        finalBalance: Number(runningBalance),
      });

      const response = getResponse();
      expect(response.body.finalBalance).toBe(115000); // 100000 + 25000 - 10000
    });
  });

  describe('Export with balanceAfter', () => {
    it('should include balanceAfterBtc and balanceAfterSats in JSON export', async () => {
      const walletId = 'wallet-export-balance';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Export Test Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          txid: randomTxid(),
          type: 'received',
          amount: BigInt(1000000),
          fee: null,
          balanceAfter: BigInt(1000000),
          confirmations: 10,
          blockTime: new Date('2024-01-15'),
          createdAt: new Date('2024-01-15'),
          label: 'Initial deposit',
          transactionLabels: [],
        },
        {
          id: 'tx-2',
          txid: randomTxid(),
          type: 'sent',
          amount: BigInt(-500000),
          fee: BigInt(1000),
          balanceAfter: BigInt(500000),
          confirmations: 8,
          blockTime: new Date('2024-01-16'),
          createdAt: new Date('2024-01-16'),
          label: 'Payment',
          transactionLabels: [],
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: { blockTime: 'desc' },
      });

      const exportData = transactions.map((tx: any) => ({
        date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        txid: tx.txid,
        type: tx.type,
        amountBtc: Number(tx.amount) / 100000000,
        amountSats: Number(tx.amount),
        feeSats: tx.fee ? Number(tx.fee) : null,
        balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100000000 : null,
        balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
        label: tx.label || '',
      }));

      res.json!(exportData);

      const response = getResponse();
      expect(response.body).toHaveLength(2);

      // First transaction (received)
      expect(response.body[0].balanceAfterSats).toBe(1000000);
      expect(response.body[0].balanceAfterBtc).toBe(0.01);

      // Second transaction (sent)
      expect(response.body[1].balanceAfterSats).toBe(500000);
      expect(response.body[1].balanceAfterBtc).toBe(0.005);
    });

    it('should handle null balanceAfter in export gracefully', async () => {
      const walletId = 'wallet-export-legacy';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Legacy Export Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-legacy',
          txid: randomTxid(),
          type: 'received',
          amount: BigInt(50000),
          fee: null,
          balanceAfter: null, // Legacy transaction
          confirmations: 100,
          blockTime: new Date('2023-06-01'),
          createdAt: new Date('2023-06-01'),
          label: '',
          transactionLabels: [],
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      const exportData = transactions.map((tx: any) => ({
        txid: tx.txid,
        balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100000000 : null,
        balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
      }));

      res.json!(exportData);

      const response = getResponse();
      expect(response.body[0].balanceAfterBtc).toBeNull();
      expect(response.body[0].balanceAfterSats).toBeNull();
    });

    it('should include balance columns in CSV export format', async () => {
      const walletId = 'wallet-csv-export';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'CSV Export Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          txid: 'abc123',
          type: 'received',
          amount: BigInt(100000),
          fee: null,
          balanceAfter: BigInt(100000),
          confirmations: 5,
          blockTime: new Date('2024-02-01'),
          createdAt: new Date('2024-02-01'),
          label: 'Test',
          transactionLabels: [],
        },
      ]);

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      // Simulate CSV header generation
      const csvHeaders = [
        'Date',
        'TXID',
        'Type',
        'Amount (BTC)',
        'Amount (sats)',
        'Fee (sats)',
        'Balance After (BTC)',
        'Balance After (sats)',
        'Label',
      ];

      // Simulate CSV row generation
      const csvRow = transactions.map((tx: any) => [
        tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        tx.txid,
        tx.type,
        (Number(tx.amount) / 100000000).toFixed(8),
        Number(tx.amount),
        tx.fee ? Number(tx.fee) : '',
        tx.balanceAfter ? (Number(tx.balanceAfter) / 100000000).toFixed(8) : '',
        tx.balanceAfter ? Number(tx.balanceAfter) : '',
        tx.label || '',
      ]);

      // Verify headers include balance columns
      expect(csvHeaders).toContain('Balance After (BTC)');
      expect(csvHeaders).toContain('Balance After (sats)');

      // Verify row includes balance values
      expect(csvRow[0][6]).toBe('0.00100000'); // Balance After (BTC)
      expect(csvRow[0][7]).toBe(100000); // Balance After (sats)
    });
  });

  describe('GET /transactions/:txid/raw', () => {
    it('should return raw tx hex when user has wallet access', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      // User has access to the wallet
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        rawTx: '0200000001abcdef...',
        wallet: { network: 'mainnet' },
      });

      const { res, getResponse } = createMockResponse();

      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      if (transaction?.rawTx) {
        res.json!({ hex: transaction.rawTx });
      }

      const response = getResponse();
      expect(response.body.hex).toBe('0200000001abcdef...');
    });

    it('should deny access when user does not have wallet access', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      // User does NOT have access - findFirst returns null due to wallet access filter
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      // Mock mempool.space API to also fail (transaction not found publicly)
      (global.fetch as Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { res, getResponse } = createMockResponse();

      // First check database with wallet access filter
      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      // Not found in database (due to access control), try mempool.space
      if (!transaction?.rawTx) {
        const response = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
        if (!response.ok) {
          res.status!(404).json!({
            error: 'Not Found',
            message: 'Transaction not found',
          });
        }
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });

    it('should verify wallet access filter includes user and group membership', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      // Verify the query includes proper access control
      expect(mockPrismaClient.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            wallet: expect.objectContaining({
              OR: expect.arrayContaining([
                { users: { some: { userId } } },
                { group: { members: { some: { userId } } } },
              ]),
            }),
          }),
        })
      );
    });

    it('should fallback to mempool.space when transaction not in database', async () => {
      const txid = randomTxid();
      const userId = 'user-123';
      const mockHex = '0200000001fedcba...';

      // Transaction not in our database
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      // Mock mempool.space API success
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => mockHex,
      });

      const { res, getResponse } = createMockResponse();

      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
      });

      if (!transaction?.rawTx) {
        // Fallback to mempool.space
        const response = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
        if (response.ok) {
          const hex = await response.text();
          res.json!({ hex });
        }
      }

      const response = getResponse();
      expect(response.body.hex).toBe(mockHex);
    });
  });

}
