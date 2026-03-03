import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { getTransactionsBatch } from '../../../../src/services/bitcoin/electrum/methods';

const RAW_TX_HEX = (() => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32), 0);
  // OP_RETURN output keeps decoding deterministic without relying on network-specific address extraction.
  tx.addOutput(Buffer.from('6a', 'hex'), 0);
  return tx.toHex();
})();

describe('electrum methods getTransactionsBatch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty map for empty txid input', async () => {
    const batchRequest = vi.fn();
    const result = await getTransactionsBatch(batchRequest, [], 'testnet', 1000);

    expect(result.size).toBe(0);
    expect(batchRequest).not.toHaveBeenCalled();
  });

  it('maps decoded transaction results back to txids', async () => {
    const batchRequest = vi.fn().mockResolvedValue([RAW_TX_HEX]);

    const result = await getTransactionsBatch(
      batchRequest,
      ['a'.repeat(64)],
      'testnet',
      1000
    );

    expect(batchRequest).toHaveBeenCalledWith([
      { method: 'blockchain.transaction.get', params: ['a'.repeat(64), false] },
    ]);
    expect(result.size).toBe(1);
    expect(result.has('a'.repeat(64))).toBe(true);
  });

  it('retries timeout errors and succeeds on a later attempt', async () => {
    vi.useFakeTimers();
    const batchRequest = vi.fn()
      .mockRejectedValueOnce(new Error('request timeout'))
      .mockResolvedValueOnce([RAW_TX_HEX]);

    const pending = getTransactionsBatch(
      batchRequest,
      ['c'.repeat(64)],
      'testnet',
      1000
    );

    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;

    expect(batchRequest).toHaveBeenCalledTimes(2);
    expect(result.has('c'.repeat(64))).toBe(true);
  });

  it('rethrows non-timeout failures without retrying', async () => {
    const batchRequest = vi.fn().mockRejectedValueOnce(new Error('permission denied'));

    await expect(
      getTransactionsBatch(batchRequest, ['d'.repeat(64)], 'testnet', 1000)
    ).rejects.toThrow('permission denied');
    expect(batchRequest).toHaveBeenCalledTimes(1);
  });

  it('rethrows timeout errors after exhausting all retries', async () => {
    vi.useFakeTimers();
    const batchRequest = vi.fn().mockRejectedValue(new Error('timeout while querying electrum'));

    const pending = getTransactionsBatch(
      batchRequest,
      ['e'.repeat(64)],
      'testnet',
      1000
    );
    const rejection = expect(pending).rejects.toThrow('timeout while querying electrum');

    // Retry waits: 500ms then 1000ms
    await vi.advanceTimersByTimeAsync(1500);
    await rejection;
    expect(batchRequest).toHaveBeenCalledTimes(3);
  });
});
