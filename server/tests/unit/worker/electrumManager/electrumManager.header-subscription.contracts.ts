import { expect, it, vi } from 'vitest';
import { setupEventHandlers, subscribeHeaders } from '../../../../src/worker/electrumManager/networkConnection';
import type { NetworkState } from '../../../../src/worker/electrumManager/types';
import { mockCallbacks, mockClient } from './electrumManagerTestHarness';

export function registerHeaderSubscriptionContracts() {
  it('skips subscribeHeaders when already subscribed', async () => {
    const state: NetworkState = {
      network: 'mainnet',
      client: mockClient as any,
      connected: true,
      subscribedToHeaders: true,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };

    await subscribeHeaders(state, mockCallbacks);
    expect(mockClient.subscribeHeaders).not.toHaveBeenCalled();
  });

  it('covers direct header subscription and inactive entry/failure guards', async () => {
    const state: NetworkState = {
      network: 'mainnet', client: mockClient as any, connected: true,
      subscribedToHeaders: false, subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
    };
    await subscribeHeaders(state, mockCallbacks);
    expect(state.subscribedToHeaders).toBe(true);

    state.subscribedToHeaders = false;
    await subscribeHeaders(state, mockCallbacks, () => false);
    expect(mockClient.disconnect).toHaveBeenCalled();

    let active = true;
    mockClient.subscribeHeaders.mockImplementationOnce(async () => {
      active = false;
      throw new Error('closed during headers');
    });
    await expect(subscribeHeaders(state, mockCallbacks, () => active)).resolves.toBeUndefined();
    expect(state.subscribedToHeaders).toBe(false);
  });

  it('ingresses the startup tip before a live header that races its subscribe response', async () => {
    const state: NetworkState = {
      network: 'mainnet', client: mockClient as any, connected: true,
      subscribedToHeaders: false, subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
    };
    let resolveSubscription!: (header: { height: number; hex: string }) => void;
    mockClient.subscribeHeaders.mockReturnValueOnce(new Promise(resolve => {
      resolveSubscription = resolve;
    }));
    const observations: number[] = [];
    vi.mocked(mockCallbacks.onHeaderObservation).mockImplementation(async (_network, header, fetch) => {
      await fetch(header.height, 1);
      observations.push(header.height);
    });
    setupEventHandlers(state, new Map(), mockCallbacks, () => true, vi.fn());

    const subscription = subscribeHeaders(state, mockCallbacks);
    mockClient.emit('newBlock', { height: 101, hex: 'a'.repeat(160) });
    resolveSubscription({ height: 100, hex: 'b'.repeat(160) });
    await subscription;

    expect(observations).toEqual([100, 101]);
    expect(state.lastBlockHeight).toBe(101);
    expect(state.subscribedToHeaders).toBe(true);
  });

  it('disconnects when ownership is lost while persisting the startup header', async () => {
    const state: NetworkState = {
      network: 'mainnet', client: mockClient as any, connected: true,
      subscribedToHeaders: false, subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
    };
    let active = true;
    vi.mocked(mockCallbacks.onHeaderObservation).mockImplementationOnce(async () => {
      active = false;
    });

    await subscribeHeaders(state, mockCallbacks, () => active);

    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(state.subscribedToHeaders).toBe(false);
    expect(state.lastBlockHeight).toBe(0);
  });

  it('disconnects without rethrowing when startup observation fails after shutdown', async () => {
    const state: NetworkState = {
      network: 'mainnet', client: mockClient as any, connected: true,
      subscribedToHeaders: false, subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
    };
    let active = true;
    vi.mocked(mockCallbacks.onHeaderObservation).mockImplementationOnce(async () => {
      active = false;
      throw new Error('shutdown interrupted startup persistence');
    });
    setupEventHandlers(state, new Map(), mockCallbacks, () => active, vi.fn());

    await expect(subscribeHeaders(state, mockCallbacks, () => active)).resolves.toBeUndefined();

    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(state.subscribedToHeaders).toBe(false);
  });

  it('stops draining buffered live headers when ownership is lost', async () => {
    const state: NetworkState = {
      network: 'mainnet', client: mockClient as any, connected: true,
      subscribedToHeaders: false, subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
    };
    let resolveSubscription!: (header: { height: number; hex: string }) => void;
    mockClient.subscribeHeaders.mockReturnValueOnce(new Promise(resolve => {
      resolveSubscription = resolve;
    }));
    let active = true;
    const observed: number[] = [];
    vi.mocked(mockCallbacks.onHeaderObservation).mockImplementation(async (_network, header) => {
      observed.push(header.height);
      if (header.height === 102) active = false;
    });
    setupEventHandlers(state, new Map(), mockCallbacks, () => active, vi.fn());

    const subscription = subscribeHeaders(state, mockCallbacks, () => active);
    mockClient.emit('newBlock', { height: 101, hex: 'a'.repeat(160) });
    mockClient.emit('newBlock', { height: 102, hex: 'b'.repeat(160) });
    resolveSubscription({ height: 100, hex: 'c'.repeat(160) });
    await subscription;

    expect(observed).toEqual([100, 102]);
    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(state.subscribedToHeaders).toBe(false);
  });

  it('bounds startup to one coalesced header when live notifications keep arriving', async () => {
    const state: NetworkState = {
      network: 'mainnet', client: mockClient as any, connected: true,
      subscribedToHeaders: false, subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
    };
    let finishBuffered!: () => void;
    const buffered = new Promise<void>(resolve => { finishBuffered = resolve; });
    const neverSettles = new Promise<void>(() => undefined);
    vi.mocked(mockCallbacks.onHeaderObservation).mockImplementation(async (_network, header) => {
      if (header.height === 101) await buffered;
      if (header.height === 102) await neverSettles;
      return null;
    });
    setupEventHandlers(state, new Map(), mockCallbacks, () => true, vi.fn());

    mockClient.emit('newBlock', { height: 101, hex: 'a'.repeat(160) });
    const subscription = subscribeHeaders(state, mockCallbacks);
    await vi.waitFor(() => expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledTimes(2));
    for (let height = 102; height <= 110; height += 1) {
      mockClient.emit('newBlock', { height, hex: 'b'.repeat(160) });
    }
    expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledTimes(2);
    finishBuffered();

    await expect(subscription).resolves.toBeUndefined();
    await vi.waitFor(() => expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledTimes(3));
    expect(mockCallbacks.onHeaderObservation).toHaveBeenLastCalledWith(
      'mainnet',
      { height: 110, hex: 'b'.repeat(160) },
      expect.any(Function),
    );
    expect(state.subscribedToHeaders).toBe(true);
  });
}
