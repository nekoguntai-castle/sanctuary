import { describe, expect, it, vi } from 'vitest';

const findFirst = vi.hoisted(() => vi.fn());

vi.mock('../../../src/models/prisma', () => ({
  default: {
    draftTransaction: { findFirst },
  },
}));

import { findDraftByWalletAndSigningIntent } from '../../../src/repositories/draftSigningIntentRepository';

describe('draftSigningIntentRepository', () => {
  it('resolves the earliest deterministic draft within the wallet', async () => {
    const draft = { id: 'draft-1' };
    findFirst.mockResolvedValueOnce(draft);

    await expect(findDraftByWalletAndSigningIntent('wallet-1', 'intent-1')).resolves.toBe(draft);
    expect(findFirst).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', signingIntentId: 'intent-1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });
});
