import { it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import { syncJobPrismaMocks, syncIntentMocks } from './syncJobsTestMocks';
import { acquiredExecution, canonicalIntentState, canonicalJob } from './syncJobs.test.fixtures';
import { syncWallet } from '../../../../src/services/bitcoin/blockchain';
import { WalletSyncAttemptTelemetry } from '../../../../src/worker/walletSyncAttemptTelemetry';
import type { createSyncWalletJob } from '../../../../src/worker/jobs/syncJobs';
import prisma from '../../../../src/models/prisma';

export function registerSyncJobRetryContracts(syncWalletJob: ReturnType<typeof createSyncWalletJob>) {
  it('best-effort wakes the exact trailing generation after durable completion', async () => {
    syncIntentMocks.claimFresh.mockResolvedValueOnce({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'lease-token' },
      state: canonicalIntentState({ requestedIncrementalSyncGeneration: 2 }),
    });
    syncIntentMocks.complete.mockResolvedValueOnce({
      status: 'applied',
      state: canonicalIntentState({
        requestedIncrementalSyncGeneration: 2,
        processedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: null,
      }),
      trailingGenerationPending: true,
    });
    syncIntentMocks.wake.mockResolvedValueOnce(false);

    await expect(syncWalletJob.handler(
      canonicalJob(),
      acquiredExecution(),
    )).resolves.toMatchObject({ success: true });

    expect(syncIntentMocks.wake).toHaveBeenCalledWith('wallet-intent', 2);
  });

  it.each([
    { attemptsMade: 0, transition: 'retrying', release: 'releaseForRetry' },
    { attemptsMade: 2, transition: 'failed', release: 'releaseAsActionRequired' },
  ] as const)(
    'fenced-releases a canonical failure as $transition',
    async ({ attemptsMade, transition, release }) => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState(),
      });
      syncIntentMocks[release].mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({
          syncInProgress: false,
          lastSyncStatus: transition === 'failed' ? 'failed' : 'retrying',
        }),
      });
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('electrum unavailable'));

      await expect(syncWalletJob.handler(
        canonicalJob(attemptsMade),
        acquiredExecution(),
      )).rejects.toThrow('electrum unavailable');

      expect(syncIntentMocks[release]).toHaveBeenCalledWith(
        'wallet-intent',
        { walletId: 'wallet-intent', generation: 1, leaseToken: 'lease-token' },
        expect.objectContaining({
          errorMessage: 'electrum unavailable',
          failureClass: expect.any(String),
        }),
      );
      const publishedTransition = expect.objectContaining({ transition });
      if (transition === 'retrying') {
        expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenLastCalledWith(
          publishedTransition,
          expect.anything(),
        );
      } else {
        expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenLastCalledWith(
          publishedTransition,
        );
      }
    },
  );

  it('records the canonical timeout callback before releasing the fenced attempt', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'recordAttemptTimeout');
    const graceSpy = vi.spyOn(
      WalletSyncAttemptTelemetry.prototype,
      'recordAbortGraceExhaustion',
    );
    syncIntentMocks.claimFresh.mockResolvedValueOnce({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'lease-timeout' },
      state: canonicalIntentState(),
    });
    syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
      status: 'applied',
      state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
    });
    vi.mocked(syncWallet).mockImplementationOnce(async () => (
      new Promise(() => undefined)
    ) as never);

    const pending = syncWalletJob.handler(canonicalJob(), acquiredExecution());
    const rejection = pending.catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(150_000);

    await expect(rejection).resolves.toMatchObject({
      message: 'Sync attempt timed out after 120000ms',
    });
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(graceSpy).toHaveBeenCalledOnce();
    expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledWith(
      'wallet-intent',
      expect.objectContaining({ leaseToken: 'lease-timeout' }),
      expect.objectContaining({ errorMessage: 'Sync attempt timed out after 120000ms' }),
    );
    vi.useRealTimers();
  });

  it('records canonical parent abort before releasing the fenced attempt', async () => {
    const abortSpy = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'recordAttemptAbort');
    const controller = new AbortController();
    const reason = new Error('worker shutting down');
    let notifyStarted!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    syncIntentMocks.claimFresh.mockResolvedValueOnce({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'lease-abort' },
      state: canonicalIntentState(),
    });
    syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
      status: 'applied',
      state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
    });
    vi.mocked(syncWallet).mockImplementationOnce(async (_walletId, _depth, signal) => {
      notifyStarted();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }) as never;
    });
    const execution = {
      signal: controller.signal,
      throwIfAborted: () => controller.signal.throwIfAborted(),
      acquiredLock: { key: 'sync:wallet:wallet-intent', token: 'a'.repeat(32) },
    };

    const pending = syncWalletJob.handler(canonicalJob(), execution);
    const rejection = pending.catch(error => error);
    await started;
    controller.abort(reason);

    await expect(rejection).resolves.toBe(reason);
    expect(abortSpy).toHaveBeenCalledOnce();
    expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledWith(
      'wallet-intent',
      expect.objectContaining({ leaseToken: 'lease-abort' }),
      expect.objectContaining({ errorMessage: 'worker shutting down' }),
    );
  });

  it('uses the canonical retry budget when BullMQ omits job attempt options', async () => {
    syncIntentMocks.claimFresh.mockResolvedValueOnce({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'lease-token' },
      state: canonicalIntentState(),
    });
    syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
      status: 'applied',
      state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
    });
    vi.mocked(syncWallet).mockRejectedValueOnce(new Error('temporary failure'));
    const job = canonicalJob(0);
    job.opts = {};

    await expect(syncWalletJob.handler(job, acquiredExecution()))
      .rejects.toThrow('temporary failure');

    expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledOnce();
    expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ transition: 'retrying' }),
      { maxRetries: 2 },
    );
  });

  it('does not write retry or failure state after losing the completion fence', async () => {
    syncIntentMocks.claimFresh.mockResolvedValueOnce({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'lease-token' },
      state: canonicalIntentState(),
    });
    syncIntentMocks.complete.mockResolvedValueOnce({ status: 'lost_fence' });

    await expect(syncWalletJob.handler(
      canonicalJob(),
      acquiredExecution(),
    )).rejects.toThrow('Incremental sync fence was lost');

    expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
    expect(syncIntentMocks.releaseAsActionRequired).not.toHaveBeenCalled();
  });

  it.each([
    { attemptsMade: 0, release: 'releaseForRetry' },
    { attemptsMade: 2, release: 'releaseAsActionRequired' },
  ] as const)('does not publish a terminal transition after losing the $release fence', async ({
    attemptsMade,
    release,
  }) => {
    syncIntentMocks.claimFresh.mockResolvedValueOnce({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'lease-token' },
      state: canonicalIntentState(),
    });
    syncIntentMocks[release].mockResolvedValueOnce({ status: 'lost_fence' });
    vi.mocked(syncWallet).mockRejectedValueOnce(new Error('electrum unavailable'));

    await expect(syncWalletJob.handler(
      canonicalJob(attemptsMade),
      acquiredExecution(),
    )).rejects.toThrow('electrum unavailable');

    expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenCalledTimes(1);
    expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ transition: 'started' }),
    );
  });

  it('rejects unknown wallet payload versions before repository effects', async () => {
    const job = {
      id: 'future-wallet-job',
      data: { version: 3, walletId: 'wallet-future' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    await expect(syncWalletJob.handler(job)).rejects.toThrow(
      'Unsupported sync-wallet job contract version',
    );
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(syncWallet).not.toHaveBeenCalled();
  });

  it('rejects an invalid v1 payload that still has a lock-safe wallet identity', async () => {
    const job = {
      id: 'invalid-wallet-job',
      data: { version: 1, walletId: 'wallet-invalid', reason: 42 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    await expect(syncWalletJob.handler(job)).rejects.toThrow(
      'Unsupported sync-wallet job contract version',
    );
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(syncWallet).not.toHaveBeenCalled();
  });

  it('rejects an unsupported full-resync contract even with a valid generation', async () => {
    const job = {
      id: 'unsupported-full-resync',
      data: {
        version: 3,
        walletId: 'wallet-invalid',
        fullResync: true,
        fullResyncGeneration: 1,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    await expect(syncWalletJob.handler(job)).rejects.toThrow(
      'Unsupported sync-wallet job contract version',
    );
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(syncIntentMocks.bridgeRetained).not.toHaveBeenCalled();
  });

  it('neutralizes retained stale-only work', async () => {
    const job = {
      id: 'b64_c3luYzpzdGFsZTp3YWxsZXQtMTox',
      name: 'sync-wallet',
      data: { version: 1, walletId: 'wallet-1', reason: 'stale' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    await expect(syncWalletJob.handler(job)).resolves.toEqual({
      version: 1,
      success: false,
      duration: 0,
      error: 'Stale-wallet scheduler work retired',
    });
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(syncWallet).not.toHaveBeenCalled();
  });
}
