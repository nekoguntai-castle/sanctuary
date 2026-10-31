/**
 * Non-regression: the public GET /api/v1/bitcoin/status route and the
 * get_bitcoin_network_status assistant tool both call getBitcoinNetworkStatus.
 * Each call used to open a brand-new direct Electrum client (singleton mode)
 * or a pool probe (pool mode), so request volume translated 1:1 into
 * upstream connections. The probe outcome is now cached per network/config
 * with single-flight, failures included, and invalidated on node-client reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findDefaultWithServers: vi.fn(),
  getParsed: vi.fn(),
  probeDirectSingleton: vi.fn(),
  probePool: vi.fn(),
  pool: {
    getCircuitHealth: vi.fn(),
    isPoolInitialized: vi.fn(),
    getPoolStats: vi.fn(),
    getOperationalConfigSnapshot: vi.fn(),
  },
}));

vi.mock('../../../../src/repositories/nodeConfigRepository', () => ({
  nodeConfigRepository: { findDefaultWithServers: mocks.findDefaultWithServers },
}));
vi.mock('../../../../src/repositories', () => ({
  systemSettingRepository: { getParsed: mocks.getParsed },
  nodeConfigRepository: { findDefault: vi.fn(), findDefaultWithServers: mocks.findDefaultWithServers },
}));
vi.mock('../../../../src/services/bitcoin/networkStatus/directClient', () => ({
  probeDirectSingleton: mocks.probeDirectSingleton,
}));
vi.mock('../../../../src/services/bitcoin/networkStatus/poolProbe', () => ({
  probePool: mocks.probePool,
  NETWORK_STATUS_PROBE_TIMEOUT_MS: 5000,
}));
vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  getElectrumPoolForNetwork: vi.fn(async () => mocks.pool),
  resetElectrumPool: vi.fn(async () => undefined),
  resetElectrumPoolForNetwork: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/services/bitcoin/electrum', () => ({
  ElectrumClient: vi.fn(),
  getElectrumClientForNetwork: vi.fn(),
  resetElectrumClient: vi.fn(),
}));
vi.mock('../../../../src/services/bitcoin/electrum/connectionConfigResolver', () => ({
  dbConnectionConfig: (nodeConfig: { host: string; port: number }) => ({
    host: nodeConfig.host,
    port: nodeConfig.port,
    protocol: 'ssl',
    allowSelfSignedCert: false,
  }),
  envConnectionConfig: () => ({ host: 'env.example', port: 50002, protocol: 'ssl', allowSelfSignedCert: false }),
  resolveConfiguredElectrumProxy: vi.fn(),
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { getBitcoinNetworkStatus } from '../../../../src/services/bitcoin/networkStatusService';
import { resetNodeClient } from '../../../../src/services/bitcoin/nodeClient';

const OK_PROBE = {
  ok: true,
  version: { server: 'Fulcrum 1.10', protocol: '1.4' },
  blockHeight: 900_000,
  identityMismatch: false,
};
const FAILED_PROBE = { ok: false, version: null, identityMismatch: false };

function nodeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'default',
    type: 'electrum',
    host: 'electrum.example',
    port: 50002,
    useSsl: true,
    mainnetMode: 'singleton',
    signetEnabled: true,
    signetMode: 'singleton',
    servers: [],
    ...overrides,
  };
}

const poolServer = {
  id: 'srv-1',
  label: 'Primary',
  host: 'pool.example',
  port: 50002,
  useSsl: true,
  network: 'mainnet',
  enabled: true,
  priority: 0,
  serverUsage: 'general',
};

describe('getBitcoinNetworkStatus probe cache', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
    vi.clearAllMocks();
    mocks.findDefaultWithServers.mockResolvedValue(nodeConfig());
    mocks.getParsed.mockImplementation(async (_key: string, _schema: unknown, fallback: number) => fallback);
    mocks.probeDirectSingleton.mockResolvedValue(OK_PROBE);
    mocks.pool.getCircuitHealth.mockReturnValue({ state: 'closed' });
    mocks.pool.isPoolInitialized.mockReturnValue(true);
    mocks.pool.getPoolStats.mockReturnValue({ servers: [] });
    mocks.pool.getOperationalConfigSnapshot.mockReturnValue({ healthCheckIntervalMs: 30000, loadBalancing: 'failover_only' });
    mocks.probePool.mockResolvedValue({ ok: false, version: null, serverId: null });
    await resetNodeClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one direct client probe across concurrent callers', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => getBitcoinNetworkStatus('mainnet')));

    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toMatchObject({ connected: true, server: 'Fulcrum 1.10', blockHeight: 900_000 });
    }
  });

  it('serves sequential callers within the TTL from one probe and re-probes after it', async () => {
    await getBitcoinNetworkStatus('mainnet');
    vi.advanceTimersByTime(5_000);
    await getBitcoinNetworkStatus('mainnet');
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);
  });

  it('expires on elapsed time, not the wall clock, so a clock step back cannot extend a cached success', async () => {
    await getBitcoinNetworkStatus('mainnet');
    vi.setSystemTime(new Date('2026-10-29T23:00:00Z'));
    vi.advanceTimersByTime(16_000);
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);
  });

  it('caches failed probes so an unreachable server is not re-dialled per request', async () => {
    mocks.probeDirectSingleton.mockResolvedValue(FAILED_PROBE);

    const first = await getBitcoinNetworkStatus('mainnet');
    const second = await getBitcoinNetworkStatus('mainnet');

    expect(first).toMatchObject({ connected: false });
    expect(second).toMatchObject({ connected: false });
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    mocks.probeDirectSingleton.mockResolvedValue(OK_PROBE);
    await expect(getBitcoinNetworkStatus('mainnet')).resolves.toMatchObject({ connected: true });
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cached probe on node-client reset (node config change)', async () => {
    await getBitcoinNetworkStatus('mainnet');
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1);

    await resetNodeClient();
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);

    await resetNodeClient('mainnet');
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(3);
  });

  it('does not store a probe that was in flight across a reset', async () => {
    let release!: (value: typeof OK_PROBE) => void;
    mocks.probeDirectSingleton.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const inFlight = getBitcoinNetworkStatus('mainnet');
    await vi.waitFor(() => expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1));
    await resetNodeClient();
    release(OK_PROBE);
    await inFlight;

    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);
  });

  it('drops only the reset network from the in-flight probes', async () => {
    const releases: Array<(value: typeof OK_PROBE) => void> = [];
    mocks.probeDirectSingleton.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));

    const mainnet = getBitcoinNetworkStatus('mainnet');
    const signet = getBitcoinNetworkStatus('signet');
    await vi.waitFor(() => expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2));
    await resetNodeClient('mainnet');

    const mainnetAfterReset = getBitcoinNetworkStatus('mainnet');
    const signetJoined = getBitcoinNetworkStatus('signet');
    await vi.waitFor(() => expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(3));
    expect(mocks.probeDirectSingleton.mock.calls.map((call) => call[1])).toEqual(['mainnet', 'signet', 'mainnet']);

    for (const release of releases) release(OK_PROBE);
    await Promise.all([mainnet, signet, mainnetAfterReset, signetJoined]);
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(3);
  });

  it('re-probes when the persisted connection config changes even without a reset', async () => {
    await getBitcoinNetworkStatus('mainnet');
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1);

    mocks.findDefaultWithServers.mockResolvedValue(nodeConfig({ host: 'other.example' }));
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);
    expect(mocks.probeDirectSingleton.mock.calls[1][0]).toMatchObject({ host: 'other.example' });
  });

  it('keeps networks independent', async () => {
    await getBitcoinNetworkStatus('mainnet');
    await getBitcoinNetworkStatus('signet');
    await getBitcoinNetworkStatus('mainnet');
    await getBitcoinNetworkStatus('signet');

    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);
    expect(mocks.probeDirectSingleton.mock.calls.map((call) => call[1])).toEqual(['mainnet', 'signet']);
    await resetNodeClient('signet');
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(2);
  });

  it('serves pool-mode status from the cache so status traffic does not feed the pool breaker', async () => {
    mocks.findDefaultWithServers.mockResolvedValue(nodeConfig({ mainnetMode: 'pool', servers: [poolServer] }));

    await Promise.all(Array.from({ length: 5 }, () => getBitcoinNetworkStatus('mainnet')));
    await getBitcoinNetworkStatus('mainnet');

    expect(mocks.probePool).toHaveBeenCalledTimes(1);
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1);
  });

  it('keeps the response shape and refreshes thresholds while the probe is cached', async () => {
    const first = await getBitcoinNetworkStatus('mainnet');
    mocks.getParsed.mockImplementation(async (key: string) => (key === 'confirmationThreshold' ? 3 : 100));
    const second = await getBitcoinNetworkStatus('mainnet');

    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
    expect(second).toMatchObject({ confirmationThreshold: 3, deepConfirmationThreshold: 100 });
    expect(second.operational.attemptedAt).toBe(first.operational.attemptedAt);
    expect(mocks.probeDirectSingleton).toHaveBeenCalledTimes(1);
  });

  it('caps the success TTL at a shorter pool health-check interval so cached servers are not stale', async () => {
    const backup = { ...poolServer, id: 'srv-2', label: 'Backup', host: 'backup.example', priority: 1 };
    mocks.findDefaultWithServers.mockResolvedValue(nodeConfig({ mainnetMode: 'pool', servers: [poolServer, backup] }));
    mocks.pool.getOperationalConfigSnapshot.mockReturnValue({ healthCheckIntervalMs: 5000, loadBalancing: 'failover_only' });
    // Each pool read reports health checks that ran 4 s ago (just before the next 5 s cycle).
    mocks.pool.getPoolStats.mockImplementation(() => ({
      servers: ['srv-1', 'srv-2'].map((serverId) => ({
        serverId, isHealthy: true, lastHealthCheck: new Date(Date.now() - 4_000), cooldownUntil: null, consecutiveFailures: 0,
      })),
    }));
    mocks.probePool.mockResolvedValue({ ok: true, version: OK_PROBE.version, blockHeight: 900_000, serverId: 'srv-1' });

    await getBitcoinNetworkStatus('mainnet');
    vi.advanceTimersByTime(4_000);
    await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probePool).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    const later = await getBitcoinNetworkStatus('mainnet');
    expect(mocks.probePool).toHaveBeenCalledTimes(2);
    expect(later.operational.pool?.stale).toBe(0);
  });
});
