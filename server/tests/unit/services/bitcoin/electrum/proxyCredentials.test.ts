import { beforeEach, describe, expect, it, vi } from 'vitest';

const decryptIfEncrypted = vi.hoisted(() => vi.fn((value: string) => value.replace(/^enc:/, '')));
const logError = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/utils/encryption', () => ({ decryptIfEncrypted }));
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: logError }),
}));

import {
  ProxyConfigurationError,
  projectNodeProxyConfigDecrypted,
} from '../../../../../src/services/bitcoin/electrum/proxyCredentials';

const source = (overrides: Record<string, unknown> = {}) => ({
  proxyEnabled: true,
  proxyHost: '127.0.0.1',
  proxyPort: 9050,
  proxyUsername: 'tor-user',
  proxyPassword: 'enc:s3cret',
  ...overrides,
});

describe('projectNodeProxyConfigDecrypted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no proxy is configured', () => {
    expect(projectNodeProxyConfigDecrypted(source({ proxyEnabled: false }))).toBeNull();
    expect(projectNodeProxyConfigDecrypted(null)).toBeNull();
    expect(decryptIfEncrypted).not.toHaveBeenCalled();
  });

  it('passes through a proxy without a password', () => {
    expect(projectNodeProxyConfigDecrypted(source({ proxyPassword: null }))).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 9050,
      username: 'tor-user',
    });
    expect(decryptIfEncrypted).not.toHaveBeenCalled();
  });

  it('decrypts an encrypted password', () => {
    expect(projectNodeProxyConfigDecrypted(source())?.password).toBe('s3cret');
  });

  it('passes a legacy plaintext password through decryptIfEncrypted', () => {
    expect(projectNodeProxyConfigDecrypted(source({ proxyPassword: 'plain' }))?.password).toBe('plain');
    expect(decryptIfEncrypted).toHaveBeenCalledWith('plain');
  });

  it('fails closed without logging the stored value when decryption throws', () => {
    decryptIfEncrypted.mockImplementationOnce(() => {
      throw new Error('bad decrypt');
    });

    expect(() => projectNodeProxyConfigDecrypted(source())).toThrow(ProxyConfigurationError);
    expect(logError).toHaveBeenCalledWith(
      'Stored proxy password cannot be decrypted',
      { error: 'bad decrypt' },
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('enc:s3cret');
  });
});
