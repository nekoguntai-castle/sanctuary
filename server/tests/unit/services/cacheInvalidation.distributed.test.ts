import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (data: any) => unknown;

const distributedBus = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  const remoteHandlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    remoteHandlers,
    published: [] as Array<{ event: string; data: unknown }>,
    onRemote: vi.fn((event: string, handler: Handler) => {
      const listeners = remoteHandlers.get(event) ?? new Set<Handler>();
      listeners.add(handler);
      remoteHandlers.set(event, listeners);
      return () => listeners.delete(handler);
    }),
    /** Distributed publish from this process (local echo not delivered to onRemote). */
    publish: vi.fn(function publish(this: void, event: string, data: unknown) {
      distributedBus.published.push({ event, data });
    }),
    /** Delivery of an event published by another instance. */
    deliverRemote: async (event: string, data: unknown) => {
      await Promise.all(
        [...(remoteHandlers.get(event) ?? [])].map(handler => handler(data)),
      );
    },
    resyncHandlers: new Set<() => unknown>(),
    onResync: vi.fn((handler: () => unknown) => {
      distributedBus.resyncHandlers.add(handler);
      return () => distributedBus.resyncHandlers.delete(handler);
    }),
    /** This process may have missed messages (subscriber reconnect, peer publish failure). */
    resync: async () => {
      await Promise.all([...distributedBus.resyncHandlers].map(handler => handler()));
    },
    on: vi.fn((event: string, handler: Handler) => {
      const listeners = handlers.get(event) ?? new Set<Handler>();
      listeners.add(handler);
      handlers.set(event, listeners);
      return () => listeners.delete(handler);
    }),
    emit: async (event: string, data: unknown) => {
      await Promise.all(
        [...(handlers.get(event) ?? [])].map(handler => handler(data)),
      );
    },
  };
});

