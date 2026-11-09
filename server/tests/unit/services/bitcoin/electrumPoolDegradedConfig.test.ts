import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression: a network pool created while the node-config read failed was
// built from empty defaults (zero configured servers) and cached with no
// expiry, so the configured servers were ignored until a reset or restart.

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  reloadServers: vi.fn(async () => undefined),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/services/bitcoin/electrumPool/poolConfig', () => ({
  loadPoolConfigFromDatabase: mocks.load,
}));

vi.mock('../../../../src/services/bitcoin/electrumPool/electrumPool', () => ({
  ElectrumPool: class {
    setNetwork = vi.fn();
    setProxyConfig = vi.fn();
    setServers = vi.fn();
    initialize = vi.fn(async () => undefined);
    shutdown = vi.fn(async () => undefined);
    reloadServers = mocks.reloadServers;
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mocks.log,
}));

import {
  getElectrumPoolForNetwork,
  getElectrumPoolForNetworkAndFeatures,
  reloadElectrumServers,
  resetElectrumPoolForNetwork,
} from '../../../../src/services/bitcoin/electrumPool/poolRegistry';

const failedLoad = { config: {}, servers: [], proxy: null, loadFailed: true };
const goodLoad = {
  config: { minConnections: 1 },
  servers: [{ id: 's1', host: 'electrum.example', port: 50002, useSsl: true, priority: 0, enabled: true }],
  proxy: null,
};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('network pool built from a failed config read', () => {
  beforeEach(async () => {
    await resetElectrumPoolForNetwork('testnet3');
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('reloads the configured servers once the database is readable again', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mocks.load.mockResolvedValueOnce(failedLoad);
    const pool = await getElectrumPoolForNetwork('testnet3');

    // Within the retry interval: no probe.
    await getElectrumPoolForNetwork('testnet3');
    await flush();
    expect(mocks.load).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 31_000);
    mocks.load.mockResolvedValueOnce(goodLoad);
    expect(await getElectrumPoolForNetwork('testnet3')).toBe(pool);
    await flush();

    expect(mocks.reloadServers).toHaveBeenCalledTimes(1);

    // Recovered: no further probes.
    now.mockReturnValue(1_000_000 + 120_000);
    await getElectrumPoolForNetwork('testnet3');
    await flush();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying while the database stays unreadable', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    mocks.load.mockResolvedValue(failedLoad);
    await getElectrumPoolForNetwork('testnet3');

    now.mockReturnValue(2_000_000 + 31_000);
    await getElectrumPoolForNetwork('testnet3');
    await flush();
    now.mockReturnValue(2_000_000 + 62_000);
    await getElectrumPoolForNetwork('testnet3');
    await flush();

    expect(mocks.load).toHaveBeenCalledTimes(3);
    expect(mocks.reloadServers).not.toHaveBeenCalled();
  });

  it('keeps retrying when the probe itself throws', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000_000);
    mocks.load.mockResolvedValueOnce(failedLoad);
    await getElectrumPoolForNetwork('testnet3');

    now.mockReturnValue(3_000_000 + 31_000);
    mocks.load.mockRejectedValueOnce(new Error('proxy decrypt failed'));
    await getElectrumPoolForNetwork('testnet3');
    await flush();
    expect(mocks.log.warn).toHaveBeenCalled();

    now.mockReturnValue(3_000_000 + 62_000);
    mocks.load.mockResolvedValueOnce(goodLoad);
    await getElectrumPoolForNetwork('testnet3');
    await flush();
    expect(mocks.reloadServers).toHaveBeenCalledTimes(1);
  });

  it('does not reload a pool that was replaced while the probe ran', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
    mocks.load.mockResolvedValueOnce(failedLoad);
    await getElectrumPoolForNetwork('testnet3');

    let finishProbe!: () => void;
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => {
      finishProbe = () => resolve(goodLoad);
    }));
    now.mockReturnValue(5_000_000 + 31_000);
    await getElectrumPoolForNetwork('testnet3');
    await flush();

    // Reset and rebuilt (still degraded) while the probe's read was in flight.
    await resetElectrumPoolForNetwork('testnet3');
    mocks.load.mockResolvedValueOnce(failedLoad);
    await getElectrumPoolForNetwork('testnet3');
    finishProbe();
    await flush();

    expect(mocks.reloadServers).not.toHaveBeenCalled();
  });

  it('never probes a pool built from a successful read', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(4_000_000);
    mocks.load.mockResolvedValueOnce(goodLoad);
    await getElectrumPoolForNetwork('testnet3');

    now.mockReturnValue(4_000_000 + 120_000);
    await getElectrumPoolForNetwork('testnet3');
    await flush();

    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
});

