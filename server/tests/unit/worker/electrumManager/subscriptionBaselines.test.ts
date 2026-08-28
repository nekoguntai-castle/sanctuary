import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  attachSubscriptionBaseline,
  beginSubscriptionBaseline,
  bufferSubscriptionNotification,
  markSubscriptionResponse,
  releaseSubscriptionBaseline,
  releaseSubscriptionOperationWithBaseline,
} from '../../../../src/worker/electrumManager/subscriptionBaselines';
import type { NetworkState } from '../../../../src/worker/electrumManager/types';
import { subscribeAddressBatch } from '../../../../src/worker/electrumManager/addressSubscriptions';
import { setupEventHandlers } from '../../../../src/worker/electrumManager/networkConnection';

function state(): NetworkState {
  return {
    network: 'mainnet',
    client: new EventEmitter() as NetworkState['client'],
    connected: true,
    subscribedToHeaders: true,
    subscribedAddresses: new Set(),
    lastBlockHeight: 0,
    reconnectTimer: null,
    reconnectAttempts: 0,
  };
}

describe('subscription baseline barriers', () => {
  it('holds a live notification until its authoritative baseline is released', () => {
    const networkState = state();
    const activity = {
      scriptHash: 'a'.repeat(64),
      address: 'address-1',
      status: 'b'.repeat(64),
    };
    const delivered = vi.fn();
    networkState.client.on('addressActivity', delivered);
    const token = beginSubscriptionBaseline(networkState, ['address-1']);
    const statuses = new Map([['address-1', 'c'.repeat(64)]]);
    attachSubscriptionBaseline(statuses, token);

    expect(bufferSubscriptionNotification(networkState, activity)).toBe(true);
    expect(delivered).not.toHaveBeenCalled();
    releaseSubscriptionBaseline(statuses);

    expect(delivered).toHaveBeenCalledOnce();
    expect(delivered).toHaveBeenCalledWith(activity);
  });

  it('waits for every overlapping baseline regardless of release order', () => {
    const networkState = state();
    const delivered = vi.fn();
    networkState.client.on('addressActivity', delivered);
    const first = beginSubscriptionBaseline(networkState, ['address-1']);
    const second = beginSubscriptionBaseline(networkState, ['address-1']);
    const activity = {
      scriptHash: 'a'.repeat(64),
      address: 'address-1',
      status: 'd'.repeat(64),
    };

    expect(bufferSubscriptionNotification(networkState, activity)).toBe(true);
    releaseSubscriptionBaseline(second);
    expect(delivered).not.toHaveBeenCalled();
    releaseSubscriptionBaseline(first);
    releaseSubscriptionBaseline(first);

    expect(delivered).toHaveBeenCalledOnce();
  });

  it('drops a buffered notification that predates the authoritative response', () => {
    const networkState = state();
    const delivered = vi.fn();
    networkState.client.on('addressActivity', delivered);
    const baseline = beginSubscriptionBaseline(networkState, ['address-1']);

    expect(bufferSubscriptionNotification(networkState, {
      scriptHash: 'a'.repeat(64),
      address: 'address-1',
      status: 'b'.repeat(64),
      sequence: 1,
    })).toBe(true);
    markSubscriptionResponse(networkState, 'address-1', 2);
    releaseSubscriptionBaseline(baseline);

    expect(delivered).not.toHaveBeenCalled();
  });

  it('replays a buffered notification that follows the authoritative response', () => {
    const networkState = state();
    const delivered = vi.fn();
    networkState.client.on('addressActivity', delivered);
    const baseline = beginSubscriptionBaseline(networkState, ['address-1']);
    markSubscriptionResponse(networkState, 'address-1', 1);

    expect(bufferSubscriptionNotification(networkState, {
      scriptHash: 'a'.repeat(64),
      address: 'address-1',
      status: 'b'.repeat(64),
      sequence: 2,
    })).toBe(true);
    releaseSubscriptionBaseline(baseline);

    expect(delivered).toHaveBeenCalledOnce();
  });

  it('does not buffer an unmapped or unrelated notification', () => {
    const networkState = state();
    beginSubscriptionBaseline(networkState, ['address-1']);

    expect(bufferSubscriptionNotification(networkState, {
      scriptHash: 'a'.repeat(64),
      status: null,
    })).toBe(false);
    expect(() => markSubscriptionResponse(networkState, 'address-2', 1)).not.toThrow();
    expect(bufferSubscriptionNotification(networkState, {
      scriptHash: 'b'.repeat(64),
      address: 'address-2',
      status: null,
    })).toBe(false);
    expect(() => releaseSubscriptionBaseline(new Map())).not.toThrow();
  });

  it('releases an operation immediately when no baseline is attached', () => {
    const releaseOperation = vi.fn();

    releaseSubscriptionOperationWithBaseline(new Map(), releaseOperation);

    expect(releaseOperation).toHaveBeenCalledOnce();
  });

  it('holds notifications at the installed network event boundary', () => {
    const networkState = state();
    const onAddressActivity = vi.fn();
    setupEventHandlers(
      networkState,
      new Map(),
      {
        onHeaderObservation: vi.fn(),
        onAddressActivity,
      },
      () => true,
      vi.fn(),
    );
    const baseline = beginSubscriptionBaseline(networkState, ['address-1']);
    networkState.client.emit('subscriptionResponse', {
      address: 'address-1',
      sequence: 1,
    });

    networkState.client.emit('addressActivity', {
      scriptHash: 'a'.repeat(64),
      address: 'address-1',
      status: 'b'.repeat(64),
      sequence: 2,
    });
    expect(onAddressActivity).not.toHaveBeenCalled();
    releaseSubscriptionBaseline(baseline);

    expect(onAddressActivity).toHaveBeenCalledWith(
      'mainnet',
      'a'.repeat(64),
      'b'.repeat(64),
    );
  });

  it('publishes one authoritative observation for a 200-address response page', async () => {
    const networkState = state();
    const addresses = Array.from({ length: 200 }, (_, index) => ({
      address: `address-${index}`,
      walletId: `wallet-${index}`,
    }));
    const statuses = new Map(addresses.map(({ address }, index) => (
      [address, index.toString(16).padStart(64, '0')] as const
    )));
    networkState.client.subscribeAddressBatch = vi.fn().mockResolvedValue(statuses);
    const observeStatuses = vi.fn().mockResolvedValue(undefined);

    await expect(subscribeAddressBatch(networkState, addresses, { observeStatuses }))
      .resolves.toEqual(statuses);

    expect(networkState.client.subscribeAddressBatch).toHaveBeenCalledOnce();
    expect(observeStatuses).toHaveBeenCalledOnce();
    expect(observeStatuses).toHaveBeenCalledWith('mainnet', statuses);
  });

  it('serializes overlapping baseline observers before sending the next request', async () => {
    const networkState = state();
    const statuses = new Map([['address-1', 'a'.repeat(64)]]);
    networkState.client.subscribeAddressBatch = vi.fn().mockResolvedValue(statuses);
    let releaseFirst!: () => void;
    const firstObserver = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    const secondObserver = vi.fn().mockResolvedValue(undefined);
    const addresses = [{ address: 'address-1', walletId: 'wallet-1' }];

    const first = subscribeAddressBatch(networkState, addresses, {
      resubscribe: true,
      observeStatuses: firstObserver,
    });
    await vi.waitFor(() => expect(firstObserver).toHaveBeenCalledOnce());
    const second = subscribeAddressBatch(networkState, addresses, {
      resubscribe: true,
      observeStatuses: secondObserver,
    });
    await Promise.resolve();
    expect(networkState.client.subscribeAddressBatch).toHaveBeenCalledOnce();

    releaseFirst();
    await first;
    await second;
    expect(networkState.client.subscribeAddressBatch).toHaveBeenCalledTimes(2);
    expect(firstObserver).toHaveBeenCalledBefore(secondObserver);
  });

  it('holds the operation queue until deferred enrollment releases its baseline', async () => {
    const networkState = state();
    const statuses = new Map([['address-1', 'a'.repeat(64)]]);
    networkState.client.subscribeAddressBatch = vi.fn().mockResolvedValue(statuses);
    const addresses = [{ address: 'address-1', walletId: 'wallet-1' }];

    const firstStatuses = await subscribeAddressBatch(networkState, addresses, {
      resubscribe: true,
      deferBaselineRelease: true,
    });
    const second = subscribeAddressBatch(networkState, addresses, { resubscribe: true });
    await Promise.resolve();
    expect(networkState.client.subscribeAddressBatch).toHaveBeenCalledOnce();

    releaseSubscriptionBaseline(firstStatuses);
    await second;
    expect(networkState.client.subscribeAddressBatch).toHaveBeenCalledTimes(2);
  });
});
