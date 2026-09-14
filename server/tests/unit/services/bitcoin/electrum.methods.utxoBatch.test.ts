import { describe, expect, it, vi } from 'vitest';
import { getAddressUTXOsBatch } from '../../../../src/services/bitcoin/electrum/methods';

const ADDR_1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ADDR_2 = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';

const VALID_UTXO = { tx_hash: 'a'.repeat(64), tx_pos: 0, height: 800000, value: 100_000 };

describe('electrum methods getAddressUTXOsBatch', () => {
  it('leaves an address absent from the result map when its batch item is invalid, instead of coercing it to an empty array', async () => {
    // ADDR_1's slot is a malformed response (null); ADDR_2's slot is valid.
    const batchRequest = vi.fn().mockResolvedValue([null, [VALID_UTXO]]);

    const result = await getAddressUTXOsBatch(batchRequest, [ADDR_1, ADDR_2], 'testnet3');

    expect(result.has(ADDR_1)).toBe(false);
    expect(result.get(ADDR_2)).toEqual([VALID_UTXO]);
  });

  it('leaves an address absent from the result map when its batch item fails schema validation', async () => {
    // Missing required fields (tx_pos/height/value) should not be silently coerced to [].
    const batchRequest = vi.fn().mockResolvedValue([{ tx_hash: 'a'.repeat(64) }]);

    const result = await getAddressUTXOsBatch(batchRequest, [ADDR_1], 'testnet3');

    expect(result.has(ADDR_1)).toBe(false);
    expect(result.size).toBe(0);
  });

  it('still maps valid results back to their addresses', async () => {
    const batchRequest = vi.fn().mockResolvedValue([[VALID_UTXO]]);

    const result = await getAddressUTXOsBatch(batchRequest, [ADDR_1], 'testnet3');

    expect(result.get(ADDR_1)).toEqual([VALID_UTXO]);
  });

  it('returns an empty map for empty address input', async () => {
    const batchRequest = vi.fn();
    const result = await getAddressUTXOsBatch(batchRequest, [], 'testnet3');

    expect(result.size).toBe(0);
    expect(batchRequest).not.toHaveBeenCalled();
  });
});
