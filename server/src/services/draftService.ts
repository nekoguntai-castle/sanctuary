/**
 * Draft Service
 *
 * Business logic for draft transaction management.
 * Handles creation, updates, deletions, and UTXO locking.
 */

import type { DraftTransaction, Prisma } from '../generated/prisma/client';
import * as bitcoin from 'bitcoinjs-lib';
import { draftRepository, DraftStatus, systemSettingRepository, walletRepository } from '../repositories';
import { lockUtxosForDraft, resolveUtxoIds } from './draftLockService';
import { notifyNewDraft } from './notifications/notificationService';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError } from '../errors';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { SystemSettingSchemas } from '../utils/safeJson';
import { DEFAULT_DRAFT_EXPIRATION_DAYS } from '../constants';
import { approvalService } from './vaultPolicy/approvalService';
import type { PolicyEvaluationResult } from './vaultPolicy/types';

const log = createLogger('DRAFT:SVC');
const MAX_SIGNATURE_UPDATE_RETRIES = 3;

/**
 * Input for creating a draft
 */
export interface CreateDraftInput {
  recipient: string;
  amount: number | string;
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  subtractFees?: boolean;
  sendMax?: boolean;
  outputs?: Prisma.InputJsonValue | null;
  inputs?: Prisma.InputJsonValue | null;
  decoyOutputs?: Prisma.InputJsonValue | null;
  payjoinUrl?: string;
  isRBF?: boolean;
  label?: string;
  memo?: string;
  psbtBase64: string;
  fee?: number | string;
  totalInput?: number | string;
  totalOutput?: number | string;
  changeAmount?: number | string;
  changeAddress?: string;
  effectiveAmount?: number | string;
  inputPaths?: string[];
  agentId?: string | null;
  agentOperationalWalletId?: string | null;
  signedPsbtBase64?: string;
  signedDeviceId?: string;
  notificationCreatedByUserId?: string | null;
  notificationCreatedByLabel?: string;
  /** Policy evaluation result from transaction creation — used to create approval requests */
  policyEvaluation?: PolicyEvaluationResult;
}

interface InitialSigningState {
  signedPsbtBase64: string | null;
  signedDeviceIds: string[];
  status: DraftStatus;
}

/**
 * Input for updating a draft
 */
export interface UpdateDraftInput {
  signedPsbtBase64?: string;
  signedDeviceId?: string;
  status?: DraftStatus;
  label?: string;
  memo?: string;
}

/**
 * Get draft expiration days from system settings
 */
async function getDraftExpirationDays(): Promise<number> {
  return systemSettingRepository.getParsed('draftExpirationDays', SystemSettingSchemas.number, DEFAULT_DRAFT_EXPIRATION_DAYS);
}

async function validateInitialSigningState(
  walletId: string,
  data: CreateDraftInput
): Promise<InitialSigningState> {
  const hasSignedPsbt = data.signedPsbtBase64 !== undefined;
  const hasSignedDeviceId = data.signedDeviceId !== undefined;

  if (!hasSignedPsbt && !hasSignedDeviceId) {
    return { signedPsbtBase64: null, signedDeviceIds: [], status: 'unsigned' };
  }

  if (!hasSignedPsbt || !hasSignedDeviceId) {
    throw new InvalidInputError('signedPsbtBase64 and signedDeviceId must be provided together');
  }

  const signedDeviceId = data.signedDeviceId?.trim();
  if (!data.signedPsbtBase64?.trim() || !signedDeviceId) {
    throw new InvalidInputError('signedPsbtBase64 and signedDeviceId must be non-empty');
  }

  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const walletDeviceIds = new Set((wallet.devices || []).map(device => device.deviceId));
  if (!walletDeviceIds.has(signedDeviceId)) {
    throw new InvalidInputError('signedDeviceId must belong to the wallet');
  }

  return {
    signedPsbtBase64: data.signedPsbtBase64,
    signedDeviceIds: [signedDeviceId],
    status: 'partial',
  };
}

// ========================================
// DRAFT CRUD OPERATIONS
// ========================================

/**
 * Get all drafts for a wallet
 *
 * Access control: handled by requireWalletAccess('view') middleware at route level
 */
export async function getDraftsForWallet(
  walletId: string
): Promise<DraftTransaction[]> {
  return draftRepository.findByWalletId(walletId);
}

/**
 * Get a specific draft
 *
 * Access control: handled by requireWalletAccess('view') middleware at route level
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
 * Create a new draft transaction
 */
