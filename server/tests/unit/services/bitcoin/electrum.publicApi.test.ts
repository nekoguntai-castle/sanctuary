import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRawTransactionEvidence,
  getRawTransactionEvidenceBatch,
  getTransactionsBatch,
} from '../../../../src/services/bitcoin/electrum/publicApi';
import { EVENT_LOOP_CPU_BURST_BUDGET_MS } from '../../../../src/utils/cooperativeScheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('Electrum public API transaction batch runtime', () => {
  it('returns raw transaction evidence without decoding or inventing missing results', async () => {
    const txids = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];
    const batchRequest = vi.fn().mockResolvedValue(['0102', undefined, { invalid: true }]);

    const result = await getRawTransactionEvidenceBatch(batchRequest, txids);

    expect(batchRequest).toHaveBeenCalledWith(txids.map(txid => ({
      method: 'blockchain.transaction.get',
      params: [txid, false],
    })));
    expect(result).toEqual(new Map([
      [txids[0], { txid: txids[0], hex: '0102', vin: [], vout: [] }],
      [txids[2], { txid: txids[2], hex: '', vin: [], vout: [] }],
    ]));
  });

  it('handles empty and deadline-expired raw evidence batches', async () => {
    const batchRequest = vi.fn();

    await expect(getRawTransactionEvidenceBatch(batchRequest, []))
      .resolves.toEqual(new Map());
    await expect(getRawTransactionEvidenceBatch(
      batchRequest,
      ['aa'.repeat(32)],
      { deadlineAt: Date.now() },
    )).rejects.toThrow('deadline exhausted');
    expect(batchRequest).not.toHaveBeenCalled();
  });

  it('checks the deadline again after a raw evidence batch returns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const batchRequest = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(1_100);
      return ['00'];
    });

    await expect(getRawTransactionEvidenceBatch(
      batchRequest,
      ['aa'.repeat(32)],
      { deadlineAt: 1_100 },
    )).rejects.toThrow('deadline exhausted');
  });

  it('returns one raw transaction evidence envelope', async () => {
    const request = vi.fn().mockResolvedValue('0102');

    await expect(getRawTransactionEvidence(request, 'aa'.repeat(32))).resolves.toEqual({
      txid: 'aa'.repeat(32),
      hex: '0102',
      vin: [],
      vout: [],
    });
    expect(request).toHaveBeenCalledWith(
      'blockchain.transaction.get',
      ['aa'.repeat(32), false],
    );
  });

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
