/**
 * Draft Signing Intent Repository
 *
 * Resolves the draft linked to a server-issued signing intent within a wallet.
 * Applies no status filter on purpose: terminal (e.g., broadcasted) drafts must
 * remain resolvable for authenticated replay, and approval gating is the
 * caller's responsibility.
 */

import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';
import prisma from '../models/prisma';
import type { DraftTransaction } from '../generated/prisma/client';

/**
 * Find the draft linked to a signing intent within a wallet.
 *
 * Deterministic: orders by createdAt then id so duplicate or parallel draft
 * creation for the same intent always resolves to the same row.
 */
export async function findDraftByWalletAndSigningIntent(
  walletId: string,
  signingIntentId: string
): Promise<DraftTransaction | null> {
  return prisma.draftTransaction.findFirst({
    where: { walletId, signingIntentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Whether an actionable draft in the wallet still references the signing
 * intent at `now`: not terminal, not rejected/vetoed/approval-expired, and not
 * past its own expiry. A draft without an expiry (legacy) does not count.
 */
export async function hasLiveDraftForSigningIntent(
  walletId: string,
  signingIntentId: string,
  now: Date
): Promise<boolean> {
  const draft = await prisma.draftTransaction.findFirst({
    where: {
      walletId,
      signingIntentId,
      status: { in: [...ACTIONABLE_DRAFT_STATUS_VALUES] },
      approvalStatus: { notIn: ['rejected', 'vetoed', 'expired'] },
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return draft !== null;
}

export const draftSigningIntentRepository = {
  findDraftByWalletAndSigningIntent,
  hasLiveDraftForSigningIntent,
};

export default draftSigningIntentRepository;
