/**
 * Draft Service
 *
 * Stable facade for draft transaction management. Creation and update workflows
 * live in focused modules because they each own separate validation and side
 * effect boundaries.
 */

import type { DraftTransaction } from '../generated/prisma/client';
import { draftRepository } from '../repositories';
import { ForbiddenError, NotFoundError } from '../errors';
import { createLogger } from '../utils/logger';
import { createDraft } from './draftCreate';
import { updateDraft } from './draftUpdate';

export type { CreateDraftInput, UpdateDraftInput } from './draftTypes';
export { createDraft, updateDraft };

const log = createLogger('DRAFT:SVC');

/**
 * Get all drafts for a wallet.
 *
 * Access control: handled by requireWalletAccess('view') middleware at route level.
 */
export async function getDraftsForWallet(
  walletId: string
): Promise<DraftTransaction[]> {
  return draftRepository.findByWalletId(walletId);
}

/**
 * Get a specific draft.
 *
 * Access control: handled by requireWalletAccess('view') middleware at route level.
 */
export async function getDraft(
  walletId: string,
  draftId: string
): Promise<DraftTransaction> {
  const draft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!draft) {
    throw new NotFoundError('Draft not found');
  }

  return draft;
}

/**
 * Delete a draft transaction.
 *
 * Access control: wallet-level view access handled by requireWalletAccess('view') middleware.
 * Additional authorization (creator or owner only) checked here as business logic.
 *
 * @param walletRole - caller's role from middleware (req.walletRole)
 */
export async function deleteDraft(
  walletId: string,
  draftId: string,
  userId: string,
  walletRole: string | null | undefined
): Promise<void> {
  const existingDraft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!existingDraft) {
    throw new NotFoundError('Draft not found');
  }

  if (existingDraft.userId !== userId && walletRole !== 'owner') {
    throw new ForbiddenError('Only the creator or wallet owner can delete drafts');
  }

  await draftRepository.remove(draftId);

  log.info('Deleted draft', { draftId, walletId, userId });
}

/**
 * Delete expired drafts (called by maintenance service).
 */
export async function deleteExpiredDrafts(): Promise<number> {
  const count = await draftRepository.deleteExpired();
  if (count > 0) {
    log.info('Deleted expired drafts', { count });
  }
  return count;
}

export const draftService = {
  getDraftsForWallet,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  deleteExpiredDrafts,
};

export default draftService;
