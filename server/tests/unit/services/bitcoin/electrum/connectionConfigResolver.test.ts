import { beforeEach, describe, expect, it, vi } from 'vitest';

const findDefault = vi.hoisted(() => vi.fn());
const decryptIfEncrypted = vi.hoisted(() => vi.fn((value: string) => value.replace(/^enc:/, '')));

vi.mock('../../../../../src/repositories', () => ({ nodeConfigRepository: { findDefault } }));
vi.mock('../../../../../src/utils/encryption', () => ({ decryptIfEncrypted }));
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  resolveConfiguredElectrumProxy,
  resolveElectrumConnectionConfig,
} from '../../../../../src/services/bitcoin/electrum/connectionConfigResolver';
import { ProxyConfigurationError } from '../../../../../src/services/bitcoin/electrum/proxyCredentials';

const persisted = (proxyPassword: string | null) => ({
  type: 'electrum',
  host: 'electrum.example.com',
  port: 50002,
  useSsl: true,
  allowSelfSignedCert: false,
  proxyEnabled: true,
  proxyHost: '127.0.0.1',
  proxyPort: 9050,
  proxyUsername: 'tor-user',
  proxyPassword,
});

describe('resolveElectrumConnectionConfig proxy credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the decrypted proxy password for every network', async () => {
    findDefault.mockResolvedValue(persisted('enc:s3cret'));

    for (const network of ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as const) {
      const resolved = await resolveElectrumConnectionConfig(null, network);
      expect(resolved.proxy?.password).toBe('s3cret');
    }
  });

  it('rejects with ProxyConfigurationError and never returns the ciphertext or a proxy-less config', async () => {
    findDefault.mockResolvedValue(persisted('enc:s3cret'));
    decryptIfEncrypted.mockImplementationOnce(() => {
      throw new Error('bad decrypt');
    });

    await expect(resolveElectrumConnectionConfig(null, 'mainnet')).rejects.toBeInstanceOf(
      ProxyConfigurationError,
    );
  });
});

describe('resolveConfiguredElectrumProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the decrypted proxy saved on the default electrum config', async () => {
    findDefault.mockResolvedValue(persisted('enc:s3cret'));

    await expect(resolveConfiguredElectrumProxy()).resolves.toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 9050,
      username: 'tor-user',
      password: 's3cret',
    });
  });

  it('returns undefined when the stored proxy is disabled', async () => {
    findDefault.mockResolvedValue({ ...persisted(null), proxyEnabled: false });

    await expect(resolveConfiguredElectrumProxy()).resolves.toBeUndefined();
  });

  it('returns undefined for a non-electrum config or no config row', async () => {
    findDefault.mockResolvedValueOnce({ ...persisted(null), type: 'bitcoind' });
    await expect(resolveConfiguredElectrumProxy()).resolves.toBeUndefined();

    findDefault.mockResolvedValueOnce(null);
    await expect(resolveConfiguredElectrumProxy()).resolves.toBeUndefined();
  });

  it('propagates ProxyConfigurationError when the stored password cannot be decrypted', async () => {
    findDefault.mockResolvedValue(persisted('enc:s3cret'));
    decryptIfEncrypted.mockImplementationOnce(() => {
      throw new Error('bad decrypt');
    });

    await expect(resolveConfiguredElectrumProxy()).rejects.toBeInstanceOf(ProxyConfigurationError);
  });
});