export async function createDraft(
  walletId: string,
  userId: string,
  data: CreateDraftInput
): Promise<DraftTransaction> {
  // Access control: handled by requireWalletAccess('edit') middleware at route level

  // Validation
  if (!data.recipient || data.amount === undefined || !data.feeRate || !data.psbtBase64) {
    throw new InvalidInputError('recipient, amount, feeRate, and psbtBase64 are required');
  }

  const initialSigningState = await validateInitialSigningState(walletId, data);

  // Get expiration from system settings
  const expirationDays = await getDraftExpirationDays();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  const draft = await draftRepository.create({
    walletId,
    userId,
    recipient: data.recipient,
    amount: BigInt(data.amount),
    feeRate: data.feeRate,
    selectedUtxoIds: data.selectedUtxoIds || [],
    enableRBF: data.enableRBF ?? true,
    subtractFees: data.subtractFees ?? false,
    sendMax: data.sendMax ?? false,
    outputs: data.outputs || null,
    inputs: data.inputs || null,
    decoyOutputs: data.decoyOutputs || null,
    payjoinUrl: data.payjoinUrl || null,
    isRBF: data.isRBF ?? false,
    label: data.label || null,
    memo: data.memo || null,
    psbtBase64: data.psbtBase64,
    signedPsbtBase64: initialSigningState.signedPsbtBase64,
    signedDeviceIds: initialSigningState.signedDeviceIds,
    status: initialSigningState.status,
    fee: BigInt(data.fee || 0),
    totalInput: BigInt(data.totalInput || 0),
    totalOutput: BigInt(data.totalOutput || 0),
    changeAmount: BigInt(data.changeAmount || 0),
    changeAddress: data.changeAddress || null,
    effectiveAmount: BigInt(data.effectiveAmount || data.amount),
    inputPaths: data.inputPaths || [],
    agentId: data.agentId ?? null,
    agentOperationalWalletId: data.agentOperationalWalletId ?? null,
    expiresAt,
  });

  // Lock UTXOs for this draft (unless it's an RBF transaction)
  if (data.selectedUtxoIds && data.selectedUtxoIds.length > 0 && !data.isRBF) {
    const { found: utxoIds, notFound } = await resolveUtxoIds(walletId, data.selectedUtxoIds);

    if (notFound.length > 0) {
      log.warn('Some UTXOs not found for locking', { notFound, draftId: draft.id });
    }

    if (utxoIds.length > 0) {
      const lockResult = await lockUtxosForDraft(draft.id, utxoIds, { isRBF: false });

      if (!lockResult.success) {
        // UTXOs are already locked by another draft - delete the draft and throw error
        await draftRepository.remove(draft.id);

        throw new ConflictError('One or more UTXOs are already locked by another draft transaction');
      }

      log.debug('Locked UTXOs for draft', {
        draftId: draft.id,
        lockedCount: lockResult.lockedCount
      });
    }
  }

  log.info('Created draft', { draftId: draft.id, walletId, userId, isRBF: data.isRBF ?? false });

  // If policy evaluation indicates approval is required, create approval requests.
  // This must be awaited to ensure approval records exist before returning the draft.
  if (data.policyEvaluation?.triggered?.some(t => t.action === 'approval_required')) {
    try {
      await approvalService.createApprovalRequestsForDraft(
        draft.id,
        walletId,
        userId,
        data.policyEvaluation.triggered
      );
    } catch (err) {
      log.error('Failed to create approval requests', { error: getErrorMessage(err), draftId: draft.id });
      // Don't throw — the draft was created successfully. The approval state
      // will show as 'not_required' and the user can retry.
    }
  }

  // Send notifications to other wallet users (async, don't block response)
  notifyNewDraft(walletId, {
    id: draft.id,
    amount: draft.amount,
    recipient: draft.recipient,
    label: draft.label,
    feeRate: draft.feeRate,
    agentId: data.agentId ?? null,
    agentName: data.agentId ? data.notificationCreatedByLabel ?? null : null,
    agentOperationalWalletId: data.agentOperationalWalletId ?? null,
    agentSigned: Boolean(data.agentId && data.signedDeviceId),
    dedupeKey: data.agentId
      ? `agent:${data.agentId}:${walletId}:${data.agentOperationalWalletId ?? ''}:${draft.recipient}:${draft.amount.toString()}`
      : undefined,
  }, data.notificationCreatedByUserId === undefined ? userId : data.notificationCreatedByUserId, data.notificationCreatedByLabel).catch(err => {
    log.warn('Failed to send draft notification', { error: getErrorMessage(err) });
  });

  return draft;
}

/**
 * Update a draft transaction
 */
