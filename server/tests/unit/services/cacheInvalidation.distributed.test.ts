import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (data: any) => unknown;

const distributedBus = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
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
  },
}));

vi.mock('../../../src/infrastructure', () => ({
  getDistributedEventBus: () => distributedBus,
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
});
