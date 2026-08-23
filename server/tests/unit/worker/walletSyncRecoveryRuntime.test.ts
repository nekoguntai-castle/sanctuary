import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WalletSyncActivationState } from '../../../src/services/sync/walletSyncActivationGate';
import type { SyncIntentRecoveryCoordinator } from '../../../src/worker/syncIntentRecovery';
import { createWalletSyncRecoveryRuntime } from '../../../src/worker/walletSyncRecoveryRuntime';

const ACTIVE: WalletSyncActivationState = {
  status: 'active',
  requiredFloor: 1,
  activatedAt: '2026-08-22T12:00:00.000Z',
};
const DORMANT: WalletSyncActivationState = { status: 'dormant', requiredFloor: 1 };

function coordinator(): SyncIntentRecoveryCoordinator {
  return {
    start: vi.fn().mockResolvedValue({}),
    runNow: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as SyncIntentRecoveryCoordinator;
}

function timers() {
  let callback: (() => void) | undefined;
  const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
  return {
    get callback() { return callback; },
    timer,
    setInterval: vi.fn((next: () => void) => {
      callback = next;
      return timer;
    }) as unknown as typeof globalThis.setInterval,
    clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
  };
}

describe('walletSyncRecoveryRuntime', () => {
  it('keeps recovery dormant while polling activation and exposes the latest state', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    const clock = timers();
    const activate = vi.fn().mockResolvedValue(DORMANT);
    const runtime = createWalletSyncRecoveryRuntime({
      activate,
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    await runtime.start();
    clock.callback?.();
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));

    expect(runtime.getActivationState()).toEqual(DORMANT);
    expect(recovery.start).not.toHaveBeenCalled();
    expect(recovery.runNow).not.toHaveBeenCalled();
    expect(clock.timer.unref).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it('starts bounded recovery once after stabilization and repairs on Redis reconnect', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    const clock = timers();
    const activate = vi.fn()
      .mockResolvedValueOnce(DORMANT)
      .mockResolvedValue(ACTIVE);
    const runtime = createWalletSyncRecoveryRuntime({
      activate,
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    await runtime.start();
    clock.callback?.();
    await vi.waitFor(() => expect(recovery.start).toHaveBeenCalledOnce());
    redis.emit('ready');
    await vi.waitFor(() => expect(recovery.runNow).toHaveBeenCalledOnce());

    expect(runtime.getActivationState()).toEqual(ACTIVE);
    clock.callback?.();
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(4));
    expect(recovery.start).toHaveBeenCalledOnce();
    expect(recovery.runNow).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it('coalesces overlapping checks without losing a reconnect recovery request', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    const clock = timers();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const activate = vi.fn()
      .mockImplementationOnce(async () => {
        await blocked;
        return ACTIVE;
      })
      .mockResolvedValue(ACTIVE);
    const runtime = createWalletSyncRecoveryRuntime({
      activate,
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    const started = runtime.start();
    redis.emit('ready');
    clock.callback?.();
    release?.();
    await started;
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));

    expect(recovery.start).toHaveBeenCalledOnce();
    expect(recovery.runNow).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it('contains activation failures and retries them on the next check', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    const clock = timers();
    const activate = vi.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(ACTIVE);
    const runtime = createWalletSyncRecoveryRuntime({
      activate,
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    await runtime.start();
    expect(runtime.getActivationState()).toMatchObject({
      status: 'unavailable',
      reason: 'policy_unavailable',
    });
    clock.callback?.();
    await vi.waitFor(() => expect(recovery.start).toHaveBeenCalledOnce());
    await runtime.stop();
  });

  it('reports recovery startup failure distinctly and retries without duplicate timers', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    vi.mocked(recovery.start)
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce({} as never);
    const clock = timers();
    const runtime = createWalletSyncRecoveryRuntime({
      activate: vi.fn().mockResolvedValue(ACTIVE),
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    await runtime.start();
    expect(runtime.getActivationState()).toMatchObject({
      status: 'unavailable',
      reason: 'recovery_unavailable',
    });
    clock.callback?.();
    await vi.waitFor(() => expect(recovery.start).toHaveBeenCalledTimes(2));
    expect(clock.setInterval).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it('reports a reconnect recovery failure distinctly', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    vi.mocked(recovery.runNow).mockRejectedValueOnce(new Error('queue unavailable'));
    const clock = timers();
    const runtime = createWalletSyncRecoveryRuntime({
      activate: vi.fn().mockResolvedValue(ACTIVE),
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    await runtime.start();
    redis.emit('ready');
    await vi.waitFor(() => expect(runtime.getActivationState()).toMatchObject({
      status: 'unavailable',
      reason: 'recovery_unavailable',
    }));

    expect(recovery.runNow).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it('detaches, clears its timer, and waits for activation before stopping recovery', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    const clock = timers();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const activate = vi.fn(async () => {
      await blocked;
      return ACTIVE;
    });
    const runtime = createWalletSyncRecoveryRuntime({
      activate,
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    const started = runtime.start();
    const stopped = runtime.stop();
    expect(clock.clearInterval).toHaveBeenCalledWith(clock.timer);
    expect(recovery.stop).not.toHaveBeenCalled();
    release?.();
    await Promise.all([started, stopped]);

    expect(recovery.start).not.toHaveBeenCalled();
    expect(recovery.stop).toHaveBeenCalledOnce();
    expect(redis.listenerCount('ready')).toBe(0);
    redis.emit('ready');
    clock.callback?.();
    await Promise.resolve();
    expect(activate).toHaveBeenCalledOnce();
    await expect(runtime.start()).rejects.toThrow('is stopped');
    await runtime.stop();
  });

  it('starts one activation timer and can stop before it is started', async () => {
    const redis = new EventEmitter();
    const recovery = coordinator();
    const clock = timers();
    const runtime = createWalletSyncRecoveryRuntime({
      activate: vi.fn().mockResolvedValue(DORMANT),
      coordinator: recovery,
      redis,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });

    await runtime.start();
    await runtime.start();
    expect(clock.setInterval).toHaveBeenCalledOnce();
    await runtime.stop();

    const neverStartedClock = timers();
    const neverStartedRecovery = coordinator();
    const neverStarted = createWalletSyncRecoveryRuntime({
      activate: vi.fn(),
      coordinator: neverStartedRecovery,
      redis: new EventEmitter(),
      setInterval: neverStartedClock.setInterval,
      clearInterval: neverStartedClock.clearInterval,
    });
    await neverStarted.stop();
    expect(neverStartedClock.clearInterval).not.toHaveBeenCalled();
    expect(neverStartedRecovery.stop).toHaveBeenCalledOnce();
  });
});
