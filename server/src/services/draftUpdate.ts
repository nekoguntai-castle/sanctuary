import type { DraftTransaction } from '../generated/prisma/client';
import * as bitcoin from 'bitcoinjs-lib';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';
import { draftRepository, type DraftStatus } from '../repositories';
import { ConflictError, InvalidInputError, NotFoundError } from '../errors';
import { createLogger } from '../utils/logger';
import { normalizeAndAssertSignedDeviceBelongsToWallet } from './draftSigning';
import { validatePartialSignedPsbt } from './bitcoin/signingIntent';
import type { UpdateDraftInput } from './draftTypes';

const log = createLogger('DRAFT:SVC_UPDATE');
const MAX_SIGNATURE_UPDATE_RETRIES = 3;

interface DraftUpdateData {
  signedPsbtBase64?: string;
  signedDeviceIds?: string[];
  status?: DraftStatus;
  label?: string | null;
  memo?: string | null;
  expectedUpdatedAt?: Date;
}

const assertValidDraftStatus = (status: DraftStatus | undefined): void => {
  if (status !== undefined && !ACTIONABLE_DRAFT_STATUS_VALUES.includes(status)) {
    throw new InvalidInputError('Invalid status. Must be unsigned, partial, or signed');
  }
};

const collectPartialSignaturePubkeys = (psbt: bitcoin.Psbt): string[] => {
  const signatures: string[] = [];
  for (const input of psbt.data.inputs) {
    if (input.partialSig) {
      for (const ps of input.partialSig) {
        signatures.push(Buffer.from(ps.pubkey).toString('hex').substring(0, 16));
      }
    }
  }
  return signatures;
};

const combineSignedPsbtBase64 = (
  draftId: string,
  latestDraft: DraftTransaction,
  signedPsbtBase64: string,
  attempt: number
): string => {
  const existingPsbt = latestDraft.signedPsbtBase64 || latestDraft.psbtBase64;

  try {
    const existingPsbtObj = bitcoin.Psbt.fromBase64(existingPsbt);
    const newPsbtObj = bitcoin.Psbt.fromBase64(signedPsbtBase64);
    const existingSigs = collectPartialSignaturePubkeys(existingPsbtObj);
    const newSigs = collectPartialSignaturePubkeys(newPsbtObj);

    log.info('PSBT combine - before', {
      draftId,
      existingSource: latestDraft.signedPsbtBase64 ? 'signedPsbt' : 'unsignedPsbt',
      existingSigCount: existingSigs.length,
      existingSigPubkeys: existingSigs,
      newSigCount: newSigs.length,
      newSigPubkeys: newSigs,
      attempt,
    });

    existingPsbtObj.combine(newPsbtObj);

    const combinedSigs = collectPartialSignaturePubkeys(existingPsbtObj);
    log.info('PSBT combine - after', {
      draftId,
      totalSignatures: combinedSigs.length,
      combinedSigPubkeys: combinedSigs,
      attempt,
    });

    return existingPsbtObj.toBase64();
  } catch {
    throw new InvalidInputError('Signed PSBT cannot be combined with the authorized draft', 'signedPsbtBase64', {
      reason: 'intent_mismatch',
    });
  }
};

const addSignedDeviceIfNeeded = (
  latestDraft: DraftTransaction,
  signedDeviceId: string | null,
  updateData: DraftUpdateData
): void => {
  if (!signedDeviceId) return;

  const currentSigned = latestDraft.signedDeviceIds || [];
  if (!currentSigned.includes(signedDeviceId)) {
    updateData.signedDeviceIds = [...currentSigned, signedDeviceId];
  }
};

