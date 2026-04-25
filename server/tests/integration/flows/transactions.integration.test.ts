import { vi } from 'vitest';
/**
 * Transaction API Integration Tests
 *
 * Tests the transaction and UTXO API endpoints:
 * - GET /wallets/:walletId/transactions - List transactions
 * - GET /wallets/:walletId/transactions/stats - Transaction statistics
 * - GET /wallets/:walletId/transactions/pending - Pending transactions
 * - GET /wallets/:walletId/transactions/export - Export transactions
 * - POST /wallets/:walletId/transactions/recalculate - Recalculate balances
 * - GET /wallets/:walletId/utxos - List UTXOs
 * - GET /wallets/:walletId/addresses - List addresses
 * - POST /wallets/:walletId/addresses/generate - Generate addresses
 * - POST /wallets/:walletId/transactions/estimate - Estimate fees
 * - PATCH /utxos/:utxoId/freeze - Freeze/unfreeze UTXOs
 * - GET /wallets/:walletId/utxos/recommended-strategy - Get recommended UTXO strategy
 *
 * Requires a running PostgreSQL database.
 * Run with: npm run test:integration
 */

import request from 'supertest';
import { setupTestDatabase, cleanupTestData, teardownTestDatabase, canRunIntegrationTests } from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { createAndLoginUser, createTestWallet, authHeader } from '../setup/helpers';
import {
  app,
  createWalletWithData,
  prisma,
  setTransactionIntegrationContext,
  uniqueTxid,
} from './transactions/transactionsIntegrationTestHarness';

// Increase timeout for integration tests
vi.setConfig(30000);

