/**
 * Draft Signing Intent Repository
 *
 * Resolves the draft linked to a server-issued signing intent within a wallet.
 * Applies no status filter on purpose: terminal (e.g., broadcasted) drafts must
 * remain resolvable for authenticated replay, and approval gating is the
 * caller's responsibility.
 */

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

export const draftSigningIntentRepository = { findDraftByWalletAndSigningIntent };

export default draftSigningIntentRepository;