const buildDraftUpdateData = async (
  draftId: string,
  latestDraft: DraftTransaction,
  data: UpdateDraftInput,
  signedDeviceId: string | null,
  requiresOptimisticRetry: boolean,
  attempt: number
): Promise<DraftUpdateData> => {
  const updateData: DraftUpdateData = {};

  if (data.signedPsbtBase64 !== undefined) {
    if (!latestDraft.signingIntentId || !latestDraft.signingIntentDigest) {
      throw new InvalidInputError('Draft has no authenticated signing intent', 'signedPsbtBase64', {
        reason: 'missing_intent',
      });
    }
    await validatePartialSignedPsbt({
      walletId: latestDraft.walletId,
      intentId: latestDraft.signingIntentId,
      intentDigest: latestDraft.signingIntentDigest,
      signedPsbtBase64: data.signedPsbtBase64,
      draftId,
    });
    const combined = combineSignedPsbtBase64(
      draftId,
      latestDraft,
      data.signedPsbtBase64,
      attempt
    );
    await validatePartialSignedPsbt({
      walletId: latestDraft.walletId,
      intentId: latestDraft.signingIntentId,
      intentDigest: latestDraft.signingIntentDigest,
      signedPsbtBase64: combined,
      draftId,
    });
    updateData.signedPsbtBase64 = combined;
  }

  addSignedDeviceIfNeeded(latestDraft, signedDeviceId, updateData);

  if (data.status !== undefined) {
    updateData.status = data.status;
  }

  if (data.label !== undefined) {
    updateData.label = data.label;
  }

  if (data.memo !== undefined) {
    updateData.memo = data.memo;
  }

  if (requiresOptimisticRetry) {
    updateData.expectedUpdatedAt = latestDraft.updatedAt;
  }

  return updateData;
};

const isDraftUpdateConflict = (error: unknown): boolean => {
  return error instanceof Error && error.message === 'DRAFT_UPDATE_CONFLICT';
};

const toDraftUpdateConflictError = (): ConflictError => {
  return new ConflictError(
    'Draft was modified concurrently or is no longer actionable. Please reload and retry.'
  );
};

const refreshDraftForRetry = async (
  walletId: string,
  draftId: string,
  attempt: number
): Promise<DraftTransaction> => {
  const refreshedDraft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!refreshedDraft) {
    throw new NotFoundError('Draft not found');
  }

  log.debug('Retrying draft update after concurrent modification', {
    draftId,
    attempt,
  });
  return refreshedDraft;
};

/**
 * Update a draft transaction.
 */
export async function updateDraft(
  walletId: string,
  draftId: string,
  data: UpdateDraftInput
): Promise<DraftTransaction> {
  const existingDraft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!existingDraft) {
    throw new NotFoundError('Draft not found');
  }

  assertValidDraftStatus(data.status);

  const signedDeviceId = data.signedDeviceId !== undefined
    ? await normalizeAndAssertSignedDeviceBelongsToWallet(walletId, data.signedDeviceId)
    : null;
  const requiresOptimisticRetry = data.signedPsbtBase64 !== undefined || signedDeviceId !== null;
  const maxAttempts = requiresOptimisticRetry ? MAX_SIGNATURE_UPDATE_RETRIES : 1;
  let latestDraft = existingDraft;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const draft = await draftRepository.update(
        draftId,
        await buildDraftUpdateData(
          draftId,
          latestDraft,
          data,
          signedDeviceId,
          requiresOptimisticRetry,
          attempt + 1
        )
      );
      log.info('Updated draft', { draftId, walletId, status: draft.status });
      return draft;
    } catch (error) {
      if (!isDraftUpdateConflict(error)) {
        throw error;
      }

      if (!requiresOptimisticRetry) {
        throw toDraftUpdateConflictError();
      }

      if (attempt >= maxAttempts - 1) {
        throw toDraftUpdateConflictError();
      }

      latestDraft = await refreshDraftForRetry(walletId, draftId, attempt + 2);
    }
  }

  /* v8 ignore next -- unreachable: the for-loop always returns or throws on every path */
  throw new ConflictError('Draft update failed after retry attempts.');
}
