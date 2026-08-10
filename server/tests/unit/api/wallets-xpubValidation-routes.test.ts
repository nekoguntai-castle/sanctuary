import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockValidateXpub,
  mockDeriveCanonicalAddress,
} = vi.hoisted(() => ({
  mockValidateXpub: vi.fn(),
  mockDeriveCanonicalAddress: vi.fn(),
}));

vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  validateXpub: mockValidateXpub,
  deriveCanonicalAddress: mockDeriveCanonicalAddress,
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
import { prepareDescriptorPolicy } from '../../../src/services/wallet/descriptorPolicy';

const VALID_XPUB = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
const NATIVE_ORIGIN = { fingerprint: 'aabbccdd', accountPath: "84'/0'/0'" };

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
    mockDeriveCanonicalAddress.mockReturnValue({ address: 'bc1qexample0' });
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
      .send({ xpub: 'xpubbad', network: 'mainnet', ...NATIVE_ORIGIN });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid checksum');
  });

  it('falls back to default invalid-xpub message when validator error is missing', async () => {
    mockValidateXpub.mockReturnValue({ valid: false });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpubbad', network: 'mainnet', ...NATIVE_ORIGIN });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid xpub');
  });

  it('uses detected script type when scriptType is not provided', async () => {
    mockValidateXpub.mockReturnValue({ valid: true, scriptType: 'nested_segwit' });
    mockDeriveCanonicalAddress.mockReturnValue({ address: '3exampleaddress' });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({
        xpub: 'xpub123',
        network: 'mainnet',
        fingerprint: 'aabbccdd',
        accountPath: "49'/0'/0'",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      valid: true,
      scriptType: 'nested_segwit',
      descriptor: "sh(wpkh([aabbccdd/49'/0'/0']xpub123/<0;1>/*))",
      firstAddress: '3exampleaddress',
      fingerprint: 'aabbccdd',
      accountPath: "49'/0'/0'",
    });
    expect(mockDeriveCanonicalAddress).toHaveBeenCalledWith({
      receiveDescriptor: "sh(wpkh([aabbccdd/49'/0'/0']xpub123/0/*))",
      changeDescriptor: "sh(wpkh([aabbccdd/49'/0'/0']xpub123/1/*))",
    }, { branch: 0, index: 0, network: 'mainnet' });
  });

  it('falls back to native segwit defaults when script type cannot be detected', async () => {
    mockValidateXpub.mockReturnValue({ valid: true, scriptType: undefined });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({
        xpub: 'tpub123',
        network: 'testnet3',
        fingerprint: 'aabbccdd',
        accountPath: "84'/1'/0'",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      scriptType: 'native_segwit',
      descriptor: "wpkh([aabbccdd/84'/1'/0']tpub123/<0;1>/*)",
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
    expect(response.body.descriptor).toBe("wpkh([f00dbabe/84'/0'/7']xpub-native/<0;1>/*)");
    expect(response.body.fingerprint).toBe('f00dbabe');
    expect(response.body.accountPath).toBe("84'/0'/7'");
  });

  it('composes exact multipath provenance accepted as a complete import policy', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({
        xpub: VALID_XPUB,
        scriptType: 'native_segwit',
        network: 'mainnet',
        fingerprint: 'aabbccdd',
        accountPath: "84'/0'/0'",
      });

    expect(response.status).toBe(200);
    const sourceDescriptor = `wpkh([aabbccdd/84'/0'/0']${VALID_XPUB}/<0;1>/*)`;
    expect(response.body.descriptor).toBe(sourceDescriptor);
    expect(prepareDescriptorPolicy({
      receiveDescriptor: response.body.descriptor,
      sourceKind: 'imported',
    })).toMatchObject({
      descriptor: `wpkh([aabbccdd/84'/0'/0']${VALID_XPUB}/0/*)`,
      changeDescriptor: `wpkh([aabbccdd/84'/0'/0']${VALID_XPUB}/1/*)`,
      descriptorSourceKind: 'imported_multipath',
      sourceDescriptor,
      sourceChangeDescriptor: null,
    });
  });

  it('supports taproot descriptors', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({
        xpub: 'xpub-tap',
        scriptType: 'taproot',
        network: 'mainnet',
        fingerprint: 'aabbccdd',
        accountPath: "86'/0'/0'",
      });

    expect(response.status).toBe(200);
    expect(response.body.descriptor).toBe("tr([aabbccdd/86'/0'/0']xpub-tap/<0;1>/*)");
  });

  it('supports legacy descriptors', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({
        xpub: 'xpub-legacy',
        scriptType: 'legacy',
        network: 'mainnet',
        fingerprint: 'aabbccdd',
        accountPath: "44'/0'/0'",
      });

    expect(response.status).toBe(200);
    expect(response.body.descriptor).toBe("pkh([aabbccdd/44'/0'/0']xpub-legacy/<0;1>/*)");
  });

  it('rejects unsupported script types after xpub validation succeeds', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub-123', scriptType: 'unsupported', network: 'mainnet', ...NATIVE_ORIGIN });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid script type');
  });

  it('returns 400 when canonical origin validation fails', async () => {
    mockDeriveCanonicalAddress.mockImplementation(() => {
      throw new Error('derive failed');
    });

    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub-err', scriptType: 'native_segwit', network: 'mainnet', ...NATIVE_ORIGIN });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('derive failed');
  });

  it('uses a stable message for non-Error canonical origin failures', async () => {
    mockDeriveCanonicalAddress.mockImplementationOnce(() => { throw Object.create(null); });
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({ xpub: 'xpub-err', scriptType: 'native_segwit', network: 'mainnet', ...NATIVE_ORIGIN });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Extended key origin is invalid');
  });

  it.each([
    [{ xpub: 'xpub123', accountPath: "84'/0'/0'" }, 'received undefined'],
    [{ xpub: 'xpub123', fingerprint: '00000000', accountPath: "84'/0'/0'" }, 'cannot be 00000000'],
    [{ xpub: 'xpub123', fingerprint: 'not-real', accountPath: "84'/0'/0'" }, 'exactly 8 hexadecimal'],
    [{ xpub: 'xpub123', fingerprint: 'aabbccdd' }, 'received undefined'],
  ])('rejects incomplete or fabricated origin metadata', async (body, message) => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain(message);
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
  });

  it('rejects an account path that contradicts script type or network', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/validate-xpub')
      .send({
        xpub: 'xpub123',
        scriptType: 'taproot',
        network: 'mainnet',
        fingerprint: 'aabbccdd',
        accountPath: "84'/0'/0'",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('does not match');
  });
});
