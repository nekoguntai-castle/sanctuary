import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTransactionsBatch } from '../../../../src/services/bitcoin/electrum/publicApi';

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
});
