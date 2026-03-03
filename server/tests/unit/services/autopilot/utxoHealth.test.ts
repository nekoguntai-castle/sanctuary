import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockFindUnspent } = vi.hoisted(() => ({
  mockFindUnspent: vi.fn(),
}));

vi.mock('../../../../src/repositories/utxoRepository', () => ({
  findUnspent: mockFindUnspent,
}));

import { getUtxoHealthProfile } from '../../../../src/services/autopilot/utxoHealth';

describe('autopilot utxoHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a zeroed profile when wallet has no UTXOs', async () => {
    (mockFindUnspent as Mock).mockResolvedValueOnce([]);

    await expect(getUtxoHealthProfile('wallet-1', 10_000)).resolves.toEqual({
      totalUtxos: 0,
      dustCount: 0,
      dustValue: 0n,
      totalValue: 0n,
      avgUtxoSize: 0n,
      smallestUtxo: 0n,
      largestUtxo: 0n,
    });
  });

  it('computes dust metrics and size stats from UTXO amounts', async () => {
    (mockFindUnspent as Mock).mockResolvedValueOnce([
      { amount: 1000n },
      { amount: 10_000n },
      { amount: 50_000n },
      { amount: 3000n },
    ]);

    const profile = await getUtxoHealthProfile('wallet-1', 10_000);

    expect(profile).toEqual({
      totalUtxos: 4,
      dustCount: 2, // 1000 + 3000 are strictly below threshold
      dustValue: 4000n,
      totalValue: 64_000n,
      avgUtxoSize: 16_000n,
      smallestUtxo: 1000n,
      largestUtxo: 50_000n,
    });
  });

  it('does not classify amount equal to threshold as dust', async () => {
    (mockFindUnspent as Mock).mockResolvedValueOnce([
      { amount: 10_000n },
    ]);

    const profile = await getUtxoHealthProfile('wallet-1', 10_000);
    expect(profile.dustCount).toBe(0);
    expect(profile.dustValue).toBe(0n);
  });
});