const cacheMocks = vi.hoisted(() => ({
  wallet: {
    deletePattern: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/infrastructure', () => ({
  getDistributedEventBus: () => ({
    on: distributedBus.on,
    onRemote: distributedBus.onRemote,
    onResync: distributedBus.onResync,
    emit: distributedBus.publish,
  }),
}));

vi.mock('../../../src/services/cache', () => ({
  walletCache: cacheMocks.wallet,
  feeCache: { clear: vi.fn() },
  priceCache: { clear: vi.fn() },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { eventBus } from '../../../src/events/eventBus';
import {
  initializeCacheInvalidation,
  shutdownCacheInvalidation,
} from '../../../src/services/cacheInvalidation';

describe('cache invalidation event-bus ownership', () => {
  beforeEach(() => {
    shutdownCacheInvalidation();
    distributedBus.handlers.clear();
    distributedBus.remoteHandlers.clear();
    distributedBus.published.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => shutdownCacheInvalidation());

  it('keeps local producers local and subscribes sync transitions across processes', async () => {
    initializeCacheInvalidation();

    eventBus.emit('transaction:confirmed', {
      walletId: 'local-wallet',
      txid: 'tx-1',
      confirmations: 1,
      blockHeight: 1,
    });
    await distributedBus.emit('wallet:syncTransition', {
      walletId: 'worker-wallet',
      transition: 'succeeded',
      stateVersion: 2,
    });

    await vi.waitFor(() => {
      expect(cacheMocks.wallet.delete).toHaveBeenCalledWith('tx-stats:local-wallet');
      expect(cacheMocks.wallet.delete).toHaveBeenCalledWith('tx-stats:worker-wallet');
    });
    expect(distributedBus.on).toHaveBeenCalledWith(
      'wallet:syncTransition',
      expect.any(Function),
    );
    expect(eventBus.listenerCount('transaction:confirmed')).toBeGreaterThan(0);
  });

  // Regression: deletes, balance changes and transaction events invalidated
  // only the in-memory wallet caches of the process that saw them, so other
  // API replicas served stale balance history/stats until their TTL expired.
  it('publishes local wallet invalidations for other processes', async () => {
    initializeCacheInvalidation();

    eventBus.emit('wallet:deleted', { walletId: 'deleted-wallet' } as any);

    await vi.waitFor(() => {
      expect(distributedBus.published).toContainEqual({
        event: 'cache:invalidated',
        data: { scope: 'wallet', walletId: 'deleted-wallet' },
      });
    });
  });

  it('coalesces a burst of invalidations into one publish per wallet', async () => {
    initializeCacheInvalidation();

    for (const txid of ['a', 'b', 'c']) {
      eventBus.emit('transaction:confirmed', { walletId: 'busy-wallet', txid, confirmations: 1, blockHeight: 1 });
    }
    eventBus.emit('transaction:confirmed', { walletId: 'other-wallet', txid: 'd', confirmations: 1, blockHeight: 1 });

    await vi.waitFor(() => {
      expect(distributedBus.published).toHaveLength(2);
    });
    expect(distributedBus.published).toEqual(expect.arrayContaining([
      { event: 'cache:invalidated', data: { scope: 'wallet', walletId: 'busy-wallet' } },
      { event: 'cache:invalidated', data: { scope: 'wallet', walletId: 'other-wallet' } },
    ]));
  });

  it('flushes pending publishes on shutdown', async () => {
    initializeCacheInvalidation();
    eventBus.emit('wallet:deleted', { walletId: 'closing-wallet' } as any);
    await vi.waitFor(() => expect(cacheMocks.wallet.delete).toHaveBeenCalledWith('tx-stats:closing-wallet'));

    shutdownCacheInvalidation();

    expect(distributedBus.published).toContainEqual({
      event: 'cache:invalidated',
      data: { scope: 'wallet', walletId: 'closing-wallet' },
    });
  });

  // Regression: an invalidation published while this replica's subscriber was
  // disconnected (or that another process failed to publish) was lost, and the
  // entries it named stayed stale until their TTL.
  it('drops every wallet entry when it may have missed invalidations', async () => {
    const cache = await import('../../../src/services/cache');
    initializeCacheInvalidation();

    await distributedBus.resync();

    expect(cacheMocks.wallet.clear).toHaveBeenCalledTimes(1);
    // Short-TTL price/fee entries are kept: clearing price also drops its stale fallback.
    expect(cache.priceCache.clear).not.toHaveBeenCalled();
    expect(cache.feeCache.clear).not.toHaveBeenCalled();
  });

  it('stops resyncing after shutdown', async () => {
    initializeCacheInvalidation();
    shutdownCacheInvalidation();

    await distributedBus.resync();

    expect(cacheMocks.wallet.clear).not.toHaveBeenCalled();
  });

  it('applies wallet invalidations published by other processes', async () => {
    initializeCacheInvalidation();

    await distributedBus.deliverRemote('cache:invalidated', { scope: 'wallet', walletId: 'remote-wallet' });

    expect(cacheMocks.wallet.delete).toHaveBeenCalledWith('tx-stats:remote-wallet');
    expect(distributedBus.published).toHaveLength(0); // never re-published
  });

  it('applies remote price and fee invalidations and ignores malformed ones', async () => {
    const cache = await import('../../../src/services/cache');
    initializeCacheInvalidation();

    await distributedBus.deliverRemote('cache:invalidated', { scope: 'price' });
    await distributedBus.deliverRemote('cache:invalidated', { scope: 'fees' });
    await distributedBus.deliverRemote('cache:invalidated', { scope: 'wallet' });
    await distributedBus.deliverRemote('cache:invalidated', { scope: 'wallet', walletId: '' });
    await distributedBus.deliverRemote('cache:invalidated', { scope: 'everything' });
    await distributedBus.deliverRemote('cache:invalidated', null);

    expect(cache.priceCache.clear).toHaveBeenCalledTimes(1);
    expect(cache.feeCache.clear).toHaveBeenCalledTimes(1);
    expect(cacheMocks.wallet.delete).not.toHaveBeenCalled();
  });

  it('publishes local price and fee invalidations', async () => {
    initializeCacheInvalidation();

    eventBus.emit('blockchain:priceUpdated', { price: 1 } as any);
    eventBus.emit('blockchain:feeEstimateUpdated', { fastest: 1 } as any);

    await vi.waitFor(() => {
      expect(distributedBus.published).toEqual(expect.arrayContaining([
        { event: 'cache:invalidated', data: { scope: 'price' } },
        { event: 'cache:invalidated', data: { scope: 'fees' } },
      ]));
    });
  });
});