describe('feature-scoped pool built from a failed config read', () => {
  // Regression: the re-probe covered only network pools, so a silent-payments
  // pool built from empty defaults kept them until a reset or restart.
  beforeEach(async () => {
    await resetElectrumPoolForNetwork('testnet3');
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const getSilentPaymentsPool = () => getElectrumPoolForNetworkAndFeatures('testnet3', ['silent_payments_v0']);

  it('retires the pool once the config is readable, so the next caller rebuilds it with its scope', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(6_000_000);
    mocks.load.mockResolvedValueOnce(failedLoad);
    const degraded = await getSilentPaymentsPool();

    expect(await getSilentPaymentsPool()).toBe(degraded); // within the retry interval
    await flush();
    expect(mocks.load).toHaveBeenCalledTimes(1);

    now.mockReturnValue(6_000_000 + 31_000);
    mocks.load.mockResolvedValue(goodLoad);
    expect(await getSilentPaymentsPool()).toBe(degraded);
    await flush();

    expect(mocks.load).toHaveBeenLastCalledWith('testnet3', expect.objectContaining({
      requiredFeatures: ['silent_payments_v0'],
    }));
    expect(degraded.shutdown).toHaveBeenCalledTimes(1);
    expect(mocks.reloadServers).not.toHaveBeenCalled(); // reloadServers ignores the feature scope

    const rebuilt = await getSilentPaymentsPool();
    expect(rebuilt).not.toBe(degraded);
    now.mockReturnValue(6_000_000 + 120_000);
    expect(await getSilentPaymentsPool()).toBe(rebuilt); // healthy: no further probes
    await flush();
    expect(rebuilt.shutdown).not.toHaveBeenCalled();
  });

  it('keeps the degraded pool while the config stays unreadable', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(7_000_000);
    mocks.load.mockResolvedValue(failedLoad);
    const degraded = await getSilentPaymentsPool();

    now.mockReturnValue(7_000_000 + 31_000);
    await getSilentPaymentsPool();
    await flush();

    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(degraded.shutdown).not.toHaveBeenCalled();
    expect(await getSilentPaymentsPool()).toBe(degraded);
  });

  it('keeps probing another network that stays degraded across a reset', async () => {
    await resetElectrumPoolForNetwork('signet');
    const now = vi.spyOn(Date, 'now').mockReturnValue(9_000_000);
    mocks.load.mockResolvedValue(failedLoad);
    await getElectrumPoolForNetwork('signet');
    await getSilentPaymentsPool();
    await resetElectrumPoolForNetwork('testnet3');

    now.mockReturnValue(9_000_000 + 31_000);
    mocks.load.mockClear();
    await getElectrumPoolForNetwork('signet');
    await flush();

    expect(mocks.load).toHaveBeenCalledWith('signet', expect.objectContaining({ serverUsage: 'general' }));
    await resetElectrumPoolForNetwork('signet');
  });

  it('forgets a degraded feature pool retired by a server reload', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000_000);
    mocks.load.mockResolvedValueOnce(failedLoad);
    const degraded = await getSilentPaymentsPool();

    await reloadElectrumServers(); // every pool, including feature pools with no network pool
    expect(degraded.shutdown).toHaveBeenCalledTimes(1);

    mocks.load.mockResolvedValue(goodLoad);
    const fresh = await getSilentPaymentsPool();
    now.mockReturnValue(10_000_000 + 31_000);
    mocks.load.mockClear();
    await getSilentPaymentsPool();
    await flush();
    expect(mocks.load).not.toHaveBeenCalled(); // nothing degraded left to probe
    expect(fresh.shutdown).not.toHaveBeenCalled();
  });

  it('forgets a degraded feature pool when its network is reset', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(8_000_000);
    mocks.load.mockResolvedValueOnce(failedLoad);
    await getSilentPaymentsPool();
    await resetElectrumPoolForNetwork('testnet3');

    mocks.load.mockResolvedValue(goodLoad);
    const fresh = await getSilentPaymentsPool();
    now.mockReturnValue(8_000_000 + 31_000);
    await getSilentPaymentsPool();
    await flush();

    expect(mocks.load).toHaveBeenCalledTimes(2); // no probe for the forgotten pool
    expect(fresh.shutdown).not.toHaveBeenCalled();
  });
});
