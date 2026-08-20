/**
 * Non-regression test for the 2026-08-20 stranded full-resync generation.
 *
 * `AMN-MS3` carried requestedFullResyncGeneration = 1 and
 * processedFullResyncGeneration = 0 while its Redis queue held no job for it,
 * no dedup key, and nothing delayed. The generation was reserved, the job that
 * would consume it vanished, and NOTHING in the codebase reads
 * `requested > processed` except the support collector — so the operator's
 * "Full resync" click did nothing, silently and permanently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindMany, mockQueryRaw } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockQueryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: { wallet: { findMany: mockFindMany }, $queryRaw: mockQueryRaw },
}));

import { findStrandedFullResyncWallets } from '../../../src/repositories/resyncRepository';

describe('findStrandedFullResyncWallets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
  });

  it('selects only wallets whose requested generation is ahead of processed', async () => {
    await findStrandedFullResyncWallets();

    // Prisma cannot compare two columns in a plain filter, so the comparison
    // must reach the database as SQL rather than being done in JS after loading
    // every wallet.
    expect(mockQueryRaw).toHaveBeenCalled();
    const sql = JSON.stringify(mockQueryRaw.mock.calls[0][0]);
    expect(sql).toContain('requestedFullResyncGeneration');
    expect(sql).toContain('processedFullResyncGeneration');
  });

  it('returns the wallets it finds', async () => {
    mockQueryRaw.mockResolvedValue([
      { id: 'w1', name: 'AMN-MS3', requestedFullResyncGeneration: 1, processedFullResyncGeneration: 0 },
    ]);

    await expect(findStrandedFullResyncWallets()).resolves.toEqual([
      { id: 'w1', name: 'AMN-MS3', requestedFullResyncGeneration: 1, processedFullResyncGeneration: 0 },
    ]);
  });

  it('returns an empty list when no generation is stranded', async () => {
    await expect(findStrandedFullResyncWallets()).resolves.toEqual([]);
  });

  it('bounds the result so a corrupted table cannot flood the queue', async () => {
    await findStrandedFullResyncWallets();
    expect(JSON.stringify(mockQueryRaw.mock.calls[0][0])).toContain('LIMIT');
  });

  it('does not issue a second wallet query that would interleave with the stale sweep', async () => {
    await findStrandedFullResyncWallets();
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
