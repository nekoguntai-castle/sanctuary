import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const mocks = vi.hoisted(() => ({ getUserWallets: vi.fn() }));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return { __esModule: true, default: prisma };
});
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../src/services/wallet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/wallet')>()),
  getUserWallets: mocks.getUserWallets,
}));
vi.mock('../../../src/services/cache', () => ({ walletCache: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../../src/services/bitcoin/blockchain', () => ({ getCachedBlockHeight: vi.fn() }));

import crudRouter from '../../../src/api/wallets/crud';
import crossWalletRouter from '../../../src/api/transactions/crossWallet';
import transactionDetailRouter from '../../../src/api/transactions/transactionDetail';
import { errorHandler } from '../../../src/errors/errorHandler';

const GATEWAY = { 'X-Gateway-Request': 'true' };
const TXID = 'a'.repeat(64);

const permissionRow = (walletId: string, overrides: Record<string, unknown> = {}) => ({
  walletId,
  userId: 'user-1',
  canViewBalance: true,
  canViewTransactions: true,
  canViewUtxos: true,
  canCreateTransaction: true,
  canBroadcast: true,
  canSignPsbt: true,
  canGenerateAddress: true,
  canManageLabels: true,
  canManageDevices: true,
  canShareWallet: true,
  canDeleteWallet: true,
  canApproveTransaction: true,
  canManagePolicies: true,
  ownerMaxPermissions: null,
  ...overrides,
});

const pendingTx = (walletId: string, txid: string) => ({
  txid, walletId, type: 'received', amount: BigInt(1000), fee: BigInt(100), rawTx: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('mobile view caps on cross-wallet routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice' };
      next();
    });
    app.use('/api/v1/wallets', crudRouter);
    app.use('/api/v1', crossWalletRouter);
    app.use('/api/v1', transactionDetailRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockPrismaClient.mobilePermission.findMany.mockResolvedValue([]);
  });

  describe('GET /wallets', () => {
    const wallets = () => [
      { id: 'w1', name: 'Capped', balance: 5000, userRole: 'viewer' },
      { id: 'w2', name: 'Open', balance: 7000, userRole: 'owner' },
    ];

    it('redacts the balance of wallets whose viewBalance cap is off for gateway requests', async () => {
      mocks.getUserWallets.mockResolvedValue(wallets());
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewBalance: false }),
      ]);

      const response = await request(app).get('/api/v1/wallets').set(GATEWAY);

      expect(response.status).toBe(200);
      expect(response.body[0]).toMatchObject({ id: 'w1', balance: 0, balanceHidden: true });
      expect(response.body[1]).toMatchObject({ id: 'w2', balance: 7000 });
      expect(response.body[1]).not.toHaveProperty('balanceHidden');
    });

    it('leaves the list unchanged without the gateway header', async () => {
      mocks.getUserWallets.mockResolvedValue(wallets());
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewBalance: false }),
      ]);

      const response = await request(app).get('/api/v1/wallets');

      expect(response.body).toEqual(JSON.parse(JSON.stringify(wallets())));
      expect(mockPrismaClient.mobilePermission.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /transactions/pending', () => {
    beforeEach(() => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'w1', name: 'Capped' },
        { id: 'w2', name: 'Open' },
      ]);
      mockPrismaClient.transaction.findMany.mockResolvedValue([pendingTx('w2', 'b'.repeat(64))]);
    });

    it('queries only wallets whose viewTransactions cap is on for gateway requests', async () => {
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewTransactions: false }),
      ]);

      const response = await request(app).get('/api/v1/transactions/pending').set(GATEWAY);

      expect(response.status).toBe(200);
      expect(mockPrismaClient.transaction.findMany.mock.calls[0][0].where.walletId).toEqual({ in: ['w2'] });
    });

    it('returns an empty list when every wallet is capped', async () => {
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewTransactions: false }),
        permissionRow('w2', { canViewTransactions: false }),
      ]);

      const response = await request(app).get('/api/v1/transactions/pending').set(GATEWAY);

      expect(response.body).toEqual([]);
      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
    });

    it('queries every accessible wallet without the gateway header', async () => {
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewTransactions: false }),
      ]);

      await request(app).get('/api/v1/transactions/pending');

      expect(mockPrismaClient.transaction.findMany.mock.calls[0][0].where.walletId).toEqual({ in: ['w1', 'w2'] });
    });
  });

  describe('GET /transactions/:txid (legacy)', () => {
    const match = (walletId: string) => ({
      id: `tx-${walletId}`, txid: TXID, walletId, type: 'received', amount: BigInt(1000), fee: null,
      wallet: { id: walletId, name: walletId, type: 'single_sig' }, address: null,
      transactionLabels: [], inputs: [], outputs: [],
    });

    it('denies with the gateway body when the only match is capped', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([match('w1')]);
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewTransactions: false }),
      ]);

      const response = await request(app).get(`/api/v1/transactions/${TXID}`).set(GATEWAY);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: 'Forbidden',
        message: 'Mobile access denied for action: viewTransactions',
      });
    });

    it('returns the permitted row instead of 409 when another match is capped', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([match('w1'), match('w2')]);
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewTransactions: false }),
      ]);

      const response = await request(app).get(`/api/v1/transactions/${TXID}`).set(GATEWAY);

      expect(response.status).toBe(200);
      expect(response.body.walletId).toBe('w2');
    });

    it('keeps the 409 when several matches are permitted', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([match('w1'), match('w2')]);

      const response = await request(app).get(`/api/v1/transactions/${TXID}`).set(GATEWAY);

      expect(response.status).toBe(409);
    });

    it('is unchanged without the gateway header', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([match('w1'), match('w2')]);
      mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
        permissionRow('w1', { canViewTransactions: false }),
      ]);

      const response = await request(app).get(`/api/v1/transactions/${TXID}`);

      expect(response.status).toBe(409);
    });

    it('still returns 404 for an unknown txid on a gateway request', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const response = await request(app).get(`/api/v1/transactions/${TXID}`).set(GATEWAY);

      expect(response.status).toBe(404);
    });
  });
});
