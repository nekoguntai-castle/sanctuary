import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockValidateXpub,
  mockDeriveAddress,
} = vi.hoisted(() => ({
  mockValidateXpub: vi.fn(),
  mockDeriveAddress: vi.fn(),
}));

vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  validateXpub: mockValidateXpub,
  deriveAddress: mockDeriveAddress,
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
import xpubValidationRouter from '../../../src/api/wallets/xpubValidation';

describe('Wallets XPUB Validation Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/wallets', xpubValidationRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockValidateXpub.mockReturnValue({ valid: true, scriptType: 'native_segwit' });
    mockDeriveAddress.mockReturnValue({ address: 'bc1qexample0' });
  });

  it('requires xpub in request body', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ scriptType: 'native_segwit' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('xpub is required');
  });

  it('returns validation errors from xpub validation', async () => {
    mockValidateXpub.mockReturnValue({ valid: false, error: 'Invalid checksum' });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpubbad', network: 'mainnet' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid checksum');
  });

  it('falls back to default invalid-xpub message when validator error is missing', async () => {
    mockValidateXpub.mockReturnValue({ valid: false });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpubbad', network: 'mainnet' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid xpub');
  });

  it('uses detected script type when scriptType is not provided', async () => {
    mockValidateXpub.mockReturnValue({ valid: true, scriptType: 'nested_segwit' });
    mockDeriveAddress.mockReturnValue({ address: '3exampleaddress' });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub123', network: 'mainnet' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      valid: true,
      scriptType: 'nested_segwit',
      descriptor: "sh(wpkh([00000000/49'/0'/0']xpub123/0/*))",
      firstAddress: '3exampleaddress',
      fingerprint: '00000000',
      accountPath: "49'/0'/0'",
    });
    expect(mockDeriveAddress).toHaveBeenCalledWith('xpub123', 0, {
      scriptType: 'nested_segwit',
      network: 'mainnet',
      change: false,
    });
  });

  it('falls back to native segwit defaults when script type cannot be detected', async () => {
    mockValidateXpub.mockReturnValue({ valid: true, scriptType: undefined });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'tpub123', network: 'testnet3' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      scriptType: 'native_segwit',
      descriptor: "wpkh([00000000/84'/1'/0']tpub123/0/*)",
      accountPath: "84'/1'/0'",
    });
  });

  it('supports explicit native segwit script type with custom fingerprint/path', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({
        xpub: 'xpub-native',
        scriptType: 'native_segwit',
        network: 'mainnet',
        fingerprint: 'F00DBABE',
        accountPath: "84'/0'/7'",
      });

    expect(response.status).toBe(200);
    expect(response.body.descriptor).toBe("wpkh([F00DBABE/84'/0'/7']xpub-native/0/*)");
    expect(response.body.fingerprint).toBe('F00DBABE');
    expect(response.body.accountPath).toBe("84'/0'/7'");
  });

  it('supports taproot descriptors', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub-tap', scriptType: 'taproot', network: 'mainnet' });

    expect(response.status).toBe(200);
    expect(response.body.descriptor).toBe("tr([00000000/86'/0'/0']xpub-tap/0/*)");
  });

  it('supports legacy descriptors', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub-legacy', scriptType: 'legacy', network: 'mainnet' });

    expect(response.status).toBe(200);
    expect(response.body.descriptor).toBe("pkh([00000000/44'/0'/0']xpub-legacy/0/*)");
  });

  it('rejects unsupported script types after xpub validation succeeds', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub-123', scriptType: 'unsupported', network: 'mainnet' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid script type');
  });

  it('returns 400 when validation flow throws unexpectedly', async () => {
    mockDeriveAddress.mockImplementation(() => {
      throw new Error('derive failed');
    });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub-err', scriptType: 'native_segwit', network: 'mainnet' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
