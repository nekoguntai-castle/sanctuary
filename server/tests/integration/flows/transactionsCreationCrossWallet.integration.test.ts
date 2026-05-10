import { vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '../../../src/generated/prisma/client';
import {
  setupTestDatabase,
  cleanupTestData,
  teardownTestDatabase,
  canRunIntegrationTests,
} from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { createAndLoginUser, createTestWallet, authHeader } from '../setup/helpers';

const mockValidateAddress = vi.fn();
const mockCreateTransaction = vi.fn();
const mockCreateBatchTransaction = vi.fn();
const mockBroadcastAndSave = vi.fn();
const mockEstimateTransaction = vi.fn();
const mockGetPSBTInfoWithNetwork = vi.fn();
const mockGetCachedBlockHeight = vi.fn();
const mockAuditLogFromRequest = vi.fn();

vi.mock('../../../src/services/bitcoin/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/bitcoin/utils')>(
    '../../../src/services/bitcoin/utils'
  );
  return {
    ...actual,
    validateAddress: (...args: unknown[]) => mockValidateAddress(...args),
  };
});

vi.mock('../../../src/services/bitcoin/transactionService', () => ({
  createTransaction: (...args: unknown[]) => mockCreateTransaction(...args),
  createBatchTransaction: (...args: unknown[]) => mockCreateBatchTransaction(...args),
  broadcastAndSave: (...args: unknown[]) => mockBroadcastAndSave(...args),
  estimateTransaction: (...args: unknown[]) => mockEstimateTransaction(...args),
  getPSBTInfoWithNetwork: (...args: unknown[]) => mockGetPSBTInfoWithNetwork(...args),
}));

vi.mock('../../../src/services/bitcoin/blockchain', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/bitcoin/blockchain')>(
    '../../../src/services/bitcoin/blockchain'
  );
  return {
    ...actual,
    getCachedBlockHeight: (...args: unknown[]) => mockGetCachedBlockHeight(...args),
  };
});

vi.mock('../../../src/services/auditService', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/auditService')>(
    '../../../src/services/auditService'
  );

  const auditService = Object.assign(
    Object.create(Object.getPrototypeOf(actual.auditService)),
    actual.auditService,
    {
      logFromRequest: (...args: unknown[]) => mockAuditLogFromRequest(...args),
    }
  );

  return {
    ...actual,
    auditService,
  };
});

