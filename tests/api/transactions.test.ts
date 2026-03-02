/**
 * Transactions API Tests
 *
 * Tests for all transaction-related API functions:
 * request construction, endpoint correctness, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API client
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDownload = vi.fn();
const mockGetToken = vi.fn().mockReturnValue('test-token');

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    download: (...args: unknown[]) => mockDownload(...args),
    getToken: () => mockGetToken(),
  },
  API_BASE_URL: '/api/v1',
}));

// Mock downloadBlob
vi.mock('../../utils/download', () => ({
  downloadBlob: vi.fn(),
}));

import {
  getTransactions,
  getTransaction,
  getPendingTransactions,
  getTransactionStats,
  exportTransactions,
  getUTXOs,
  getAddresses,
  getAddressSummary,
  generateAddresses,
  createTransaction,
  broadcastTransaction,
  estimateTransaction,
  freezeUTXO,
  createBatchTransaction,
  getRecentTransactions,
  getAllPendingTransactions,
  getBalanceHistory,
  getWalletPrivacy,
  getUtxoPrivacy,
  analyzeSpendPrivacy,
  selectUtxos,
  compareStrategies,
  getRecommendedStrategy,
} from '../../src/api/transactions';

describe('Transactions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // Transaction queries
  // ========================================
  describe('getTransactions', () => {
    it('should call GET with correct wallet endpoint', async () => {
      mockGet.mockResolvedValue([]);
      await getTransactions('wallet-1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/transactions', undefined);
    });

    it('should pass params for pagination', async () => {
      mockGet.mockResolvedValue([]);
      await getTransactions('wallet-1', { limit: 20, offset: 10 });
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/transactions', { limit: 20, offset: 10 });
    });
  });

  describe('getTransaction', () => {
    it('should fetch a single transaction by txid', async () => {
      const mockTx = { txid: 'abc123', amount: 50000 };
      mockGet.mockResolvedValue(mockTx);
      const result = await getTransaction('abc123');
      expect(mockGet).toHaveBeenCalledWith('/transactions/abc123');
      expect(result).toEqual(mockTx);
    });
  });

  describe('getPendingTransactions', () => {
    it('should call correct pending endpoint', async () => {
      mockGet.mockResolvedValue([]);
      await getPendingTransactions('wallet-1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/transactions/pending');
    });
  });

  describe('getTransactionStats', () => {
    it('should call stats endpoint', async () => {
      const mockStats = { totalCount: 10, totalReceived: 500000 };
      mockGet.mockResolvedValue(mockStats);
      const result = await getTransactionStats('wallet-1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/transactions/stats');
      expect(result).toEqual(mockStats);
    });
  });

  describe('exportTransactions', () => {
    it('uses json extension and includes optional date params', async () => {
      const expectedDate = new Date().toISOString().slice(0, 10);
      mockDownload.mockResolvedValue(undefined);

      await exportTransactions('wallet-1', 'My Wallet #1', {
        format: 'json',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(mockDownload).toHaveBeenCalledWith(
        '/wallets/wallet-1/transactions/export',
        `My_Wallet__1_transactions_${expectedDate}.json`,
        {
          params: {
            format: 'json',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
          },
        }
      );
    });

    it('uses csv extension and omits optional date params when missing', async () => {
      const expectedDate = new Date().toISOString().slice(0, 10);
      mockDownload.mockResolvedValue(undefined);

      await exportTransactions('wallet-1', 'Team Wallet', {
        format: 'csv',
      });

      expect(mockDownload).toHaveBeenCalledWith(
        '/wallets/wallet-1/transactions/export',
        `Team_Wallet_transactions_${expectedDate}.csv`,
        {
          params: {
            format: 'csv',
          },
        }
      );
    });
  });

  // ========================================
  // UTXOs
  // ========================================
  describe('getUTXOs', () => {
    it('should fetch UTXOs for a wallet', async () => {
      const mockResponse = { utxos: [], count: 0, totalBalance: 0 };
      mockGet.mockResolvedValue(mockResponse);
      const result = await getUTXOs('wallet-1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/utxos', undefined);
      expect(result).toEqual(mockResponse);
    });

    it('should pass pagination params', async () => {
      mockGet.mockResolvedValue({ utxos: [], count: 0, totalBalance: 0 });
      await getUTXOs('wallet-1', { limit: 50, offset: 0 });
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/utxos', { limit: 50, offset: 0 });
    });
  });

  describe('freezeUTXO', () => {
    it('should PATCH utxo freeze status', async () => {
      const mockResponse = { id: 'utxo-1', frozen: true, message: 'Frozen' };
      mockPatch.mockResolvedValue(mockResponse);
      const result = await freezeUTXO('utxo-1', true);
      expect(mockPatch).toHaveBeenCalledWith('/utxos/utxo-1/freeze', { frozen: true });
      expect(result.frozen).toBe(true);
    });

    it('should unfreeze UTXO', async () => {
      mockPatch.mockResolvedValue({ id: 'utxo-1', frozen: false, message: 'Unfrozen' });
      await freezeUTXO('utxo-1', false);
      expect(mockPatch).toHaveBeenCalledWith('/utxos/utxo-1/freeze', { frozen: false });
    });
  });

  // ========================================
  // Addresses
  // ========================================
  describe('getAddresses', () => {
    it('should fetch addresses for a wallet', async () => {
      mockGet.mockResolvedValue([]);
      await getAddresses('wallet-1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/addresses', undefined);
    });

    it('should pass filter params', async () => {
      mockGet.mockResolvedValue([]);
      await getAddresses('wallet-1', { used: true, limit: 20 });
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/addresses', { used: true, limit: 20 });
    });
  });

  describe('getAddressSummary', () => {
    it('should call summary endpoint', async () => {
      mockGet.mockResolvedValue({ totalAddresses: 40, usedCount: 15 });
      await getAddressSummary('wallet-1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/addresses/summary');
    });
  });

  describe('generateAddresses', () => {
    it('should POST address generation request', async () => {
      mockPost.mockResolvedValue({ generated: 10 });
      const result = await generateAddresses('wallet-1', 10);
      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/addresses/generate', { count: 10 });
      expect(result.generated).toBe(10);
    });

    it('should default to 10 addresses', async () => {
      mockPost.mockResolvedValue({ generated: 10 });
      await generateAddresses('wallet-1');
      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/addresses/generate', { count: 10 });
    });
  });

  // ========================================
  // Transaction creation & broadcasting
  // ========================================
  describe('createTransaction', () => {
    it('should POST PSBT creation request', async () => {
      const request = {
        recipient: 'tb1qtest',
        amount: 50000,
        feeRate: 10,
        enableRBF: true,
      };
      const mockResponse = {
        psbtBase64: 'cHNidP8B...',
        fee: 1130,
        totalInput: 100000,
        totalOutput: 98870,
        changeAmount: 48870,
        utxos: [{ txid: 'aaa', vout: 0 }],
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await createTransaction('wallet-1', request);

      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/transactions/create', request);
      expect(result.psbtBase64).toBe('cHNidP8B...');
      expect(result.fee).toBe(1130);
    });

    it('should include optional fields', async () => {
      const request = {
        recipient: 'tb1qtest',
        amount: 50000,
        feeRate: 10,
        selectedUtxoIds: ['txid1:0'],
        label: 'Payment',
        memo: 'For services',
        sendMax: false,
        decoyOutputs: { enabled: true, count: 2 },
      };
      mockPost.mockResolvedValue({});

      await createTransaction('wallet-1', request);

      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/transactions/create', request);
    });
  });

  describe('broadcastTransaction', () => {
    it('should POST broadcast request with signed PSBT', async () => {
      const request = {
        signedPsbtBase64: 'cHNidP8B...',
        recipient: 'tb1qtest',
        amount: 50000,
        fee: 1130,
        utxos: [{ txid: 'aaa', vout: 0 }],
      };
      mockPost.mockResolvedValue({ txid: 'broadcasted-txid', broadcasted: true });

      const result = await broadcastTransaction('wallet-1', request);

      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/transactions/broadcast', request);
      expect(result.txid).toBe('broadcasted-txid');
      expect(result.broadcasted).toBe(true);
    });

    it('should support raw transaction hex (Trezor)', async () => {
      const request = {
        rawTxHex: '020000000001...',
        recipient: 'tb1qtest',
        amount: 50000,
        fee: 500,
        utxos: [{ txid: 'bbb', vout: 1 }],
      };
      mockPost.mockResolvedValue({ txid: 'raw-txid', broadcasted: true });

      await broadcastTransaction('wallet-1', request);
      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/transactions/broadcast', request);
    });
  });

  describe('estimateTransaction', () => {
    it('should POST estimate request', async () => {
      const request = {
        recipient: 'tb1qtest',
        amount: 50000,
        feeRate: 10,
      };
      mockPost.mockResolvedValue({
        fee: 1130,
        totalCost: 51130,
        inputCount: 1,
        outputCount: 2,
        changeAmount: 48870,
        sufficient: true,
      });

      const result = await estimateTransaction('wallet-1', request);

      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/transactions/estimate', request);
      expect(result.sufficient).toBe(true);
      expect(result.fee).toBe(1130);
    });
  });

  describe('createBatchTransaction', () => {
    it('should POST batch transaction with multiple outputs', async () => {
      const request = {
        outputs: [
          { address: 'tb1q1', amount: 10000 },
          { address: 'tb1q2', amount: 20000 },
        ],
        feeRate: 5,
      };
      mockPost.mockResolvedValue({
        psbtBase64: 'batch...',
        fee: 800,
        outputs: request.outputs,
      });

      const result = await createBatchTransaction('wallet-1', request);

      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/transactions/batch', request);
      expect(result.psbtBase64).toBe('batch...');
    });
  });

  // ========================================
  // Aggregate endpoints
  // ========================================
  describe('getRecentTransactions', () => {
    it('should call aggregate endpoint with limit', async () => {
      mockGet.mockResolvedValue([]);
      await getRecentTransactions(5);
      expect(mockGet).toHaveBeenCalledWith('/transactions/recent', { limit: 5 });
    });

    it('should pass walletIds filter', async () => {
      mockGet.mockResolvedValue([]);
      await getRecentTransactions(10, ['w1', 'w2']);
      expect(mockGet).toHaveBeenCalledWith('/transactions/recent', {
        limit: 10,
        walletIds: 'w1,w2',
      });
    });

    it('should default to 10 when no limit specified', async () => {
      mockGet.mockResolvedValue([]);
      await getRecentTransactions();
      expect(mockGet).toHaveBeenCalledWith('/transactions/recent', { limit: 10 });
    });
  });

  describe('getAllPendingTransactions', () => {
    it('should call aggregate pending endpoint', async () => {
      mockGet.mockResolvedValue([]);
      await getAllPendingTransactions();
      expect(mockGet).toHaveBeenCalledWith('/transactions/pending');
    });
  });

  describe('getBalanceHistory', () => {
    it('should call balance history with timeframe', async () => {
      mockGet.mockResolvedValue([]);
      await getBalanceHistory('1W', 500000);
      expect(mockGet).toHaveBeenCalledWith('/transactions/balance-history', {
        timeframe: '1W',
        totalBalance: 500000,
      });
    });

    it('should pass walletIds filter', async () => {
      mockGet.mockResolvedValue([]);
      await getBalanceHistory('1M', 1000000, ['w1']);
      expect(mockGet).toHaveBeenCalledWith('/transactions/balance-history', {
        timeframe: '1M',
        totalBalance: 1000000,
        walletIds: 'w1',
      });
    });
  });

  // ========================================
  // Privacy scoring
  // ========================================
  describe('Privacy API', () => {
    it('should get wallet privacy analysis', async () => {
      mockGet.mockResolvedValue({ utxos: [], summary: {} });
      await getWalletPrivacy('wallet-1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/privacy');
    });

    it('should get single UTXO privacy score', async () => {
      mockGet.mockResolvedValue({ score: 85, grade: 'good' });
      await getUtxoPrivacy('utxo-1');
      expect(mockGet).toHaveBeenCalledWith('/utxos/utxo-1/privacy');
    });

    it('should POST spend privacy analysis', async () => {
      mockPost.mockResolvedValue({ score: 70, linkedAddresses: 2 });
      await analyzeSpendPrivacy('wallet-1', ['utxo-1', 'utxo-2']);
      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/privacy/spend-analysis', {
        utxoIds: ['utxo-1', 'utxo-2'],
      });
    });
  });

  // ========================================
  // UTXO selection
  // ========================================
  describe('UTXO Selection API', () => {
    it('should POST UTXO selection request', async () => {
      const request = { amount: 50000, feeRate: 10, strategy: 'largest_first' as const };
      mockPost.mockResolvedValue({ selected: [], totalAmount: 0 });
      await selectUtxos('wallet-1', request);
      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/utxos/select', request);
    });

    it('should POST strategy comparison', async () => {
      mockPost.mockResolvedValue({});
      await compareStrategies('wallet-1', 50000, 10);
      expect(mockPost).toHaveBeenCalledWith('/wallets/wallet-1/utxos/compare-strategies', {
        amount: 50000,
        feeRate: 10,
        scriptType: undefined,
      });
    });

    it('should GET recommended strategy', async () => {
      mockGet.mockResolvedValue({ strategy: 'largest_first', reason: 'Optimal' });
      await getRecommendedStrategy('wallet-1', 10);
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/utxos/recommended-strategy', {
        feeRate: '10',
      });
    });

    it('should pass privacy preference for recommended strategy', async () => {
      mockGet.mockResolvedValue({ strategy: 'branch_and_bound' });
      await getRecommendedStrategy('wallet-1', 10, true);
      expect(mockGet).toHaveBeenCalledWith('/wallets/wallet-1/utxos/recommended-strategy', {
        feeRate: '10',
        prioritizePrivacy: 'true',
      });
    });
  });
});
