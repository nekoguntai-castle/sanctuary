import { describe, expect, it, vi } from 'vitest';
import { createWorkerTestHarness } from '../setup/workerHarness';

describe('worker integration', () => {
  it('starts services and schedules recurring jobs', async () => {
    const harness = await createWorkerTestHarness();

    expect(harness.jobQueue.initialize).toHaveBeenCalled();
    expect(harness.electrumManager.start).toHaveBeenCalled();
    expect(harness.registerWorkerJobs).toHaveBeenCalled();

    expect(harness.jobQueue.scheduleRecurring).toHaveBeenCalledWith(
      'sync',
      'check-stale-wallets',
      {},
      '*/5 * * * *'
    );
    expect(harness.jobQueue.scheduleRecurring).toHaveBeenCalledWith(
      'confirmations',
      'update-all-confirmations',
      {},
      '*/2 * * * *'
    );
    expect(harness.jobQueue.scheduleRecurring).toHaveBeenCalledWith(
      'maintenance',
      'cleanup:expired-drafts',
      {},
      '0 * * * *'
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
      { height: 123, hash: 'hash-123' },
      { priority: 1, jobId: 'confirmations:123' }
    );

    const syncCall = harness.jobQueue.addJob.mock.calls.find(
      ([queue, name]: [string, string, ...unknown[]]) => (
        queue === 'sync' && name === 'sync-wallet'
      )
    );
    expect(syncCall).toBeDefined();
    expect(syncCall![2]).toEqual({
      walletId: 'wallet-1',
      priority: 'high',
      reason: 'address_activity:addr-1',
    });
    expect(syncCall![3].priority).toBe(1);
    expect(syncCall![3].jobId).toMatch(/^sync:wallet-1:/);

    harness.stopProcessExitSpy();
  });

  it('shuts down cleanly on SIGTERM', async () => {
    const harness = await createWorkerTestHarness();

    await harness.shutdown();

    expect(harness.healthServer.close).toHaveBeenCalled();
    expect(harness.electrumManager.stop).toHaveBeenCalled();
    expect(harness.jobQueue.shutdown).toHaveBeenCalled();
    expect(harness.exitSpy).toHaveBeenCalledWith(0);

    harness.stopProcessExitSpy();
  });
});
