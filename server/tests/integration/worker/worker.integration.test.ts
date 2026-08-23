import { describe, expect, it, vi } from 'vitest';
import { createWorkerTestHarness } from '../setup/workerHarness';

describe('worker integration', () => {
  it('starts services and schedules recurring jobs', async () => {
    const harness = await createWorkerTestHarness();

    expect(harness.jobQueue.initialize).toHaveBeenCalled();
    expect(harness.electrumManager.start).toHaveBeenCalled();
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

    onNewBlock('testnet3', 123, 'hash-123');
    onAddressActivity('testnet3', 'wallet-1', 'addr-1');

    expect(harness.jobQueue.addJob).toHaveBeenCalledWith(
      'confirmations',
      'update-confirmations',
      { version: 1, height: 123, hash: 'hash-123' },
      { priority: 1, jobId: 'confirmations:123' }
    );

    expect(harness.requestSyncIntent).toHaveBeenCalledWith('wallet-1');
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
