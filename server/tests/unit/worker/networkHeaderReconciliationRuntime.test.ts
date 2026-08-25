import { describe, expect, it, vi } from 'vitest';
import { createNetworkHeaderReconciliationRuntime } from '../../../src/worker/networkHeaderReconciliationRuntime';
import type { NetworkHeaderReconciliationState } from '../../../src/repositories/networkHeaderReconciliationTypes';

const OWNER = 'runtime-owner-token-123456';
const HEADER = '00'.repeat(80);

function state(network: 'mainnet' | 'signet' = 'mainnet'): NetworkHeaderReconciliationState {
  return {
    network,
    generation: 1,
    ownerToken: OWNER,
    mode: 'genesis_rebuild',
    targetHeight: 0,
    targetHash: '0'.repeat(64),
    targetHeaderHex: HEADER,
    targetObservedAt: new Date('2026-08-24T00:00:00.000Z'),
    anchorHeight: 0,
    anchorHash: '0'.repeat(64),
    cursorHeight: null,
    cursorHash: null,
    confirmationCursorWalletId: null,
    confirmationEnumerationComplete: false,
    pendingTargetHeight: null,
    pendingTargetHash: null,
    pendingTargetPreviousHash: null,
    pendingTargetHeaderHex: null,
    pendingTargetObservedAt: null,
    pendingTargetGenesisHash: null,
    gapStartedAt: new Date('2026-08-24T00:00:00.000Z'),
    lastAttemptAt: null,
    lastFailureClass: null,
    consecutiveFailureCount: 0,
    retryEligibleAt: new Date('2026-08-24T00:00:00.000Z'),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function harness() {
  const reconciler = {
    observe: vi.fn(),
    attempt: vi.fn(),
  };
  const dependencies = {
    ownerToken: OWNER,
    reconciler,
    claim: vi.fn(),
    findDue: vi.fn(),
    activityEpoch: vi.fn(() => 1 as number | null),
  };
  return {
    dependencies,
    reconciler,
    runtime: createNetworkHeaderReconciliationRuntime(dependencies),
  };
}

describe('networkHeaderReconciliationRuntime', () => {
  it('serializes observations for one network without blocking another network', async () => {
    const { runtime, reconciler } = harness();
    const first = deferred<{ status: 'progressed'; state: NetworkHeaderReconciliationState }>();
    reconciler.observe
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ status: 'complete', height: 1, hash: 'a'.repeat(64) });
    const fetch = vi.fn();

    const mainnetFirst = runtime.observe('mainnet', { height: 1, hex: HEADER }, fetch);
    const mainnetSecond = runtime.observe('mainnet', { height: 2, hex: HEADER }, fetch);
    const signet = runtime.observe('signet', { height: 1, hex: HEADER }, fetch);
    await vi.waitFor(() => expect(reconciler.observe).toHaveBeenCalledTimes(2));
    expect(reconciler.observe.mock.calls.map(call => call[0])).toEqual(['mainnet', 'signet']);

    first.resolve({ status: 'progressed', state: state() });
    await Promise.all([mainnetFirst, mainnetSecond, signet]);
    expect(reconciler.observe).toHaveBeenCalledTimes(3);
    expect(reconciler.observe.mock.calls[2][0]).toBe('mainnet');
  });

  it('continues the per-network queue after an unexpected operation rejection', async () => {
    const { runtime, reconciler } = harness();
    reconciler.observe
      .mockRejectedValueOnce(new Error('unexpected failure'))
      .mockResolvedValueOnce({ status: 'complete', height: 2, hash: 'b'.repeat(64) });

    const first = runtime.observe('mainnet', { height: 1, hex: HEADER }, vi.fn());
    const second = runtime.observe('mainnet', { height: 2, hex: HEADER }, vi.fn());

    await expect(first).rejects.toThrow('unexpected failure');
    await expect(second).resolves.toMatchObject({ status: 'complete', height: 2 });
    expect(reconciler.observe).toHaveBeenCalledTimes(2);
  });

  it('does not let former-epoch work resume after ownership is reacquired', async () => {
    const { runtime, reconciler, dependencies } = harness();
    let epoch = 1;
    dependencies.activityEpoch.mockImplementation(() => epoch);
    const barrier = deferred<void>();
    reconciler.observe.mockImplementationOnce(async (...args) => {
      await barrier.promise;
      const isActive = args[4] as () => boolean;
      return isActive()
        ? { status: 'complete', height: 1, hash: 'a'.repeat(64) }
        : { status: 'deferred', failureClass: 'ownership_lost' };
    });

    const formerOwner = runtime.observe('mainnet', { height: 1, hex: HEADER }, vi.fn());
    await vi.waitFor(() => expect(reconciler.observe).toHaveBeenCalledOnce());
    epoch = 2;
    barrier.resolve();

    await expect(formerOwner).resolves.toEqual({
      status: 'deferred',
      failureClass: 'ownership_lost',
    });
  });

  it('claims and resumes due durable work after a startup observation registers transport', async () => {
    const { runtime, reconciler, dependencies } = harness();
    const pending = state();
    reconciler.observe.mockResolvedValue({ status: 'progressed', state: pending });
    reconciler.attempt.mockImplementation(async (_state, _fetch, isActive) => {
      expect(isActive()).toBe(true);
      return { status: 'complete', height: 0, hash: pending.targetHash };
    });
    dependencies.findDue.mockResolvedValue([pending]);
    dependencies.claim.mockResolvedValue({ ...pending, generation: 2 });
    const fetch = vi.fn();

    await runtime.observe('mainnet', { height: 0, hex: HEADER }, fetch);
    await runtime.recoverDue();

    expect(dependencies.claim).toHaveBeenCalledWith('mainnet', OWNER);
    expect(reconciler.attempt).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'mainnet', generation: 2 }),
      fetch,
      expect.any(Function),
    );
  });

  it('leaves due work untouched until its network has an owned transport', async () => {
    const { runtime, reconciler, dependencies } = harness();
    dependencies.findDue.mockResolvedValue([state('signet')]);

    await runtime.recoverDue();

    expect(dependencies.claim).not.toHaveBeenCalled();
    expect(reconciler.attempt).not.toHaveBeenCalled();
  });

  it('reports ownership loss when due work disappears before claim', async () => {
    const { runtime, reconciler, dependencies } = harness();
    const pending = state();
    reconciler.observe.mockResolvedValue({ status: 'progressed', state: pending });
    dependencies.findDue.mockResolvedValue([pending]);
    dependencies.claim.mockResolvedValue(null);
    await runtime.observe('mainnet', { height: 0, hex: HEADER }, vi.fn());

    await runtime.recoverDue();

    expect(dependencies.claim).toHaveBeenCalledOnce();
    expect(reconciler.attempt).not.toHaveBeenCalled();
  });

  it('coalesces overlapping due scans to one recovery attempt', async () => {
    const { runtime, reconciler, dependencies } = harness();
    const pending = state();
    const attempt = deferred<{ status: 'deferred'; failureClass: 'endpoint_unavailable' }>();
    reconciler.observe.mockResolvedValue({ status: 'complete', height: 0, hash: pending.targetHash });
    reconciler.attempt.mockReturnValue(attempt.promise);
    dependencies.findDue.mockResolvedValue([pending]);
    dependencies.claim.mockResolvedValue(pending);
    await runtime.observe('mainnet', { height: 0, hex: HEADER }, vi.fn());

    const first = runtime.recoverDue();
    const second = runtime.recoverDue();
    const third = runtime.recoverDue();
    await vi.waitFor(() => expect(reconciler.attempt).toHaveBeenCalledOnce());

    expect(dependencies.findDue).toHaveBeenCalledOnce();
    expect(dependencies.claim).toHaveBeenCalledOnce();
    attempt.resolve({ status: 'deferred', failureClass: 'endpoint_unavailable' });
    await Promise.all([first, second, third]);
    expect(reconciler.attempt).toHaveBeenCalledOnce();
  });

  it('does not queue due recovery behind an in-flight observation', async () => {
    const { runtime, reconciler, dependencies } = harness();
    const observation = deferred<{ status: 'deferred'; failureClass: 'endpoint_unavailable' }>();
    reconciler.observe.mockReturnValue(observation.promise);
    dependencies.findDue.mockResolvedValue([state()]);

    const observing = runtime.observe('mainnet', { height: 0, hex: HEADER }, vi.fn());
    await runtime.recoverDue();
    observation.resolve({ status: 'deferred', failureClass: 'endpoint_unavailable' });
    await observing;

    expect(dependencies.claim).not.toHaveBeenCalled();
    expect(reconciler.attempt).not.toHaveBeenCalled();
  });

  it('stops new and recovery work after ownership shutdown', async () => {
    const { runtime, reconciler, dependencies } = harness();
    runtime.stop();
    dependencies.findDue.mockResolvedValue([state()]);

    await expect(runtime.observe('mainnet', { height: 0, hex: HEADER }, vi.fn()))
      .resolves.toBeNull();
    await runtime.recoverDue();

    expect(reconciler.observe).not.toHaveBeenCalled();
    expect(dependencies.findDue).not.toHaveBeenCalled();
  });

  it('drains in-flight work and drops queued work during shutdown', async () => {
    const { runtime, reconciler } = harness();
    const attempt = deferred<{ status: 'complete'; height: number; hash: string }>();
    reconciler.observe.mockReturnValueOnce(attempt.promise);
    const first = runtime.observe('mainnet', { height: 1, hex: HEADER }, vi.fn());
    const queued = runtime.observe('mainnet', { height: 2, hex: HEADER }, vi.fn());
    await vi.waitFor(() => expect(reconciler.observe).toHaveBeenCalledOnce());

    let drained = false;
    const stopping = runtime.stop().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    attempt.resolve({ status: 'complete', height: 1, hash: 'a'.repeat(64) });

    await expect(Promise.all([first, queued, stopping])).resolves.toEqual([
      { status: 'complete', height: 1, hash: 'a'.repeat(64) },
      null,
      undefined,
    ]);
    expect(reconciler.observe).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight due scan during shutdown', async () => {
    const { runtime, dependencies } = harness();
    const scan = deferred<NetworkHeaderReconciliationState[]>();
    dependencies.findDue.mockReturnValueOnce(scan.promise);
    const recovering = runtime.recoverDue();
    await vi.waitFor(() => expect(dependencies.findDue).toHaveBeenCalledOnce());

    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    scan.resolve([]);

    await Promise.all([recovering, stopping]);
    expect(stopped).toBe(true);
  });
});
