import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTransactionsBatch } from '../../../../src/services/bitcoin/electrum/publicApi';
import { EVENT_LOOP_CPU_BURST_BUDGET_MS } from '../../../../src/utils/cooperativeScheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('Electrum public API transaction batch runtime', () => {
  it('does not start a request after its deadline', async () => {
    const batchRequest = vi.fn();

    await expect(getTransactionsBatch(
      batchRequest,
      raw => raw as never,
      ['aa'.repeat(32)],
      { deadlineAt: Date.now() },
    )).rejects.toThrow('deadline exhausted');

    expect(batchRequest).not.toHaveBeenCalled();
  });

  it('uses only the remaining deadline for a retry delay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const batchRequest = vi.fn().mockRejectedValue(new Error('request timeout'));
    const pending = getTransactionsBatch(
      batchRequest,
      raw => raw as never,
      ['aa'.repeat(32)],
      { deadlineAt: 1_100 },
    );
    const outcome = pending.catch(error => error as Error);

    await vi.advanceTimersByTimeAsync(100);

    await expect(outcome).resolves.toMatchObject({ message: expect.stringContaining('deadline exhausted') });
    expect(batchRequest).toHaveBeenCalledOnce();
  });

  it('provides a stable error when a legacy signal aborts a retry without a reason', async () => {
    let abortListener!: () => void;
    const signal = {
      aborted: false,
      reason: undefined,
      throwIfAborted: () => undefined,
      addEventListener: (_event: string, listener: () => void) => { abortListener = listener; },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const batchRequest = vi.fn().mockRejectedValue(new Error('request timeout'));
    const pending = getTransactionsBatch(
      batchRequest,
      raw => raw as never,
      ['aa'.repeat(32)],
      { signal, deadlineAt: Date.now() + 5_000 },
    );
    await vi.waitFor(() => expect(abortListener).toBeTypeOf('function'));

    abortListener();

    await expect(pending).rejects.toThrow('Electrum request cancelled');
  });

  it('yields to worker timers while decoding a CPU-heavy transaction batch', async () => {
    let heartbeatRan = false;
    setImmediate(() => { heartbeatRan = true; });
    const decode = vi.fn(() => {
      const startedAt = Date.now();
      while (Date.now() - startedAt <= EVENT_LOOP_CPU_BURST_BUDGET_MS) {
        // Model one expensive raw-transaction decode.
      }
      return { txid: 'aa'.repeat(32) } as never;
    });

    await getTransactionsBatch(
      vi.fn().mockResolvedValue(['raw-transaction']),
      decode,
      ['aa'.repeat(32)],
    );

    expect(heartbeatRan).toBe(true);
    expect(decode).toHaveBeenCalledOnce();
  });
});
