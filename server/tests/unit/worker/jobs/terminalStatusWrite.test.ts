/**
 * Non-regression test for the 2026-08-20 green-badge-over-a-failure.
 *
 * `AMN-FND1` read `lastSyncStatus = success`, `lastSyncError = (none)`,
 * `lastSyncedAt = 15:33:05` while the worker log showed that wallet's very next
 * sync failing at 15:39:23 with
 * `Sync pipeline failed at phase "rbfCleanup": Connection terminated unexpectedly`.
 *
 * The failure-status write is attempted over the very Postgres pool that just
 * died, and its rejection was logged and swallowed — so the row kept the
 * previous success and the UI kept a green badge over a real failure. The one
 * class of error most likely to break the sync is exactly the class most likely
 * to break the write that records it.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { persistTerminalSyncStatus } from '../../../../src/worker/jobs/terminalStatus';

describe('persistTerminalSyncStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes once when the database is healthy', async () => {
    const updateSyncState = vi.fn().mockResolvedValue({});
    await expect(persistTerminalSyncStatus('w1', { lastSyncStatus: 'failed' }, { updateSyncState }))
      .resolves.toBe(true);
    expect(updateSyncState).toHaveBeenCalledTimes(1);
  });

  it('retries a rejected write and succeeds when the pool recovers', async () => {
    const updateSyncState = vi.fn()
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValueOnce({});

    const pending = persistTerminalSyncStatus('w2', { lastSyncStatus: 'failed' }, { updateSyncState });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(true);
    expect(updateSyncState).toHaveBeenCalledTimes(3);
  });

  it('gives up after a bounded number of attempts rather than hanging the job', async () => {
    const updateSyncState = vi.fn().mockRejectedValue(new Error('Connection terminated unexpectedly'));

    const pending = persistTerminalSyncStatus('w3', { lastSyncStatus: 'failed' }, { updateSyncState });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(false);
    expect(updateSyncState.mock.calls.length).toBeGreaterThan(1);
    expect(updateSyncState.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('passes the exact payload through unchanged on every attempt', async () => {
    const payload = {
      syncInProgress: false,
      lastSyncStatus: 'failed' as const,
      lastSyncError: 'Sync pipeline failed at phase "rbfCleanup": Connection terminated unexpectedly',
    };
    const updateSyncState = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({});

    const pending = persistTerminalSyncStatus('w4', payload, { updateSyncState });
    await vi.runAllTimersAsync();
    await pending;

    expect(updateSyncState).toHaveBeenNthCalledWith(1, 'w4', payload);
    expect(updateSyncState).toHaveBeenNthCalledWith(2, 'w4', payload);
  });

  it('never throws, so it cannot mask the original sync failure', async () => {
    const updateSyncState = vi.fn().mockRejectedValue(new Error('permanently down'));
    const pending = persistTerminalSyncStatus('w5', { lastSyncStatus: 'failed' }, { updateSyncState });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(false);
  });
});
