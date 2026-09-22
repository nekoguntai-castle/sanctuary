import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: { wallet: { findUnique: vi.fn() } },
}));

import prisma from '../../../src/models/prisma';
import { findGatewayPushAudience } from '../../../src/repositories/pushAudienceRepository';

describe('pushAudienceRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('combines and deduplicates direct and group candidates with persisted transaction data', async () => {
    (prisma.wallet.findUnique as Mock).mockResolvedValue({
      id: 'wallet-1',
      name: 'Vault',
      users: [
        { user: { id: 'direct', preferences: { source: 'direct' } } },
        { user: { id: 'both', preferences: { source: 'direct-wins' } } },
      ],
      group: { members: [
        { user: { id: 'group', preferences: { source: 'group' } } },
        { user: { id: 'both', preferences: { source: 'group-copy' } } },
      ] },
      transactions: [{ type: 'sent', amount: 42n }],
    });

    await expect(findGatewayPushAudience('wallet-1', 'tx-1')).resolves.toEqual({
      walletId: 'wallet-1',
      walletName: 'Vault',
      candidates: [
        { userId: 'direct', preferences: { source: 'direct' } },
        { userId: 'both', preferences: { source: 'direct-wins' } },
        { userId: 'group', preferences: { source: 'group' } },
      ],
      transaction: { type: 'sent', amount: 42n },
    });
    expect(prisma.wallet.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'wallet-1' },
      select: expect.objectContaining({ name: true, users: expect.any(Object), group: expect.any(Object) }),
    }));
  });

  it('returns null for a missing wallet and null transaction for an unknown txid', async () => {
    (prisma.wallet.findUnique as Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'wallet-1', name: 'Vault', users: [], group: null, transactions: [],
    });
    await expect(findGatewayPushAudience('missing', 'tx-1')).resolves.toBeNull();
    await expect(findGatewayPushAudience('wallet-1', 'missing')).resolves.toEqual(expect.objectContaining({ transaction: null }));
  });
});
