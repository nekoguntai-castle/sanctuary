import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression: reapplying the Electrum config tears down every node client and
// pool, and a resync fires on every Redis reconnect. Without a change check a
// flapping Redis dropped all Electrum connections every few seconds.

const mocks = vi.hoisted(() => ({
  findDefaultWithServers: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/repositories/nodeConfigRepository', () => ({
  nodeConfigRepository: { findDefaultWithServers: mocks.findDefaultWithServers },
}));
vi.mock('../../../../src/infrastructure', () => ({ getDistributedEventBus: vi.fn() }));
vi.mock('../../../../src/utils/logger', () => ({ createLogger: () => mocks.log }));

import {
  createElectrumConfigResync,
  readElectrumConfigFingerprint,
} from '../../../../src/services/bitcoin/electrumConfigChanges';

const server = (overrides: Record<string, unknown> = {}) => ({
  id: 's1', network: 'mainnet', label: 'Home', host: 'electrum.local', port: 50002, useSsl: true,
  priority: 0, enabled: true, serverUsage: 'general',
  lastHealthCheck: new Date(1), healthCheckFails: 0, isHealthy: true, lastCapabilityCheck: new Date(1),
  updatedAt: new Date(1),
  ...overrides,
});
const config = (overrides: Record<string, unknown> = {}, servers = [server()]) => ({
  id: 'default', proxyEnabled: false, poolMinConnections: 1, createdAt: new Date(1), updatedAt: new Date(1),
  ...overrides,
  servers,
});

describe('Electrum config fingerprint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores health, capability and timestamp columns', async () => {
    mocks.findDefaultWithServers.mockResolvedValueOnce(config());
    const before = await readElectrumConfigFingerprint();
    mocks.findDefaultWithServers.mockResolvedValueOnce(config(
      { updatedAt: new Date(2) },
      [server({ lastHealthCheck: new Date(2), healthCheckFails: 3, isHealthy: false, lastCapabilityCheck: new Date(2), updatedAt: new Date(2) })],
    ));

    expect(await readElectrumConfigFingerprint()).toBe(before);
  });

  it('changes with a setting or a server connection field', async () => {
    mocks.findDefaultWithServers.mockResolvedValueOnce(config());
    const before = await readElectrumConfigFingerprint();
    mocks.findDefaultWithServers.mockResolvedValueOnce(config({ proxyEnabled: true }));
    mocks.findDefaultWithServers.mockResolvedValueOnce(config({}, [server({ host: 'other.local' })]));

    expect(await readElectrumConfigFingerprint()).not.toBe(before);
    expect(await readElectrumConfigFingerprint()).not.toBe(before);
  });

  it('distinguishes a missing config and reports an unreadable one as null', async () => {
    mocks.findDefaultWithServers.mockResolvedValueOnce(null);
    mocks.findDefaultWithServers.mockRejectedValueOnce(new Error('db down'));

    expect(await readElectrumConfigFingerprint()).toBe('none');
    expect(await readElectrumConfigFingerprint()).toBeNull();
    expect(mocks.log.warn).toHaveBeenCalled();
  });
});

describe('Electrum config resync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips the teardown when the stored config is the one applied', async () => {
    mocks.findDefaultWithServers.mockResolvedValue(config());
    const handleChange = vi.fn(async () => undefined);
    const resync = createElectrumConfigResync(handleChange, mocks.log as any);

    await resync.prime();
    await resync.resync();

    expect(handleChange).not.toHaveBeenCalled();
  });

  it('reapplies everything once when the config changed, then settles', async () => {
    mocks.findDefaultWithServers.mockResolvedValue(config());
    const handleChange = vi.fn(async () => undefined);
    const resync = createElectrumConfigResync(handleChange, mocks.log as any);
    await resync.prime();

    mocks.findDefaultWithServers.mockResolvedValue(config({ proxyEnabled: true }));
    await resync.resync();
    await resync.resync();

    expect(handleChange.mock.calls).toEqual([
      [{ scope: 'node-config', network: null }],
      [{ scope: 'electrum-servers', network: null }],
    ]);
  });

  it('reapplies when the config cannot be read', async () => {
    mocks.findDefaultWithServers.mockResolvedValueOnce(config()).mockRejectedValue(new Error('db down'));
    const handleChange = vi.fn(async () => undefined);
    const resync = createElectrumConfigResync(handleChange, mocks.log as any);
    await resync.prime();

    await resync.resync();

    expect(handleChange).toHaveBeenCalledTimes(2);
  });
});
