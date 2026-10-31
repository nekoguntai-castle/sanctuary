import { describe, expect, it, vi } from 'vitest';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';

const findFirst = vi.hoisted(() => vi.fn());

vi.mock('../../../src/models/prisma', () => ({
  default: {
    draftTransaction: { findFirst },
  },
}));

import {
  archiveDraftsForSigningIntent,
  findDraftByWalletAndSigningIntent,
  hasLiveDraftForSigningIntent,
} from '../../../src/repositories/draftSigningIntentRepository';

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

  it('counts only an actionable, unexpired, not-refused draft in the wallet as live', async () => {
    const now = new Date('2030-01-01T00:00:00.000Z');
    findFirst.mockResolvedValueOnce({ id: 'draft-1' });

    await expect(hasLiveDraftForSigningIntent('wallet-1', 'intent-1', now)).resolves.toBe(true);
    expect(findFirst).toHaveBeenLastCalledWith({
      where: {
        walletId: 'wallet-1',
        signingIntentId: 'intent-1',
        status: { in: [...ACTIONABLE_DRAFT_STATUS_VALUES] },
        approvalStatus: { notIn: ['rejected', 'vetoed', 'expired'] },
        expiresAt: { gt: now },
      },
      select: { id: true },
    });

    findFirst.mockResolvedValueOnce(null);
    await expect(hasLiveDraftForSigningIntent('wallet-1', 'intent-1', now)).resolves.toBe(false);
  });

  it('archives every actionable draft bound to an accepted intent and releases their UTXO locks', async () => {
    const client = {
      draftUtxoLock: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      draftTransaction: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await expect(archiveDraftsForSigningIntent('wallet-1', 'intent-1', client as never)).resolves.toBe(1);
    expect(client.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
      where: { draft: { walletId: 'wallet-1', signingIntentId: 'intent-1' } },
    });
    expect(client.draftTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-1',
        signingIntentId: 'intent-1',
        status: { in: [...ACTIONABLE_DRAFT_STATUS_VALUES] },
      },
      data: { status: 'broadcasted', updatedAt: expect.any(Date) },
    });
  });
});
