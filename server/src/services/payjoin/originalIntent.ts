/**
 * Restore a signed payjoin original after an abandoned or rejected proposal.
 *
 * A minted proposal supersedes the original, so the original cannot be the
 * BIP78 fallback until the proposal is parked behind it again. The repository
 * does that under the never-broadcast-both rule: it refuses while the
 * proposal's broadcast is claimed or its outcome unknown.
 */
import { ConflictError, InvalidInputError } from '../../errors/ApiError';
import { transactionSigningIntentRepository } from '../../repositories/transactionSigningIntentRepository';
import { findDraftBySigningIntent } from '../bitcoin/signingIntent/service';

export interface RestorePayjoinOriginalInput {
  walletId: string;
  intentId: string;
  intentDigest: string;
}

const missingIntent = (): InvalidInputError =>
  new InvalidInputError('Signing intent was not found', 'intentId', { reason: 'missing_intent' });

/** Defence in depth (C-D3/C-D9): neither intent of a payjoin pair may be bound to a draft. */
const assertNoBoundDraft = async (walletId: string, intentIds: string[]): Promise<void> => {
  const drafts = await Promise.all(intentIds.map(intentId => findDraftBySigningIntent(walletId, intentId)));
  if (drafts.some(Boolean)) {
    throw new ConflictError('Payjoin intents bound to a draft cannot be released', undefined, {
      reason: 'draft_bound_intent',
    });
  }
};

/**
 * Make the signed original of a payjoin pair broadcastable again.
 *
 * Returns `{ restored: true }` when the proposal was parked behind the
 * original, and `{ restored: false }` when there was nothing to restore: round
 * one fell back or has not persisted a proposal yet, or the original was
 * already restored. Throws InvalidInputError (`missing_intent`) for an
 * unknown, other-wallet or wrong-digest intent, or one whose successor is not
 * a payjoin proposal; ConflictError `draft_bound_intent` when either intent is
 * bound to a draft; and ConflictError `payjoin_broadcast_in_progress` while the
 * proposal's broadcast is claimed, unknown, accepted or consumed.
 */
export const restorePayjoinOriginalIntent = async (
  input: RestorePayjoinOriginalInput,
): Promise<{ restored: boolean }> => {
  const { walletId, intentId, intentDigest } = input;
  const original = await transactionSigningIntentRepository.findById(intentId);
  if (!original || original.walletId !== walletId || original.snapshotDigest !== intentDigest) {
    throw missingIntent();
  }
  await assertNoBoundDraft(
    walletId,
    original.supersededById ? [intentId, original.supersededById] : [intentId],
  );
  // The repository re-reads both rows in its transaction, so a change since the
  // read above surfaces as in_flight or not_superseded, never as a wrong restore.
  const result = await transactionSigningIntentRepository.restorePayjoinOriginal(intentId, walletId, intentDigest);
  if (result === 'in_flight') {
    throw new ConflictError('Payjoin proposal broadcast is in progress', undefined, {
      reason: 'payjoin_broadcast_in_progress',
    });
  }
  if (result === 'not_found' || result === 'not_payjoin') throw missingIntent();
  return { restored: result === 'restored' };
};
