import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import { LockAuthorityUnavailableError } from '../../../../src/infrastructure';
import {
  scheduleWalletLockAuthorityRetry,
  SubscriptionAuthorityRetryController,
} from '../../../../src/services/sync/lockAuthorityRecovery';
import type { SyncState } from '../../../../src/services/sync/types';

function createState(): SyncState {
  return {
    isRunning: true,
    syncQueue: [],
    activeSyncs: new Set(),
    activeLocks: new Map(),
    pendingRetries: new Map(),
    subscriptionsEnabled: true,
    subscriptionOwnership: 'unavailable',
    subscribedToHeaders: false,
    pollingMode: 'in-process',
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('lock authority recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('deduplicates wallet retry timers and reports callback rejection', async () => {
    const state = createState();
    const execute = vi.fn().mockRejectedValue(new Error('retry failed'));

    const first = scheduleWalletLockAuthorityRetry(state, 'wallet-1', 2, execute);
    const duplicate = scheduleWalletLockAuthorityRetry(state, 'wallet-1', 2, execute);

    expect(first.error).toContain('retrying');
    expect(duplicate.error).toContain('retrying');
    expect(state.pendingRetries.size).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith('wallet-1', 2);
    expect(state.pendingRetries.size).toBe(0);
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('does not invoke a wallet retry after the service stops', async () => {
    const state = createState();
    const execute = vi.fn();
    scheduleWalletLockAuthorityRetry(state, 'wallet-1', 0, execute);
    state.isRunning = false;

    await vi.advanceTimersByTimeAsync(1000);

    expect(execute).not.toHaveBeenCalled();
  });

  it('retries subscription setup after authority recovery', async () => {
    let ownership: SyncState['subscriptionOwnership'] = 'unavailable';
    const setup = vi.fn()
      .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'))
      .mockImplementationOnce(async () => {
        ownership = 'external';
      });
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => true,
      getOwnership: () => ownership,
      setup,
      teardown: vi.fn(),
      release: vi.fn(),
    });

    controller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(setup).toHaveBeenCalledTimes(2);
    expect(ownership).toBe('external');
  });

  it('keeps retrying while authority remains unavailable', async () => {
    let ownership: SyncState['subscriptionOwnership'] = 'unavailable';
    const setup = vi.fn()
      .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'))
      .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'))
      .mockImplementationOnce(async () => {
        ownership = 'external';
      });
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => true,
      getOwnership: () => ownership,
      setup,
      teardown: vi.fn(),
      release: vi.fn(),
    });

    controller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(setup).toHaveBeenCalledTimes(3);
    expect(ownership).toBe('external');
  });

  it('logs unexpected initial and retry setup failures without looping', async () => {
    let ownership: SyncState['subscriptionOwnership'] = 'external';
    const initialFailure = new SubscriptionAuthorityRetryController({
      isRunning: () => true,
      getOwnership: () => ownership,
      setup: vi.fn().mockRejectedValue(new Error('initial failure')),
      teardown: vi.fn(),
      release: vi.fn(),
    });
    initialFailure.start();
    await flushPromises();

    ownership = 'unavailable';
    const retrySetup = vi.fn()
      .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'))
      .mockImplementationOnce(async () => {
        ownership = 'external';
        throw new Error('retry failure');
      });
    const retryFailure = new SubscriptionAuthorityRetryController({
      isRunning: () => true,
      getOwnership: () => ownership,
      setup: retrySetup,
      teardown: vi.fn(),
      release: vi.fn(),
    });
    retryFailure.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(retrySetup).toHaveBeenCalledTimes(2);
    expect(mockLog.error).toHaveBeenCalledTimes(2);
  });

  it('cancels a scheduled subscription retry on stop', async () => {
    const setup = vi.fn().mockRejectedValue(
      new LockAuthorityUnavailableError('acquire'),
    );
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => true,
      getOwnership: () => 'unavailable',
      setup,
      teardown: vi.fn(),
      release: vi.fn(),
    });

    controller.start();
    await flushPromises();
    controller.stop();
    controller.stop();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(setup).toHaveBeenCalledOnce();
  });

  it('does not schedule or execute retries after shutdown starts', async () => {
    let running = false;
    const setup = vi.fn().mockRejectedValue(
      new LockAuthorityUnavailableError('acquire'),
    );
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => running,
      getOwnership: () => 'unavailable',
      setup,
      teardown: vi.fn(),
      release: vi.fn(),
    });

    controller.start();
    await flushPromises();
    running = true;
    controller.start();
    await flushPromises();
    running = false;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(setup).toHaveBeenCalledOnce();
  });

  it('cleans up an initial setup that completes after shutdown', async () => {
    let running = true;
    let resolveSetup: (() => void) | undefined;
    const setupPromise = new Promise<void>((resolve) => {
      resolveSetup = resolve;
    });
    const setup = vi.fn().mockReturnValue(setupPromise);
    const teardown = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => running,
      getOwnership: () => 'self',
      setup,
      teardown,
      release,
    });

    controller.start();
    running = false;
    controller.stop();
    resolveSetup?.();
    await flushPromises();

    expect(setup).toHaveBeenCalledOnce();
    expect(teardown).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('cleans stale setup and reacquires after a rapid restart', async () => {
    let running = true;
    let ownership: SyncState['subscriptionOwnership'] = 'self';
    let resolveStaleSetup: (() => void) | undefined;
    const staleSetup = new Promise<void>((resolve) => {
      resolveStaleSetup = resolve;
    });
    const setup = vi.fn()
      .mockReturnValueOnce(staleSetup)
      .mockImplementationOnce(async () => {
        ownership = 'external';
      });
    const teardown = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => running,
      getOwnership: () => ownership,
      setup,
      teardown,
      release,
    });

    controller.start();
    running = false;
    controller.stop();
    running = true;
    controller.start();
    resolveStaleSetup?.();
    await flushPromises();
    await flushPromises();

    expect(setup).toHaveBeenCalledTimes(2);
    expect(teardown).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(ownership).toBe('external');
  });

  it('cleans up retry setup that completes after shutdown', async () => {
    let running = true;
    let resolveRetry: (() => void) | undefined;
    const retry = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    const setup = vi.fn()
      .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'))
      .mockReturnValueOnce(retry);
    const teardown = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => running,
      getOwnership: () => 'unavailable',
      setup,
      teardown,
      release,
    });

    controller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000);
    running = false;
    resolveRetry?.();
    await flushPromises();

    expect(teardown).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('deduplicates scheduling while a timer or retry is active', async () => {
    let ownership: SyncState['subscriptionOwnership'] = 'unavailable';
    let resolveRetry: (() => void) | undefined;
    const retry = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    const setup = vi.fn()
      .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'))
      .mockReturnValueOnce(retry);
    const controller = new SubscriptionAuthorityRetryController({
      isRunning: () => true,
      getOwnership: () => ownership,
      setup,
      teardown: vi.fn(),
      release: vi.fn(),
    });

    controller.start();
    controller.start();
    await flushPromises();
    controller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000);
    controller.start();
    await flushPromises();
    ownership = 'external';
    resolveRetry?.();
    await flushPromises();

    expect(setup).toHaveBeenCalledTimes(2);
  });
});
