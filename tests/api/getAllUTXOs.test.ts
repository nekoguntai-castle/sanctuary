/**
 * getAllUTXOs Tests
 *
 * The server caps a UTXO page at 1000 rows, so send and stats loaders must
 * page instead of trusting a single unpaged request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import { getAllUTXOs } from '../../src/api/transactions';

const makeUtxos = (start: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `utxo-${start + i}`,
    txid: 'a'.repeat(64),
    vout: start + i,
    amount: 1000,
    address: 'bc1qtest',
    confirmations: 6,
    frozen: false,
  }));

// Mirrors the helper's 100-page safety cap.
const MAX_UTXO_PAGES = 100;

describe('getAllUTXOs', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('pages until a short page and returns every row', async () => {
    mockGet
      .mockResolvedValueOnce({ utxos: makeUtxos(0, 1000), count: 1500, totalBalance: 1_500_000 })
      .mockResolvedValueOnce({ utxos: makeUtxos(1000, 500), count: 1500, totalBalance: 1_500_000 });

    const result = await getAllUTXOs('wallet-1');

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls[0][0]).toBe('/wallets/wallet-1/utxos');
    expect(mockGet.mock.calls[0][1]).toEqual({ limit: 1000, offset: 0 });
    expect(mockGet.mock.calls[1][1]).toEqual({ limit: 1000, offset: 1000 });
    expect(result.utxos).toHaveLength(1500);
    expect(result.count).toBe(1500);
    expect(result.totalBalance).toBe(1_500_000);
  });

  it('keeps paging past a count that lags behind the rows', async () => {
    mockGet
      .mockResolvedValueOnce({ utxos: makeUtxos(0, 1000), count: 999, totalBalance: 1 })
      .mockResolvedValueOnce({ utxos: makeUtxos(1000, 1000), count: 999, totalBalance: 1 })
      .mockResolvedValueOnce({ utxos: makeUtxos(2000, 500), count: 999, totalBalance: 1 });

    const result = await getAllUTXOs('wallet-1');

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(result.utxos).toHaveLength(2500);
  });

  it('stops when a full page adds no new rows', async () => {
    mockGet.mockResolvedValue({ utxos: makeUtxos(0, 1000), count: 5000, totalBalance: 1 });

    const result = await getAllUTXOs('wallet-1');

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.utxos).toHaveLength(1000);
  });

  it('rejects when a later page request fails', async () => {
    mockGet
      .mockResolvedValueOnce({ utxos: makeUtxos(0, 1000), count: 1500, totalBalance: 1 })
      .mockRejectedValueOnce(new Error('page 2 failed'));

    await expect(getAllUTXOs('wallet-1')).rejects.toThrow('page 2 failed');
  });

  it('makes a single request when the first page is short', async () => {
    mockGet.mockResolvedValueOnce({ utxos: makeUtxos(0, 3), count: 3, totalBalance: 3000 });

    const result = await getAllUTXOs('wallet-1');

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.utxos).toHaveLength(3);
  });

  it('keeps the first occurrence of a duplicate id across pages', async () => {
    const first = makeUtxos(0, 1000);
    const second = [{ ...makeUtxos(0, 1)[0], amount: 999 }, ...makeUtxos(1000, 2)];
    mockGet
      .mockResolvedValueOnce({ utxos: first, count: 1002, totalBalance: 1 })
      .mockResolvedValueOnce({ utxos: second, count: 1002, totalBalance: 1 });

    const result = await getAllUTXOs('wallet-1');

    expect(result.utxos).toHaveLength(1002);
    expect(result.utxos.filter(u => u.id === 'utxo-0')).toHaveLength(1);
    expect(result.utxos.find(u => u.id === 'utxo-0')?.amount).toBe(1000);
  });

  it('dedupes rows without an id by txid and vout', async () => {
    const withoutId = (vout: number) => ({ txid: 'b'.repeat(64), vout, amount: 5, address: 'bc1q', confirmations: 1 });
    const first = [...makeUtxos(0, 999), withoutId(0)];
    mockGet
      .mockResolvedValueOnce({ utxos: first, count: 1001, totalBalance: 1 })
      .mockResolvedValueOnce({ utxos: [withoutId(0), withoutId(1)], count: 1001, totalBalance: 1 });

    const result = await getAllUTXOs('wallet-1');

    expect(result.utxos).toHaveLength(1001);
  });

  it('rejects instead of truncating when the page cap is reached', async () => {
    mockGet.mockImplementation(async (_url: string, params: { offset: number }) => ({
      utxos: makeUtxos(params.offset, 1000),
      count: 1000,
      totalBalance: 1,
    }));

    await expect(getAllUTXOs('wallet-1')).rejects.toThrow(
      `at least ${MAX_UTXO_PAGES * 1000} UTXOs`,
    );
    expect(mockGet).toHaveBeenCalledTimes(MAX_UTXO_PAGES);
  });
});
