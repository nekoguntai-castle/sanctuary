/**
 * Tests for address routes (pagination and summary).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: any) => {
    req.walletId = req.params.walletId || req.params.id;
    next();
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import addressesRouter from '../../../src/api/transactions/addresses';

describe('Address Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', addressesRouter);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  it('should apply pagination and return balances', async () => {
    const walletId = 'wallet-123';
    const xpub = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
    const descriptor = `wpkh([73c5da0a/84'/1'/0']${xpub}/0/*)`;
    const changeDescriptor = `wpkh([73c5da0a/84'/1'/0']${xpub}/1/*)`;

    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      type: 'single_sig',
      scriptType: 'native_segwit',
      descriptor,
      changeDescriptor,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      network: 'testnet3',
      devices: [{ device: { type: 'coldcard', model: null } }],
    });

    mockPrismaClient.address.findMany.mockResolvedValue([
      {
        id: 'addr-1',
        walletId,
        address: 'tb1qd7spv5q28348xl4myc8zmh983w5jx32cjhkn97',
        derivationPath: "m/84'/1'/0'/0/1",
        index: 1,
        used: false,
        branch: 0,
        coordinateVersion: 1,
        canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
        canonicalPolicyVersion: 1,
        scriptPubKey: '00146fa016500a3c6a737ebb260e2ddca78ba9234558',
        addressLabels: [
          { label: { id: 'label-1', name: 'Savings', color: '#00FFAA' } },
        ],
        createdAt: new Date(),
      },
    ]);

    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      {
        address: 'tb1qd7spv5q28348xl4myc8zmh983w5jx32cjhkn97',
        amount: BigInt(1200),
      },
    ]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/addresses`)
      .query({ limit: 1, offset: 1 });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        skip: 1,
      })
    );
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      address: 'tb1qd7spv5q28348xl4myc8zmh983w5jx32cjhkn97',
      balance: 1200,
      isChange: false,
    });
    expect(response.body[0].labels).toHaveLength(1);
  });

  it('should return summary counts and balances', async () => {
    const walletId = 'wallet-456';

    mockPrismaClient.address.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _sum: { amount: BigInt(5000) },
    });

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { used: true, balance: BigInt(4000) },
      { used: false, balance: BigInt(1000) },
    ]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/addresses/summary`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalAddresses: 3,
      usedCount: 1,
      unusedCount: 2,
      totalBalance: 5000,
      usedBalance: 4000,
      unusedBalance: 1000,
    });
  });
});
