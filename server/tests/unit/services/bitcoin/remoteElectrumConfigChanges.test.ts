import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression: an admin Node Config / Electrum server write reset only the API
// process that served it and the worker (the event's only subscriber). Any
// other API process kept the old servers and proxy until restart.

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (change: unknown) => Promise<void>>(),
  resync: null as null | (() => Promise<void>),
  unsubscribe: vi.fn(),
  unsubscribeResync: vi.fn(),
  resetNodeClient: vi.fn(async () => undefined),
  reloadElectrumServers: vi.fn(async () => undefined),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/infrastructure', () => ({
  getDistributedEventBus: () => ({
    onRemote: (event: string, handler: (change: unknown) => Promise<void>) => {
      mocks.handlers.set(event, handler);
      return mocks.unsubscribe;
    },
    onResync: (handler: () => Promise<void>) => {
      mocks.resync = handler;
      return mocks.unsubscribeResync;
    },
  }),
}));

vi.mock('../../../../src/repositories/nodeConfigRepository', () => ({
  nodeConfigRepository: { findDefaultWithServers: vi.fn(async () => null) },
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  resetNodeClient: mocks.resetNodeClient,
}));

vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  reloadElectrumServers: mocks.reloadElectrumServers,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mocks.log,
}));

async function load() {
  vi.resetModules();
  return import('../../../../src/services/bitcoin/remoteElectrumConfigChanges');
}

const EVENT = 'system:electrumConfig.changed';

describe('remote Electrum config changes in the API process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.resync = null;
  });

  // Regression: a change published while this process's subscriber was
  // disconnected (or that the writer failed to publish) was never applied.
  it('reapplies the whole config when it may have missed a change', async () => {
    const { nodeConfigRepository } = await import('../../../../src/repositories/nodeConfigRepository');
    const { startRemoteElectrumConfigChanges, stopRemoteElectrumConfigChanges } = await load();
    startRemoteElectrumConfigChanges();
    await vi.waitFor(() => expect(nodeConfigRepository.findDefaultWithServers).toHaveBeenCalled()); // primed: none
    vi.mocked(nodeConfigRepository.findDefaultWithServers).mockResolvedValueOnce({ id: 'default', servers: [] } as any);

    await mocks.resync!();

    expect(mocks.resetNodeClient).toHaveBeenCalledWith(undefined);
    expect(mocks.reloadElectrumServers).toHaveBeenCalledWith(undefined);
    stopRemoteElectrumConfigChanges();
    expect(mocks.unsubscribeResync).toHaveBeenCalledTimes(1);
  });

  it('resets this process for node-config changes made by another process', async () => {
    const { startRemoteElectrumConfigChanges } = await load();
    startRemoteElectrumConfigChanges();

    await mocks.handlers.get(EVENT)!({ scope: 'node-config', network: 'testnet3' });

    expect(mocks.resetNodeClient).toHaveBeenCalledWith('testnet3');
    expect(mocks.reloadElectrumServers).not.toHaveBeenCalled();
  });

  it('reloads pools for electrum-server changes, for every network when unnamed', async () => {
    const { startRemoteElectrumConfigChanges } = await load();
    startRemoteElectrumConfigChanges();

    await mocks.handlers.get(EVENT)!({ scope: 'electrum-servers', network: null });

    expect(mocks.reloadElectrumServers).toHaveBeenCalledWith(undefined);
  });

  it('ignores malformed payloads and survives a failed apply', async () => {
    const { startRemoteElectrumConfigChanges } = await load();
    startRemoteElectrumConfigChanges();
    const handler = mocks.handlers.get(EVENT)!;

    await handler({ scope: 'bogus' });
    expect(mocks.resetNodeClient).not.toHaveBeenCalled();
    expect(mocks.log.warn).toHaveBeenCalled();

    mocks.resetNodeClient.mockRejectedValueOnce(new Error('reset failed'));
    await handler({ scope: 'node-config', network: null });
    expect(mocks.log.error).toHaveBeenCalled();

    await handler({ scope: 'node-config', network: 'mainnet' });
    expect(mocks.resetNodeClient).toHaveBeenLastCalledWith('mainnet');
  });

  it('subscribes once and unsubscribes on stop', async () => {
    const { startRemoteElectrumConfigChanges, stopRemoteElectrumConfigChanges } = await load();
    startRemoteElectrumConfigChanges();
    startRemoteElectrumConfigChanges();
    stopRemoteElectrumConfigChanges();
    stopRemoteElectrumConfigChanges();

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