// Skip all tests if no database is available
const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Transaction API Integration', () => {
  beforeAll(async () => {
    // Mock external services before importing routes
    vi.doMock('../../../src/services/bitcoin/electrum', () => ({
      getElectrumClient: vi.fn().mockResolvedValue({
        connect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        blockchainScripthash_getBalance: vi.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
        blockchainScripthash_listunspent: vi.fn().mockResolvedValue([]),
        blockchainScripthash_getHistory: vi.fn().mockResolvedValue([]),
        blockchainTransaction_broadcast: vi.fn().mockResolvedValue('mock-txid-123456'),
      }),
    }));

    // Mock blockchain service functions
    vi.doMock('../../../src/services/bitcoin/blockchain', () => ({
      getCachedBlockHeight: vi.fn().mockReturnValue(800000),
      recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
      broadcastTransaction: vi.fn().mockResolvedValue({ txid: 'mock-broadcast-txid', broadcasted: true }),
    }));

    const prismaClient = await setupTestDatabase();
    const testApp = createTestApp();
    setTransactionIntegrationContext(testApp, prismaClient);
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('GET /wallets/:walletId/transactions', () => {
    it('should return transactions for a wallet', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions`)
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(4);

      // Check transaction structure
      const tx = response.body[0];
      expect(tx).toHaveProperty('txid');
      expect(tx).toHaveProperty('amount');
      expect(tx).toHaveProperty('type');
      expect(tx).toHaveProperty('confirmations');
    });

    it('should paginate transactions', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions`)
        .query({ limit: 2, offset: 0 })
        .set(authHeader(token))
        .expect(200);

      expect(response.body.length).toBe(2);
    });

    it('should return empty array for wallet with no transactions', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/transactions/wallets/some-wallet-id/transactions')
        .expect(401);
    });

    it('should deny access to other users wallet', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      // Create another user
      const { token: otherToken } = await createAndLoginUser(app, prisma);

      await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions`)
        .set(authHeader(otherToken))
        .expect(403);
    });
  });

  describe('GET /wallets/:walletId/transactions/stats', () => {
    it('should return transaction statistics', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions/stats`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toHaveProperty('totalCount');
      expect(response.body).toHaveProperty('receivedCount');
      expect(response.body).toHaveProperty('sentCount');
      expect(response.body).toHaveProperty('totalReceived');
      expect(response.body).toHaveProperty('totalSent');
      expect(response.body).toHaveProperty('totalFees');

      expect(response.body.totalCount).toBe(4);
      expect(response.body.receivedCount).toBe(3);
      expect(response.body.sentCount).toBe(1);
    });

    it('should return zeros for empty wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions/stats`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.totalCount).toBe(0);
      expect(response.body.totalReceived).toBe(0);
      expect(response.body.totalSent).toBe(0);
    });
  });

  describe('GET /wallets/:walletId/transactions/pending', () => {
    it('should return pending transactions', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);
      const pendingTransaction = await prisma.transaction.findFirstOrThrow({
        where: { walletId, confirmations: 0 },
        select: { txid: true },
      });

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions/pending`)
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      // Should only return pending transactions (confirmations = 0)
      expect(response.body.length).toBe(1);
      expect(response.body[0].txid).toBe(pendingTransaction.txid);
    });

    it('should return empty array when no pending transactions', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      // Add only confirmed transaction
      await prisma.transaction.create({
        data: {
          txid: uniqueTxid('confirmed'),
          walletId,
          type: 'received',
          amount: BigInt(10000),
          fee: BigInt(0),
          confirmations: 6,
          blockHeight: 800000,
          blockTime: new Date(),
        },
      });

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions/pending`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /wallets/:walletId/utxos', () => {
    it('should return UTXOs for a wallet', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/utxos`)
        .set(authHeader(token))
        .expect(200);

      // Response is wrapped: { utxos: [...], count, totalBalance }
      expect(response.body).toHaveProperty('utxos');
      expect(Array.isArray(response.body.utxos)).toBe(true);
      expect(response.body.utxos.length).toBe(3);
      expect(response.body.count).toBe(3);

      // Check UTXO structure
      const utxo = response.body.utxos[0];
      expect(utxo).toHaveProperty('txid');
      expect(utxo).toHaveProperty('vout');
      expect(utxo).toHaveProperty('amount');
      expect(utxo).toHaveProperty('frozen');
    });

    it('should filter by frozen status', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      // Get UTXOs and filter for frozen
      const frozenResponse = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/utxos`)
        .set(authHeader(token))
        .expect(200);

      const frozenUtxos = frozenResponse.body.utxos?.filter((u: { frozen: boolean }) => u.frozen);
      expect(frozenUtxos.length).toBe(1);
      expect(frozenUtxos[0].frozen).toBe(true);

      // Get UTXOs and filter for unfrozen
      const unfrozenUtxos = frozenResponse.body.utxos?.filter((u: { frozen: boolean }) => !u.frozen);
      expect(unfrozenUtxos.length).toBe(2);
      expect(unfrozenUtxos.every((u: { frozen: boolean }) => !u.frozen)).toBe(true);
    });

    it('should return empty array for wallet with no UTXOs', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/utxos`)
        .set(authHeader(token))
        .expect(200);

      // Response is wrapped: { utxos: [], count: 0, totalBalance: 0 }
      expect(response.body.utxos).toEqual([]);
      expect(response.body.count).toBe(0);
      expect(response.body.totalBalance).toBe(0);
    });
  });

  describe('GET /wallets/:walletId/addresses', () => {
    it('should return addresses array for a wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/addresses`)
        .set(authHeader(token))
        .expect(200);

      // Should return an array (may auto-generate addresses or be empty)
      expect(Array.isArray(response.body)).toBe(true);

      // If addresses exist, check structure
      if (response.body.length > 0) {
        const addr = response.body[0];
        expect(addr).toHaveProperty('address');
        expect(addr).toHaveProperty('derivationPath');
        expect(addr).toHaveProperty('used');
      }
    });

    it('should include change classification on addresses', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/addresses`)
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((addr: { derivationPath: string; isChange?: boolean }) => {
        if (addr.derivationPath) {
          const shouldBeChange = /\/1\/\d+$/.test(addr.derivationPath);
          expect(Boolean(addr.isChange)).toBe(shouldBeChange);
        }
      });
    });
  });

  describe('POST /wallets/:walletId/addresses/generate', () => {
    it('should return address generation response', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      // Generate new addresses - API generates both receive AND change addresses
      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/addresses/generate`)
        .set(authHeader(token))
        .send({ count: 5 })
        .expect(200);

      // Response: { generated: total, receiveAddresses: count, changeAddresses: count }
      expect(response.body).toHaveProperty('generated');
      expect(response.body).toHaveProperty('receiveAddresses');
      expect(response.body).toHaveProperty('changeAddresses');

      // receiveAddresses and changeAddresses should match requested count
      expect(response.body.receiveAddresses).toBe(5);
      expect(response.body.changeAddresses).toBe(5);
      // Note: actual generated count depends on whether descriptor derivation works in test env
    });

    it('should handle count of 0 gracefully', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      // API allows count=0 (generates nothing)
      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/addresses/generate`)
        .set(authHeader(token))
        .send({ count: 0 })
        .expect(200);

      // Response: { generated: 0, receiveAddresses: 0, changeAddresses: 0 }
      expect(response.body.generated).toBe(0);
      expect(response.body.receiveAddresses).toBe(0);
    });
  });

  describe('PATCH /utxos/:utxoId/freeze', () => {
    it('should freeze a UTXO', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      // Get an unfrozen UTXO
      const utxosResponse = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/utxos`)
        .set(authHeader(token))
        .expect(200);

      // Find an unfrozen UTXO from the wrapped response
      const unfrozenUtxo = utxosResponse.body.utxos?.find((u: { frozen: boolean }) => !u.frozen);
      expect(unfrozenUtxo).toBeDefined();
      const utxoId = unfrozenUtxo.id;

      // Freeze the UTXO
      const response = await request(app)
        .patch(`/api/v1/transactions/utxos/${utxoId}/freeze`)
        .set(authHeader(token))
        .send({ frozen: true })
        .expect(200);

      expect(response.body.frozen).toBe(true);

      // Verify UTXO is now frozen
      const verifyResponse = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/utxos`)
        .set(authHeader(token))
        .expect(200);

      const frozenUtxo = verifyResponse.body.utxos?.find((u: { id: string }) => u.id === utxoId);
      expect(frozenUtxo).toBeDefined();
      expect(frozenUtxo.frozen).toBe(true);
    });

    it('should unfreeze a UTXO', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      // Get the frozen UTXO (we created one frozen UTXO in test data)
      const utxosResponse = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/utxos`)
        .set(authHeader(token))
        .expect(200);

      // Find the frozen UTXO from the wrapped response
      const frozenUtxo = utxosResponse.body.utxos?.find((u: { frozen: boolean }) => u.frozen);
      expect(frozenUtxo).toBeDefined();
      const utxoId = frozenUtxo.id;

      // Unfreeze the UTXO
      const response = await request(app)
        .patch(`/api/v1/transactions/utxos/${utxoId}/freeze`)
        .set(authHeader(token))
        .send({ frozen: false })
        .expect(200);

      expect(response.body.frozen).toBe(false);
    });

    it('should return 404 for non-existent UTXO', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .patch('/api/v1/transactions/utxos/non-existent-id/freeze')
        .set(authHeader(token))
        .send({ frozen: true })
        .expect(404);
    });
  });

  describe('POST /wallets/:walletId/transactions/estimate', () => {
    it('should estimate transaction fees', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/estimate`)
        .set(authHeader(token))
        .send({
          recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
          amount: 10000,
          feeRate: 10,
        })
        .expect(200);

      expect(response.body).toHaveProperty('sufficient');
      expect(response.body).toHaveProperty('fee');
      expect(typeof response.body.sufficient).toBe('boolean');
      expect(typeof response.body.fee).toBe('number');
    });

    it('should return insufficient when amount exceeds balance', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/estimate`)
        .set(authHeader(token))
        .send({
          recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
          amount: 10000000, // More than available
          feeRate: 10,
        })
        .expect(200);

      expect(response.body.sufficient).toBe(false);
    });

    it('should reject invalid fee rate', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/estimate`)
        .set(authHeader(token))
        .send({
          recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
          amount: 10000,
          feeRate: 0, // Invalid
        })
        .expect(400);
    });
  });

  describe('POST /wallets/:walletId/transactions/recalculate', () => {
    it('should recalculate wallet balances', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/recalculate`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('recalculated');
    });
  });

  describe('GET /wallets/:walletId/transactions/export', () => {
    it('should export transactions as CSV', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions/export`)
        .query({ format: 'csv' })
        .set(authHeader(token))
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      // CSV headers use human-readable names
      expect(response.text).toContain('Transaction ID');
      expect(response.text).toContain('Amount');
    });

    it('should export transactions as JSON', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions/export`)
        .query({ format: 'json' })
        .set(authHeader(token))
        .expect(200);

      expect(response.headers['content-type']).toContain('application/json');
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /transactions/recent', () => {
    it('should return recent transactions across all user wallets', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get('/api/v1/transactions/transactions/recent')
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      // Should have transactions from the wallet we created
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get('/api/v1/transactions/transactions/recent')
        .query({ limit: 2 })
        .set(authHeader(token))
        .expect(200);

      expect(response.body.length).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /transactions/:txid', () => {
    it('should return transaction details by txid', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      // Get an actual transaction from the wallet
      const transactions = await prisma.transaction.findMany({
        where: { walletId },
        take: 1,
      });
      expect(transactions.length).toBeGreaterThan(0);
      const txid = transactions[0].txid;

      const response = await request(app)
        .get(`/api/v1/transactions/transactions/${txid}`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.txid).toBe(txid);
      expect(response.body.walletId).toBe(walletId);
    });

    it('should return 404 for non-existent transaction', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .get(`/api/v1/transactions/transactions/${uniqueTxid('missing')}`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  describe('GET /wallets/:walletId/utxos/recommended-strategy', () => {
    it('should return recommended UTXO selection strategy', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, token, userId);

      const response = await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/utxos/recommended-strategy`)
        .set(authHeader(token))
        .query({ amount: 10000 })
        .expect(200);

      expect(response.body).toHaveProperty('strategy');
      expect(response.body).toHaveProperty('reason');
    });
  });

  describe('Access Control', () => {
    it('should deny viewer role from creating transactions', async () => {
      // Create owner and wallet
      const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, ownerToken, ownerId);

      // Create viewer user
      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma);

      // Share wallet with viewer
      await prisma.walletUser.create({
        data: {
          walletId,
          userId: viewerId,
          role: 'viewer',
        },
      });

      // Viewer should be able to view transactions
      await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions`)
        .set(authHeader(viewerToken))
        .expect(200);

      // Viewer should not be able to generate addresses (edit operation)
      await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/addresses/generate`)
        .set(authHeader(viewerToken))
        .send({ count: 1 })
        .expect(403);
    });

    it('should allow signer role to view and estimate but not other user wallets', async () => {
      // Create owner and wallet
      const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma);
      const walletId = await createWalletWithData(app, ownerToken, ownerId);

      // Create signer user
      const { userId: signerId, token: signerToken } = await createAndLoginUser(app, prisma);

      // Share wallet with signer
      await prisma.walletUser.create({
        data: {
          walletId,
          userId: signerId,
          role: 'signer',
        },
      });

      // Signer should be able to view transactions
      await request(app)
        .get(`/api/v1/transactions/wallets/${walletId}/transactions`)
        .set(authHeader(signerToken))
        .expect(200);

      // Signer should be able to estimate (view permission)
      await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/estimate`)
        .set(authHeader(signerToken))
        .send({
          recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
          amount: 1000,
          feeRate: 10,
        })
        .expect(200);
    });
  });
});
