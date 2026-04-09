import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const { mockDeriveAddressFromDescriptor } = vi.hoisted(() => ({
  mockDeriveAddressFromDescriptor: vi.fn(),
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId || req.params.id;
    next();
  },
}));

vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: mockDeriveAddressFromDescriptor,
}));

vi.mock('../../../src/constants', () => ({
  INITIAL_ADDRESS_COUNT: 2,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { errorHandler } from '../../../src/errors/errorHandler';
import addressesRouter from '../../../src/api/transactions/addresses';

describe('Transactions Addresses Routes (Extended)', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', addressesRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      descriptor: 'wpkh(xpub...)',
      network: 'testnet',
    } as any);

    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    mockDeriveAddressFromDescriptor.mockImplementation((_descriptor: string, index: number, opts: any) => ({
      address: opts.change ? `tb1qchange${index}` : `tb1qreceive${index}`,
      derivationPath: `m/84'/1'/0'/${opts.change ? 1 : 0}/${index}`,
    }));

    mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
    mockPrismaClient.$queryRaw.mockResolvedValue([]);
  });

  it('returns 404 when wallet is not found during address listing', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Wallet not found');
  });

  it('lists addresses with used filter and explicit pagination', async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      {
        id: 'addr-1',
        walletId: 'wallet-1',
        address: 'tb1qchange0',
        derivationPath: "m/84'/1'/0'/1/0",
        index: 0,
        used: true,
        addressLabels: [{ label: { id: 'label-1', name: 'Hot', color: '#f00' } }],
      },
    ] as any);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      { address: 'tb1qchange0', amount: BigInt(1500) },
    ] as any);

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/addresses')
      .query({ used: 'true', limit: '5', offset: '2' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletId: 'wallet-1', used: true }),
        take: 5,
        skip: 2,
      })
    );
    expect(response.headers['x-result-limit']).toBeUndefined();
    expect(response.body[0]).toMatchObject({
      address: 'tb1qchange0',
      balance: 1500,
      isChange: true,
      labels: [{ id: 'label-1', name: 'Hot', color: '#f00' }],
    });
  });

  it('sets unpaged headers and non-truncated flag for short address list', async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      {
        id: 'addr-1',
        walletId: 'wallet-1',
        address: 'tb1qreceive0',
        derivationPath: "m/84'/1'/0'/0/0",
        index: 0,
        used: false,
        addressLabels: [],
      },
    ] as any);

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses');

    expect(response.status).toBe(200);
    expect(response.headers['x-result-limit']).toBe('1000');
    expect(response.headers['x-result-truncated']).toBe('false');
    expect(response.body[0].isChange).toBe(false);
  });

  it('sets unpaged truncated flag when default limit is reached', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `addr-${i}`,
      walletId: 'wallet-1',
      address: `tb1qreceive${i}`,
      derivationPath: `m/84'/1'/0'/0/${i}`,
      index: i,
      used: false,
      addressLabels: [],
    }));
    mockPrismaClient.address.findMany.mockResolvedValue(rows as any);

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses');

    expect(response.status).toBe(200);
    expect(response.headers['x-result-truncated']).toBe('true');
    expect(response.body).toHaveLength(1000);
  });

  it('auto-generates initial addresses when wallet has descriptor and no addresses', async () => {
    mockPrismaClient.address.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'addr-1',
          walletId: 'wallet-1',
          address: 'tb1qreceive0',
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
          used: false,
          addressLabels: [],
        },
        {
          id: 'addr-2',
          walletId: 'wallet-1',
          address: 'tb1qchange0',
          derivationPath: "m/84'/1'/0'/1/0",
          index: 0,
          used: false,
          addressLabels: [],
        },
      ] as any);

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses');

    expect(response.status).toBe(200);
    expect(mockDeriveAddressFromDescriptor).toHaveBeenCalledTimes(4);
    expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ address: 'tb1qreceive0', index: 0 }),
        expect.objectContaining({ address: 'tb1qreceive1', index: 1 }),
        expect.objectContaining({ address: 'tb1qchange0', index: 0 }),
        expect.objectContaining({ address: 'tb1qchange1', index: 1 }),
      ]),
    });
    expect(response.body).toHaveLength(2);
  });

  it('continues gracefully when auto-generation fails', async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockDeriveAddressFromDescriptor.mockImplementation(() => {
      throw new Error('invalid descriptor');
    });

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses');

    expect(response.status).toBe(200);
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-1',
        spent: false,
      },
      select: {
        address: true,
        amount: true,
      },
    });
    expect(response.body).toEqual([]);
  });

  it('returns 500 when address listing fails unexpectedly', async () => {
    mockPrismaClient.wallet.findUnique.mockRejectedValue(new Error('db down'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns address summary with split used/unused balances', async () => {
    mockPrismaClient.address.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(9000) } });
    mockPrismaClient.$queryRaw.mockResolvedValue([
      { used: true, balance: BigInt(7000) },
      { used: false, balance: BigInt(2000) },
    ] as any);

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses/summary');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalAddresses: 3,
      usedCount: 1,
      unusedCount: 2,
      totalBalance: 9000,
      usedBalance: 7000,
      unusedBalance: 2000,
    });
  });

  it('returns summary defaults when one balance bucket is missing', async () => {
    mockPrismaClient.address.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(4500) } });
    mockPrismaClient.$queryRaw.mockResolvedValue([
      { used: true, balance: BigInt(4500) },
    ] as any);

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses/summary');

    expect(response.status).toBe(200);
    expect(response.body.usedBalance).toBe(4500);
    expect(response.body.unusedBalance).toBe(0);
  });

  it('returns 500 when address summary query fails', async () => {
    mockPrismaClient.address.count.mockRejectedValue(new Error('count failed'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/addresses/summary');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 404 when generating addresses for a missing wallet', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/addresses/generate')
      .send({ count: 2 });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Wallet not found');
  });

  it('returns 400 when generating addresses for a wallet without descriptor', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', descriptor: null } as any);

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/addresses/generate')
      .send({ count: 2 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Wallet does not have a descriptor');
  });

  it('generates additional receive and change addresses with skipDuplicates', async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      { derivationPath: "m/84'/1'/0'/0/3", index: 3 },
      { derivationPath: "m/84'/1'/0'/1/4", index: 4 },
    ] as any);

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/addresses/generate')
      .send({ count: 2 });

    expect(response.status).toBe(200);
    expect(mockDeriveAddressFromDescriptor).toHaveBeenCalledTimes(4);
    expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/0/4", index: 4 }),
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/0/5", index: 5 }),
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/1/5", index: 5 }),
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/1/6", index: 6 }),
      ]),
      skipDuplicates: true,
    });
    expect(response.body).toEqual({
      generated: 4,
      receiveAddresses: 2,
      changeAddresses: 2,
    });
  });

  it('ignores malformed and unsupported derivation paths when computing max indexes', async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      { derivationPath: 'malformed', index: 10 },
      { derivationPath: "m/84'/1'/0'/2/9", index: 9 },
    ] as any);

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/addresses/generate')
      .send({ count: 2 });

    expect(response.status).toBe(200);
    expect(mockDeriveAddressFromDescriptor).toHaveBeenCalledTimes(4);
    expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/0/0", index: 0 }),
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/0/1", index: 1 }),
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/1/0", index: 0 }),
        expect.objectContaining({ derivationPath: "m/84'/1'/0'/1/1", index: 1 }),
      ]),
      skipDuplicates: true,
    });
    expect(response.body).toEqual({
      generated: 4,
      receiveAddresses: 2,
      changeAddresses: 2,
    });
  });

  it('returns generated zero when derivation fails for all addresses', async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockDeriveAddressFromDescriptor.mockImplementation(() => {
      throw new Error('derive failed');
    });

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/addresses/generate')
      .send({ count: 2 });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    expect(response.body.generated).toBe(0);
  });

  it('returns 500 when address generation fails unexpectedly', async () => {
    mockPrismaClient.address.findMany.mockRejectedValue(new Error('select failed'));

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/addresses/generate')
      .send({ count: 2 });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
