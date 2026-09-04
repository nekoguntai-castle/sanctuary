import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockClientInstance = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  getServerVersion: vi.fn(),
  getBlockHeight: vi.fn(),
};

const { ElectrumClientMock } = vi.hoisted(() => ({
  ElectrumClientMock: vi.fn().mockImplementation(function ElectrumClient() {
    return mockClientInstance;
  }),
}));

vi.mock('../../../../../src/services/bitcoin/electrum', () => ({
  ElectrumClient: ElectrumClientMock,
}));

const verifyNodeClientNetwork = vi.fn();
vi.mock('../../../../../src/services/bitcoin/networkIdentity', () => ({
  verifyNodeClientNetwork: (...args: unknown[]) => verifyNodeClientNetwork(...args),
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { probeDirectSingleton } from '../../../../../src/services/bitcoin/networkStatus/directClient';

const connectionConfig = { host: 'h', port: 1, protocol: 'tcp' as const, allowSelfSignedCert: false };

describe('probeDirectSingleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.connect.mockResolvedValue(undefined);
    mockClientInstance.disconnect.mockReturnValue(undefined);
    verifyNodeClientNetwork.mockResolvedValue(undefined);
  });

  it('returns ok:true with version/height on full success, and disconnects after', async () => {
    mockClientInstance.getServerVersion.mockResolvedValue({ server: 'X', protocol: '1.4' });
    mockClientInstance.getBlockHeight.mockResolvedValue(100);

    const result = await probeDirectSingleton(connectionConfig, 'mainnet');

    expect(result).toEqual({ ok: true, version: { server: 'X', protocol: '1.4' }, blockHeight: 100, identityMismatch: false });
    expect(mockClientInstance.disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false without throwing when connect fails, and still disconnects', async () => {
    mockClientInstance.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await probeDirectSingleton(connectionConfig, 'mainnet');

    expect(result.ok).toBe(false);
    expect(result.identityMismatch).toBe(false);
    expect(mockClientInstance.disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns identityMismatch:true and does not run RPCs when identity verification fails', async () => {
    verifyNodeClientNetwork.mockRejectedValueOnce(new Error('genesis mismatch'));

    const result = await probeDirectSingleton(connectionConfig, 'testnet3');

    expect(result).toEqual({ ok: false, version: null, identityMismatch: true });
    expect(mockClientInstance.getServerVersion).not.toHaveBeenCalled();
    expect(mockClientInstance.disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false when only the version RPC fails', async () => {
    mockClientInstance.getServerVersion.mockRejectedValue(new Error('version failed'));
    mockClientInstance.getBlockHeight.mockResolvedValue(100);

    const result = await probeDirectSingleton(connectionConfig, 'mainnet');
    expect(result.ok).toBe(false);
  });

  it('returns ok:false when only the height RPC fails', async () => {
    mockClientInstance.getServerVersion.mockResolvedValue({ server: 'X', protocol: '1.4' });
    mockClientInstance.getBlockHeight.mockRejectedValue(new Error('height failed'));

    const result = await probeDirectSingleton(connectionConfig, 'mainnet');
    expect(result.ok).toBe(false);
  });

  it('logs but does not throw or replace the primary outcome when disconnect itself throws', async () => {
    mockClientInstance.getServerVersion.mockResolvedValue({ server: 'X', protocol: '1.4' });
    mockClientInstance.getBlockHeight.mockResolvedValue(100);
    mockClientInstance.disconnect.mockImplementationOnce(() => {
      throw new Error('disconnect boom');
    });

    const result = await probeDirectSingleton(connectionConfig, 'mainnet');
    expect(result.ok).toBe(true);
  });

  it('settles the identity-verification timeout before disconnecting exactly once', async () => {
    vi.useFakeTimers();
    try {
      let rejectVerification: (error: Error) => void = () => {};
      verifyNodeClientNetwork.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            // Simulate the real timeout mechanism in networkIdentity.ts:
            // the verification promise only settles once its internal timer
            // fires -- it never resolves early.
            const timer = setTimeout(() => reject(new Error('identity check timed out')), 10_000);
            rejectVerification = (error) => {
              clearTimeout(timer);
              reject(error);
            };
          }),
      );

      const resultPromise = probeDirectSingleton(connectionConfig, 'mainnet', { timeoutMs: 10_000 });

      // Not yet settled: disconnect must not have run before the timeout.
      await Promise.resolve();
      expect(mockClientInstance.disconnect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);
      // Drive the manually-tracked timer's rejection (fake timers don't
      // auto-fire a `new Promise` executor's own setTimeout otherwise).
      rejectVerification(new Error('identity check timed out'));

      const result = await resultPromise;

      expect(result).toEqual({ ok: false, version: null, identityMismatch: true });
      expect(mockClientInstance.getServerVersion).not.toHaveBeenCalled();
      expect(mockClientInstance.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never includes proxy credentials in its result even when configured', async () => {
    mockClientInstance.getServerVersion.mockResolvedValue({ server: 'X', protocol: '1.4' });
    mockClientInstance.getBlockHeight.mockResolvedValue(100);

    const result = await probeDirectSingleton(
      { ...connectionConfig, proxy: { enabled: true, host: '127.0.0.1', port: 9050, username: 'u', password: 'secret-pw' } },
      'mainnet',
    );

    expect(JSON.stringify(result)).not.toContain('secret-pw');
  });

  it('forwards timeoutMs as connectionTimeoutMs to the attempt-scoped client when no proxy is configured', async () => {
    mockClientInstance.getServerVersion.mockResolvedValue({ server: 'X', protocol: '1.4' });
    mockClientInstance.getBlockHeight.mockResolvedValue(100);

    await probeDirectSingleton(connectionConfig, 'mainnet', { timeoutMs: 5000 });

    expect(ElectrumClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeoutMs: 5000 }),
    );
    expect(verifyNodeClientNetwork).toHaveBeenCalledWith(
      mockClientInstance,
      'mainnet',
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it('does not force a short connectionTimeoutMs onto the client when a proxy is enabled, deferring to its own default', async () => {
    mockClientInstance.getServerVersion.mockResolvedValue({ server: 'X', protocol: '1.4' });
    mockClientInstance.getBlockHeight.mockResolvedValue(100);

    await probeDirectSingleton(
      { ...connectionConfig, proxy: { enabled: true, host: '127.0.0.1', port: 9050 } },
      'mainnet',
      { timeoutMs: 5000 },
    );

    const constructedConfig = ElectrumClientMock.mock.calls.at(-1)?.[0];
    expect(constructedConfig).not.toHaveProperty('connectionTimeoutMs');
    // Identity verification itself still honors the bound -- only the
    // client's own connection-establishment timeout defers to its default.
    expect(verifyNodeClientNetwork).toHaveBeenCalledWith(
      mockClientInstance,
      'mainnet',
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });
});
