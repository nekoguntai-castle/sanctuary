import { beforeEach, describe, expect, it, vi } from 'vitest';

const findDefault = vi.hoisted(() => vi.fn());
const decryptIfEncrypted = vi.hoisted(() => vi.fn((value: string) => value.replace(/^enc:/, '')));

vi.mock('../../../../../src/repositories', () => ({ nodeConfigRepository: { findDefault } }));
vi.mock('../../../../../src/utils/encryption', () => ({ decryptIfEncrypted }));
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { resolveElectrumConnectionConfig } from '../../../../../src/services/bitcoin/electrum/connectionConfigResolver';
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