vi.setConfig({ testTimeout: 30000 });

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Transaction Creation and Cross-Wallet Integration', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    app = createTestApp();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await cleanupTestData();
    vi.clearAllMocks();

    mockValidateAddress.mockReturnValue({ valid: true });
    mockGetCachedBlockHeight.mockReturnValue(800000);
    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockEstimateTransaction.mockResolvedValue({
      fee: 500,
      totalInput: 150000,
      totalOutput: 149500,
      vsize: 140,
      feeRate: 3.5,
      sufficient: true,
    });
  });

  function uniqueTxid(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 18);
    return `${prefix}${random}`.padEnd(64, '0').slice(0, 64);
  }

  describe('creation endpoints', () => {
    it('creates a transaction PSBT', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      mockCreateTransaction.mockResolvedValue({
        psbtBase64: 'cHNidP8BAHECAAAAAQ==',
        fee: 420,
        totalInput: 100000,
        totalOutput: 99580,
        changeAmount: 49580,
        changeAddress: 'tb1qchangeaddress00000000000000000000000000',
        utxos: [{ txid: uniqueTxid('utxo'), vout: 0, amount: 100000 }],
        inputPaths: { '0': "m/84'/1'/0'/0/0" },
        effectiveAmount: 50000,
        decoyOutputs: [],
      });

      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/create`)
        .set(authHeader(token))
        .send({
          recipient: 'tb1qrecipient00000000000000000000000000000000',
          amount: 50000,
          feeRate: 2,
          enableRBF: true,
          sendMax: false,
          subtractFees: false,
        })
        .expect(200);

      expect(response.body.psbtBase64).toBe('cHNidP8BAHECAAAAAQ==');
      expect(mockCreateTransaction).toHaveBeenCalledWith(
        walletId,
        'tb1qrecipient00000000000000000000000000000000',
        50000,
        2,
        expect.objectContaining({
          enableRBF: true,
          sendMax: false,
          subtractFees: false,
        })
      );
    });

    it('rejects batch create with more than one sendMax output', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/batch`)
        .set(authHeader(token))
        .send({
          feeRate: 2,
          outputs: [
            { address: 'tb1qout100000000000000000000000000000000000', sendMax: true },
            { address: 'tb1qout200000000000000000000000000000000000', sendMax: true },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain('Only one output can have sendMax');
      expect(mockCreateBatchTransaction).not.toHaveBeenCalled();
    });

    it('broadcasts a signed transaction and writes audit log', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      mockBroadcastAndSave.mockResolvedValue({
        txid: uniqueTxid('broadcast'),
        saved: true,
      });
      mockGetPSBTInfoWithNetwork.mockReturnValue({
        fee: 250,
        outputs: [{ address: 'tb1qrecipient00000000000000000000000000000000', value: 25000 }],
        inputs: [{ txid: uniqueTxid('input'), vout: 0 }],
      });

      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/transactions/broadcast`)
        .set(authHeader(token))
        .send({
          signedPsbtBase64: 'cHNidP8BAHECAAAAAQ==',
          recipient: 'tb1qrecipient00000000000000000000000000000000',
          amount: 25000,
          fee: 250,
        })
        .expect(200);

      expect(response.body).toHaveProperty('txid');
      expect(mockGetPSBTInfoWithNetwork).toHaveBeenCalledWith('cHNidP8BAHECAAAAAQ==', 'testnet3');
      expect(mockBroadcastAndSave).toHaveBeenCalledWith(
        walletId,
        'cHNidP8BAHECAAAAAQ==',
        expect.objectContaining({
          recipient: 'tb1qrecipient00000000000000000000000000000000',
          amount: 25000,
          fee: 250,
        })
      );
      expect(mockAuditLogFromRequest).toHaveBeenCalled();
    });

    it('creates hardware-wallet PSBT payload', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      mockCreateTransaction.mockResolvedValue({
        psbtBase64: 'hardware-psbt',
        fee: 300,
        totalInput: 90000,
        totalOutput: 89700,
        changeAmount: 39700,
        changeAddress: 'tb1qchange000000000000000000000000000000000',
        utxos: [],
        inputPaths: {},
        effectiveAmount: 50000,
      });

      const response = await request(app)
        .post(`/api/v1/transactions/wallets/${walletId}/psbt/create`)
        .set(authHeader(token))
        .send({
          recipients: [{ address: 'tb1qrecipient00000000000000000000000000000000', amount: 50000 }],
          feeRate: 2,
          utxoIds: ['utxo-1'],
        })
        .expect(200);

      expect(response.body.psbt).toBe('hardware-psbt');
      expect(response.body.fee).toBe(300);
      expect(mockCreateTransaction).toHaveBeenCalledWith(
        walletId,
        'tb1qrecipient00000000000000000000000000000000',
        50000,
        2,
        expect.objectContaining({
          selectedUtxoIds: ['utxo-1'],
        })
      );
    });
  });

  describe('cross-wallet aggregate endpoints', () => {
    it('returns pending transactions across wallets sorted by fee rate', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletA } = await createTestWallet(app, token, { name: 'Wallet A' });
      const { id: walletB } = await createTestWallet(app, token, { name: 'Wallet B' });

      await prisma.transaction.createMany({
        data: [
          {
            txid: uniqueTxid('penda'),
            walletId: walletA,
            type: 'sent',
            amount: BigInt(-20000),
            fee: BigInt(1000),
            blockHeight: null,
            rawTx: 'aa'.repeat(100), // 100 bytes -> feeRate 10
          },
          {
            txid: uniqueTxid('pendb'),
            walletId: walletB,
            type: 'sent',
            amount: BigInt(-30000),
            fee: BigInt(1000),
            blockHeight: null,
            rawTx: 'bb'.repeat(200), // 200 bytes -> feeRate 5
          },
        ],
      });

      const response = await request(app)
        .get('/api/v1/transactions/transactions/pending')
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].feeRate).toBeGreaterThan(response.body[1].feeRate);
      expect(response.body[0].walletName).toBe('Wallet A');
      expect(response.body[1].walletName).toBe('Wallet B');
    });

    it('returns aggregated balance-history data across accessible wallets', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletA } = await createTestWallet(app, token, { name: 'Wallet A' });
      const { id: walletB } = await createTestWallet(app, token, { name: 'Wallet B' });

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      await prisma.transaction.createMany({
        data: [
          {
            txid: uniqueTxid('hist1'),
            walletId: walletA,
            type: 'received',
            amount: BigInt(20000),
            fee: BigInt(0),
            blockHeight: 799999,
            blockTime: yesterday,
          },
          {
            txid: uniqueTxid('hist2'),
            walletId: walletB,
            type: 'sent',
            amount: BigInt(-5000),
            fee: BigInt(200),
            blockHeight: 799998,
            blockTime: twoDaysAgo,
          },
        ],
      });

      const totalBalance = 120000;
      const response = await request(app)
        .get('/api/v1/transactions/transactions/balance-history')
        .query({ timeframe: '1W', totalBalance })
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
      expect(response.body[response.body.length - 1]).toEqual({ name: 'Now', value: totalBalance });
      expect(response.body.some((point: { value: number }) => point.value < totalBalance)).toBe(true);
    });
  });
});