export async function updateDraft(
  walletId: string,
  draftId: string,
  data: UpdateDraftInput
): Promise<DraftTransaction> {
  // Access control: handled by requireWalletAccess('edit') middleware at route level

  // Get existing draft
  const existingDraft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!existingDraft) {
    throw new NotFoundError('Draft not found');
  }

  // Validate status once before retry loop
  if (data.status !== undefined && !['unsigned', 'partial', 'signed'].includes(data.status)) {
    throw new InvalidInputError('Invalid status. Must be unsigned, partial, or signed');
  }

  const requiresOptimisticRetry = data.signedPsbtBase64 !== undefined || !!data.signedDeviceId;
  let latestDraft = existingDraft;
  const maxAttempts = requiresOptimisticRetry ? MAX_SIGNATURE_UPDATE_RETRIES : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Build update data from the latest known draft state
    const updateData: {
      signedPsbtBase64?: string;
      signedDeviceIds?: string[];
      status?: DraftStatus;
      label?: string | null;
      memo?: string | null;
      expectedUpdatedAt?: Date;
    } = {};

    if (data.signedPsbtBase64 !== undefined) {
      // For multisig: combine new signatures with existing ones
      // This is critical for m-of-n multisig where multiple signers need to add signatures
      const existingPsbt = latestDraft.signedPsbtBase64 || latestDraft.psbtBase64;

      try {
        const existingPsbtObj = bitcoin.Psbt.fromBase64(existingPsbt);
        const newPsbtObj = bitcoin.Psbt.fromBase64(data.signedPsbtBase64);

        // Log signature state BEFORE combining
        const existingSigs: string[] = [];
        const newSigs: string[] = [];
        for (const input of existingPsbtObj.data.inputs) {
          if (input.partialSig) {
            for (const ps of input.partialSig) {
              existingSigs.push(Buffer.from(ps.pubkey).toString('hex').substring(0, 16));
            }
          }
        }
        for (const input of newPsbtObj.data.inputs) {
          if (input.partialSig) {
            for (const ps of input.partialSig) {
              newSigs.push(Buffer.from(ps.pubkey).toString('hex').substring(0, 16));
            }
          }
        }

        log.info('PSBT combine - before', {
          draftId,
          existingSource: latestDraft.signedPsbtBase64 ? 'signedPsbt' : 'unsignedPsbt',
          existingSigCount: existingSigs.length,
          existingSigPubkeys: existingSigs,
          newSigCount: newSigs.length,
          newSigPubkeys: newSigs,
          attempt: attempt + 1,
        });

        // Combine PSBTs - this merges partial signatures from both
        existingPsbtObj.combine(newPsbtObj);

        // Count total signatures after combining
        let totalSigs = 0;
        const combinedSigs: string[] = [];
        for (const input of existingPsbtObj.data.inputs) {
          if (input.partialSig) {
            totalSigs += input.partialSig.length;
            for (const ps of input.partialSig) {
              combinedSigs.push(Buffer.from(ps.pubkey).toString('hex').substring(0, 16));
            }
          }
        }

        log.info('PSBT combine - after', {
          draftId,
          totalSignatures: totalSigs,
          combinedSigPubkeys: combinedSigs,
          attempt: attempt + 1,
        });

        updateData.signedPsbtBase64 = existingPsbtObj.toBase64();
      } catch (combineError) {
        // If combining fails (e.g., incompatible PSBTs), log and use the new one
        log.warn('Failed to combine PSBTs, using new PSBT directly', {
          draftId,
          error: getErrorMessage(combineError),
        });
        updateData.signedPsbtBase64 = data.signedPsbtBase64;
      }
    }

    if (data.signedDeviceId) {
      // Add device to signed list if not already there
      const currentSigned = latestDraft.signedDeviceIds || [];
      if (!currentSigned.includes(data.signedDeviceId)) {
        updateData.signedDeviceIds = [...currentSigned, data.signedDeviceId];
      }
    }

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

    try {
      const draft = await draftRepository.update(draftId, updateData);
      log.info('Updated draft', { draftId, walletId, status: draft.status });
      return draft;
    } catch (error) {
      if (!requiresOptimisticRetry || !(error instanceof Error) || error.message !== 'DRAFT_UPDATE_CONFLICT') {
        throw error;
      }

      if (attempt >= maxAttempts - 1) {
        throw new ConflictError('Draft was modified concurrently. Please retry your update.');
      }

      const refreshedDraft = await draftRepository.findByIdInWallet(draftId, walletId);
      if (!refreshedDraft) {
        throw new NotFoundError('Draft not found');
      }

      latestDraft = refreshedDraft;
      log.debug('Retrying draft update after concurrent modification', {
        draftId,
        attempt: attempt + 2,
      });
    }
  }

  // Defensive fallback for type narrowing; normal flow returns or throws inside the loop.
  /* v8 ignore next -- unreachable: the for-loop always returns or throws on every path */
  throw new ConflictError('Draft update failed after retry attempts.');
}

/**
 * Delete a draft transaction
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
  // Get existing draft
  const existingDraft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!existingDraft) {
    throw new NotFoundError('Draft not found');
  }

  // Only creator or wallet owner can delete
  if (existingDraft.userId !== userId && walletRole !== 'owner') {
    throw new ForbiddenError('Only the creator or wallet owner can delete drafts');
  }

  await draftRepository.remove(draftId);

  log.info('Deleted draft', { draftId, walletId, userId });
}

/**
 * Delete expired drafts (called by maintenance service)
 */
export async function deleteExpiredDrafts(): Promise<number> {
  const count = await draftRepository.deleteExpired();
  if (count > 0) {
    log.info('Deleted expired drafts', { count });
  }
  return count;
}

// Export as namespace
export const draftService = {
  getDraftsForWallet,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  deleteExpiredDrafts,
};

export default draftService;
