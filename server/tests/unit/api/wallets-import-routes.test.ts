import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockValidateImport,
  mockImportWallet,
  mockGetAllFormats,
  mockGetErrorMessage,
  mockIsPrismaError,
} = vi.hoisted(() => ({
  mockValidateImport: vi.fn(),
  mockImportWallet: vi.fn(),
  mockGetAllFormats: vi.fn(),
  mockGetErrorMessage: vi.fn(),
  mockIsPrismaError: vi.fn(),
}));

vi.mock('../../../src/services/walletImport', () => ({
  validateImport: mockValidateImport,
  importWallet: mockImportWallet,
}));

vi.mock('../../../src/services/import', () => ({
  importFormatRegistry: {
    getAll: mockGetAllFormats,
  },
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: mockGetErrorMessage,
  isPrismaError: mockIsPrismaError,
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
import walletsImportRouter from '../../../src/api/wallets/import';

describe('Wallets Import Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice' };
      next();
    });
    app.use('/api/v1/wallets', walletsImportRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAllFormats.mockReturnValue([
      {
        id: 'descriptor',
        name: 'Descriptor',
        description: 'Plain descriptor text',
        fileExtensions: ['txt', 'desc'],
        priority: 10,
      },
      {
        id: 'wallet_export',
        name: 'Wallet Export',
        description: 'Sparrow/Specter export',
        fileExtensions: ['json'],
        priority: 80,
      },
    ]);

    mockValidateImport.mockResolvedValue({
      valid: true,
      warnings: [],
      parsed: { descriptor: 'wpkh(xpub...)' },
    });

    mockImportWallet.mockResolvedValue({
      walletId: 'wallet-123',
      name: 'Imported Wallet',
      devicesCreated: 1,
    });

    mockGetErrorMessage.mockImplementation((err: any, fallback?: string) => err?.message || fallback || 'Unknown');
    mockIsPrismaError.mockReturnValue(false);
  });

  it('returns available import formats', async () => {
    const response = await request(app).get('/api/v1/wallets/import/formats');

    expect(response.status).toBe(200);
    expect(response.body.formats).toEqual([
      {
        id: 'descriptor',
        name: 'Descriptor',
        description: 'Plain descriptor text',
        extensions: ['txt', 'desc'],
        priority: 10,
      },
      {
        id: 'wallet_export',
        name: 'Wallet Export',
        description: 'Sparrow/Specter export',
        extensions: ['json'],
        priority: 80,
      },
    ]);
  });

  it('defaults format extensions to an empty array when handler has no fileExtensions', async () => {
    mockGetAllFormats.mockReturnValueOnce([
      {
        id: 'legacy',
        name: 'Legacy',
        description: 'No extensions metadata',
        priority: 1,
      },
    ]);

    const response = await request(app).get('/api/v1/wallets/import/formats');

    expect(response.status).toBe(200);
    expect(response.body.formats).toEqual([
      {
        id: 'legacy',
        name: 'Legacy',
        description: 'No extensions metadata',
        extensions: [],
        priority: 1,
      },
    ]);
  });

  it('handles import formats lookup failures', async () => {
    mockGetAllFormats.mockImplementation(() => {
      throw new Error('registry failed');
    });

    const response = await request(app).get('/api/v1/wallets/import/formats');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates import payload requires descriptor or json', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/import/validate')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Either descriptor or json is required');
  });

  it('validates import descriptor/json successfully', async () => {
    const payload = {
      descriptor: 'wpkh(xpub...)',
      json: { devices: [] },
    };

    const response = await request(app)
      .post('/api/v1/wallets/import/validate')
      .send(payload);

    expect(response.status).toBe(200);
    expect(mockValidateImport).toHaveBeenCalledWith('user-1', payload);
    expect(response.body.valid).toBe(true);
  });

  it('returns validation errors as internal server error', async () => {
    mockValidateImport.mockRejectedValue(new Error('invalid descriptor checksum'));

    const response = await request(app)
      .post('/api/v1/wallets/import/validate')
      .send({ descriptor: 'bad' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates import creation payload fields', async () => {
    const missingData = await request(app)
      .post('/api/v1/wallets/import')
      .send({ name: 'Wallet' });
    expect(missingData.status).toBe(400);
    expect(missingData.body.message).toBe('data (descriptor or JSON) is required');

    const missingName = await request(app)
      .post('/api/v1/wallets/import')
      .send({ data: 'wpkh(xpub...)' });
    expect(missingName.status).toBe(400);
    expect(missingName.body.message).toBe('name is required');

    const blankName = await request(app)
      .post('/api/v1/wallets/import')
      .send({ data: 'wpkh(xpub...)', name: '   ' });
    expect(blankName.status).toBe(400);
    expect(blankName.body.message).toBe('name is required');
  });

  it('imports wallet and trims name before calling import service', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/import')
      .send({
        data: 'wpkh(xpub...)',
        name: '  Imported Wallet  ',
        network: 'testnet3',
        deviceLabels: { dev1: 'Coldcard' },
      });

    expect(response.status).toBe(201);
    expect(mockImportWallet).toHaveBeenCalledWith('user-1', {
      data: 'wpkh(xpub...)',
      name: 'Imported Wallet',
      network: 'testnet3',
      deviceLabels: { dev1: 'Coldcard' },
    });
    expect(response.body).toEqual({
      walletId: 'wallet-123',
      name: 'Imported Wallet',
      devicesCreated: 1,
    });
  });

  it('returns internal server error for prisma unique violation', async () => {
    const prismaLikeError = {
      code: 'P2002',
      meta: { target: ['fingerprint'] },
      message: 'Unique constraint failed',
    };
    mockImportWallet.mockRejectedValue(prismaLikeError);
    mockIsPrismaError.mockReturnValue(true);

    const response = await request(app)
      .post('/api/v1/wallets/import')
      .send({ data: 'wpkh(xpub...)', name: 'Wallet' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns internal server error for non-duplicate import failures', async () => {
    mockImportWallet.mockRejectedValue(new Error('unsupported format'));
    mockIsPrismaError.mockReturnValue(false);

    const response = await request(app)
      .post('/api/v1/wallets/import')
      .send({ data: 'something', name: 'Wallet' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns internal server error when prisma duplicate target is not fingerprint', async () => {
    const prismaLikeError = {
      code: 'P2002',
      meta: { target: ['name'] },
      message: 'Unique constraint failed',
    };
    mockImportWallet.mockRejectedValue(prismaLikeError);
    mockIsPrismaError.mockReturnValue(true);

    const response = await request(app)
      .post('/api/v1/wallets/import')
      .send({ data: 'wpkh(xpub...)', name: 'Wallet' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
