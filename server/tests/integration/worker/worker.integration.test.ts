import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerTestHarness } from '../setup/workerHarness';

vi.mock('../../../src/services/bitcoin/electrum/methods', () => ({
  addressToScriptHash: vi.fn(() => 'c'.repeat(64)),
}));

const checkpointMocks = vi.hoisted(() => {
  const runtime = {
    enrollPendingPage: vi.fn(async () => ({
      scanned: 0,
      subscribed: 0,
      unavailable: 0,
      syncIntents: [],
      dispatch: {
        intents: 0,
        published: 0,
        publicationFailed: 0,
        woken: 0,
        wakeUnavailable: 0,
      },
    })),
    hasPendingWalletEnrollment: vi.fn(async () => false),
    recordStatusPage: vi.fn(async () => ({
      scanned: 0,
      completed: 0,
      unavailable: 0,
      syncIntents: [],
      dispatch: {
        intents: 0,
        published: 0,
        publicationFailed: 0,
        woken: 0,
        wakeUnavailable: 0,
      },
    })),
  };
  return {
    runtime,
    createProductionSubscriptionCheckpointRuntime: vi.fn(() => runtime),
  };
});

vi.mock('../../../src/worker/subscriptionCheckpointRuntime', () => ({
  createProductionSubscriptionCheckpointRuntime:
    checkpointMocks.createProductionSubscriptionCheckpointRuntime,
}));

describe('worker integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts services and schedules recurring jobs', async () => {
    const harness = await createWorkerTestHarness();

    expect(harness.jobQueue.initialize).toHaveBeenCalled();
    expect(harness.electrumManager.start).toHaveBeenCalled();
    expect(checkpointMocks.createProductionSubscriptionCheckpointRuntime).toHaveBeenCalledOnce();
    expect(harness.jobQueue.startConsumers).toHaveBeenCalledOnce();
    expect(harness.electrumManager.start.mock.invocationCallOrder[0]).toBeLessThan(
      harness.jobQueue.startConsumers.mock.invocationCallOrder[0],
    );
    expect(harness.registerWorkerJobs).toHaveBeenCalled();
    expect(harness.walletSyncRecoveryRuntime.start).toHaveBeenCalledOnce();

    expect(harness.jobQueue.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'sync:check-stale-wallets',
        recurrence: { every: 300_000 },
      }),
    );
    expect(harness.jobQueue.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'confirmations:update-all-confirmations',
        recurrence: { every: 120_000 },
      }),
    );
    expect(harness.jobQueue.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'maintenance:cleanup:expired-drafts',
        recurrence: { pattern: '0 * * * *', tz: 'UTC' },
      }),
    );

    harness.stopProcessExitSpy();
  });

  it('queues jobs when electrum events fire', async () => {
    const harness = await createWorkerTestHarness();

    const onNewBlock = harness.electrumOptions.onNewBlock!;
    const onAddressActivity = harness.electrumOptions.onAddressActivity!;
    const onSubscriptionStatuses = harness.electrumOptions.onSubscriptionStatuses!;
    harness.electrumManager.isSubscriptionOwner = vi.fn(() => true);

    onNewBlock('testnet3', 123, 'hash-123');
    onAddressActivity('testnet3', 'a'.repeat(64), 'b'.repeat(64));
    await onSubscriptionStatuses(
      'testnet3',
      new Map([['tb1q-authoritative-address', 'd'.repeat(64)]]),
    );

    expect(harness.jobQueue.addJob).toHaveBeenCalledWith(
      'confirmations',
      'update-confirmations',
      { version: 2, network: 'testnet3', height: 123, hash: 'hash-123' },
      { priority: 1, jobId: 'confirmations:testnet3:123:hash-123' },
    );

    await vi.waitFor(() => {
      expect(checkpointMocks.runtime.recordStatusPage).toHaveBeenCalledWith({
        network: 'testnet3',
        scriptHash: 'a'.repeat(64),
        observedStatus: 'b'.repeat(64),
        limit: 200,
      });
    });
    expect(checkpointMocks.runtime.recordStatusPage).toHaveBeenCalledWith({
      network: 'testnet3',
      scriptHash: 'c'.repeat(64),
      observedStatus: 'd'.repeat(64),
      limit: 200,
    });
    expect(harness.requestSyncIntent).not.toHaveBeenCalled();
    expect(harness.jobQueue.addJob.mock.calls).not.toContainEqual(
      expect.arrayContaining(['sync', 'sync-wallet']),
    );

    harness.stopProcessExitSpy();
  });

  it('shuts down cleanly on SIGTERM', async () => {
    const harness = await createWorkerTestHarness();

    await harness.shutdown();

    expect(harness.healthServer.close).toHaveBeenCalled();
    expect(harness.electrumManager.stop).toHaveBeenCalled();
    expect(harness.jobQueue.shutdown).toHaveBeenCalled();
    expect(harness.walletSyncRecoveryRuntime.stop).toHaveBeenCalledOnce();
    expect(harness.exitSpy).toHaveBeenCalledWith(0);

    harness.stopProcessExitSpy();
  });
});
