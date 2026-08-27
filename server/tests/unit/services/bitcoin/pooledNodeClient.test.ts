import { describe, expect, it, vi } from 'vitest';
import { PooledNodeClient } from '../../../../src/services/bitcoin/pooledNodeClient';

function harness() {
  const client = {
    getServerVersion: vi.fn().mockResolvedValue({ server: 'test', protocol: '1.4' }),
    getServerFeatures: vi.fn().mockResolvedValue({ genesis_hash: '00' }),
    getBlockHeight: vi.fn().mockResolvedValue(100),
    getBlockHeader: vi.fn().mockResolvedValue('header'),
    getAddressHistory: vi.fn().mockResolvedValue([]),
    getAddressBalance: vi.fn().mockResolvedValue({ confirmed: 1, unconfirmed: 0 }),
    getAddressUTXOs: vi.fn().mockResolvedValue([]),
    getTransaction: vi.fn().mockResolvedValue({ txid: 'tx' }),
    broadcastTransaction: vi.fn().mockResolvedValue('txid'),
    estimateFee: vi.fn().mockResolvedValue(0.001),
    getAddressHistoryBatch: vi.fn().mockResolvedValue(new Map()),
    getAddressUTXOsBatch: vi.fn().mockResolvedValue(new Map()),
    getTransactionsBatch: vi.fn().mockResolvedValue(new Map()),
  };
  const release = vi.fn();
  const pool = {
    acquire: vi.fn().mockResolvedValue({ client, release }),
    isPoolInitialized: vi.fn().mockReturnValue(true),
  };
  return {
    client,
    release,
    pool,
    facade: new PooledNodeClient(pool as never, 'mainnet'),
  };
}

describe('PooledNodeClient', () => {
  it('isolates five concurrent wallet history reads and releases every socket', async () => {
    const clients = Array.from({ length: 5 }, (_, index) => ({
      getAddressHistory: vi.fn().mockResolvedValue([{ tx_hash: `tx-${index}` }]),
    }));
    const releases = clients.map(() => vi.fn());
    const pool = {
      acquire: vi.fn().mockImplementation(async () => {
        const index = pool.acquire.mock.calls.length - 1;
        return { client: clients[index], release: releases[index] };
      }),
      isPoolInitialized: vi.fn().mockReturnValue(true),
      getSubscriptionConnection: vi.fn(),
    };
    const facade = new PooledNodeClient(pool as never, 'mainnet');

    await Promise.all(
      clients.map((_client, index) => facade.getAddressHistory(`wallet-${index}`)),
    );

    expect(pool.acquire).toHaveBeenCalledTimes(5);
    expect(pool.getSubscriptionConnection).not.toHaveBeenCalled();
    clients.forEach((client, index) => {
      expect(client.getAddressHistory).toHaveBeenCalledWith(
        `wallet-${index}`,
        undefined,
      );
      expect(releases[index]).toHaveBeenCalledOnce();
    });
  });

  it('borrows and releases a request connection for every non-subscription operation', async () => {
    const { facade, pool, release } = harness();
    const controller = new AbortController();
    const options = { signal: controller.signal, deadlineAt: Date.now() + 4_000 };

    await facade.connect();
    await facade.getServerVersion();
    await facade.getServerFeatures();
    await facade.getBlockHeight(options);
    await facade.getBlockHeader(1, options);
    await facade.getAddressHistory('address', options);
    await facade.getAddressBalance('address');
    await facade.getAddressUTXOs('address', options);
    await facade.getTransaction('txid', true, options);
    await facade.broadcastTransaction('raw');
    await facade.estimateFee(6);
    await facade.getAddressHistoryBatch(['address'], options);
    await facade.getAddressUTXOsBatch(['address'], options);
    await facade.getTransactionsBatch(['txid'], false, options);

    expect(pool.acquire).toHaveBeenCalledTimes(14);
    expect(release).toHaveBeenCalledTimes(14);
    expect(pool.acquire).toHaveBeenCalledWith({ purpose: 'node-request' });
    expect(facade.isConnected()).toBe(true);
    facade.disconnect();
  });

  it('releases the handle when the borrowed operation rejects', async () => {
    const { client, facade, release } = harness();
    client.getBlockHeight.mockRejectedValueOnce(new Error('remote failure'));

    await expect(facade.getBlockHeight()).rejects.toThrow('remote failure');
    expect(release).toHaveBeenCalledOnce();
  });

  it('detaches promptly on cancellation and releases a handle that arrives late', async () => {
    const { facade, pool } = harness();
    let resolveAcquire!: (handle: { client: unknown; release: () => void }) => void;
    const lateRelease = vi.fn();
    pool.acquire.mockReturnValueOnce(new Promise(resolve => { resolveAcquire = resolve; }));
    const controller = new AbortController();
    const reason = new Error('attempt cancelled');
    const pending = facade.getBlockHeight({ signal: controller.signal });

    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    resolveAcquire({ client: {}, release: lateRelease });
    await vi.waitFor(() => expect(lateRelease).toHaveBeenCalledOnce());
  });

  it('normalizes a non-Error reason and ignores a late acquisition rejection', async () => {
    const { facade, pool } = harness();
    let rejectAcquire!: (error: Error) => void;
    pool.acquire.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectAcquire = reject;
    }));
    const controller = new AbortController();
    const pending = facade.getBlockHeight({ signal: controller.signal });

    controller.abort('superseded');
    await expect(pending).rejects.toThrow('superseded');
    rejectAcquire(new Error('late pool failure'));
    await new Promise(resolve => setImmediate(resolve));
  });

  it('normalizes non-Error cancellation and rejects an already-aborted caller', async () => {
    const { facade, pool } = harness();
    const controller = new AbortController();
    controller.abort('superseded');

    await expect(facade.getBlockHeight({ signal: controller.signal }))
      .rejects.toThrow('superseded');
    expect(pool.acquire).not.toHaveBeenCalled();
  });

  it('preserves acquisition failure and removes its cancellation listener', async () => {
    const { facade, pool } = harness();
    pool.acquire.mockRejectedValueOnce(new Error('pool exhausted'));
    const controller = new AbortController();

    await expect(facade.getBlockHeight({ signal: controller.signal }))
      .rejects.toThrow('pool exhausted');
  });

  it('keeps subscriptions on the dedicated client instead of borrowing a request handle', async () => {
    const { facade, pool } = harness();

    await expect(facade.subscribeAddress('address'))
      .rejects.toThrow('dedicated Electrum client');
    await expect(facade.subscribeAddressBatch(['address']))
      .rejects.toThrow('dedicated Electrum client');
    expect(pool.acquire).not.toHaveBeenCalled();
  });
});
