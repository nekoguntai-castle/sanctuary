/**
 * Transaction Broadcasting Module
 *
 * Handles broadcasting signed transactions and persisting them to the database.
 * Accepts only an opaque artifact that has already passed signed-intent,
 * prevout, signature, and exact-transaction validation.
 */

import {
  broadcastTransaction,
  DefiniteBroadcastRejectionError,
  isNodeAnsweredBroadcastFailure,
  recalculateWalletBalances,
} from '../blockchain';
import { ApiError, ConflictError } from '../../../errors/ApiError';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage, isPrismaError } from '../../../utils/errors';
import { eventService } from '../../eventService';
import { transactionBroadcastsTotal } from '../../../observability/metrics';
import { persistTransaction, type PersistTransactionOptions } from './persistTransaction';
import { assertReplacementLink, selectCandidateOutpoints } from './replacementLink';
import type { TransactionInputMetadata, TransactionOutputMetadata, BroadcastResult } from './types';
import type { ValidatedBroadcastArtifact } from '../signingIntent/artifactValidation';
import {
  claimSigningIntentBroadcast,
  markSigningIntentBroadcastAccepted,
  markSigningIntentBroadcastComplete,
  markSigningIntentBroadcastStalled,
  markSigningIntentBroadcastUnknown,
  releaseRejectedSigningIntentBroadcast,
  type BroadcastClaimOptions,
} from '../signingIntent/broadcastLifecycle';
import { assertWalletHardwareCapabilityById } from '../../hardwareWalletCapabilities';
import type { BroadcastPriorState } from '../../../repositories/transactionSigningIntentRepository';
import { archiveDraftsForSigningIntent } from '../../../repositories/draftSigningIntentRepository';

// Re-exported so callers (the broadcast route) can distinguish a definite
// rejection from an unknown-outcome failure without importing the blockchain
// barrel directly.
export { DefiniteBroadcastRejectionError };

/**
 * Thrown by broadcastAndSave for every failure raised BEFORE the transaction
 * reaches the network (hardware capability, intent claim conflict, an
 * unverifiable replacesTxid). Extends the original ApiError so errorHandler
 * still maps it to the original status/code/body; gives callers (the
 * broadcast route's releaseReservationsOnFailure) a marker distinct from
 * DefiniteBroadcastRejectionError to recognize that nothing was transmitted,
 * so any policy usage reserved before the call must be released the same as
 * a definite node rejection would be.
 */
export class PreNetworkBroadcastRejectionError extends ApiError {
  constructor(original: ApiError) {
    super(original.message, original.statusCode, original.code, original.details, original.isOperational);
  }
}

/** Wrap an ApiError raised before the network broadcast call as a pre-network
 * rejection; anything else (an unexpected non-ApiError failure) is rethrown
 * unchanged since there is no HTTP mapping to preserve. */
const asPreNetworkRejection = (error: unknown): unknown => (
  error instanceof ApiError ? new PreNetworkBroadcastRejectionError(error) : error
);

/**
 * What a failed broadcastAndSave did to the signing intent, attached to the
 * error it throws (identity, class and message unchanged) so the broadcast
 * route can decide whether policy usage reserved before the call may be
 * released. `releasedToReady` is true only when this attempt actually put the
 * intent back to `ready` — the one outcome that proves nothing went out and a
 * later retry must claim (and reserve) afresh.
 */
export type BroadcastFailureTag =
  | { claimed: false; releasedToReady: false }
  | { claimed: true; priorState: BroadcastPriorState; releasedToReady: boolean };

const BROADCAST_FAILURE_TAG = 'broadcastFailure';

/** Attach the tag to an object error; a thrown primitive cannot carry it and is returned as is. */
const tagBroadcastFailure = (error: unknown, tag: BroadcastFailureTag): unknown => {
  if (typeof error === 'object' && error !== null) {
    Reflect.defineProperty(error, BROADCAST_FAILURE_TAG, {
      value: tag, enumerable: false, configurable: true, writable: true,
    });
  }
  return error;
};

const PRIOR_STATES: ReadonlySet<unknown> = new Set<BroadcastPriorState>(['ready', 'resumed', 'stalled']);

/** The tag broadcastAndSave attached to a failure, or null for an untagged error. */
export const readBroadcastFailureTag = (error: unknown): BroadcastFailureTag | null => {
  if (typeof error !== 'object' || error === null) return null;
  const tag: unknown = Reflect.get(error, BROADCAST_FAILURE_TAG);
  if (typeof tag !== 'object' || tag === null) return null;
  const { claimed, priorState, releasedToReady } = tag as Record<string, unknown>;
  if (claimed === false) return { claimed: false, releasedToReady: false };
  if (claimed !== true || !PRIOR_STATES.has(priorState) || typeof releasedToReady !== 'boolean') return null;
  return { claimed: true, priorState: priorState as BroadcastPriorState, releasedToReady };
};

/**
 * A failure before or during the claim. Only the ApiError wrapper proves no
 * claim was taken: a Prisma or connection error may follow a committed claim
 * that already re-persisted the reservations, so it stays untagged (and the
 * route retains them).
 */
const asUnclaimedRejection = (error: unknown): unknown => {
  const rejection = asPreNetworkRejection(error);
  return rejection instanceof PreNetworkBroadcastRejectionError
    ? tagBroadcastFailure(rejection, { claimed: false, releasedToReady: false })
    : rejection;
};

const log = createLogger('BITCOIN:SVC_TX_BROADCAST');
const MAX_PERSISTENCE_ATTEMPTS = 3;

const isRetryablePersistenceConflict = (error: unknown): boolean => {
  if (!isPrismaError(error)) return false;
  if (error.code === 'P2034') return true;
  const driverAdapterError = error.meta?.driverAdapterError as
    | { cause?: { kind?: unknown } }
    | undefined;
  return error.code === 'P2010'
    && driverAdapterError?.cause?.kind === 'TransactionWriteConflict';
};

const persistAcceptedTransaction = async (
  walletId: string,
  txid: string,
  rawTx: string,
  metadata: Parameters<typeof persistTransaction>[3],
  options: PersistTransactionOptions,
): Promise<Awaited<ReturnType<typeof persistTransaction>> | null> => {
  for (let attempt = 1; attempt <= MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    try {
      return await persistTransaction(walletId, txid, rawTx, metadata, options);
    } catch (error) {
      if (isRetryablePersistenceConflict(error) && attempt < MAX_PERSISTENCE_ATTEMPTS) {
        log.warn('Retrying accepted transaction persistence after write conflict', {
          txid,
          walletId,
          attempt,
        });
        continue;
      }
      log.error('Accepted transaction requires persistence reconciliation', {
        txid,
        walletId,
        attempt,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /* v8 ignore next -- the bounded loop always returns */
  return null;
};

const recalculateAcceptedWalletBalance = async (walletId: string, txid: string): Promise<void> => {
  try {
    await recalculateWalletBalances(walletId);
  } catch (error) {
    log.warn('Accepted transaction balance reconciliation deferred', {
      txid,
      walletId,
      error: getErrorMessage(error),
    });
  }
};

const recordAcceptedIntent = async (
  artifact: ValidatedBroadcastArtifact,
  leaseToken: string,
): Promise<boolean> => {
  try {
    return await markSigningIntentBroadcastAccepted(artifact.intent.intentId, leaseToken);
  } catch (error) {
    log.error('Accepted transaction claim requires reconciliation', {
      intentId: artifact.intent.intentId,
      txid: artifact.txid,
      error: getErrorMessage(error),
    });
    return false;
  }
};

const completeAcceptedIntent = async (intentId: string, txid: string): Promise<boolean> => {
  try {
    return await markSigningIntentBroadcastComplete(intentId, txid);
  } catch (error) {
    log.error('Accepted transaction completion requires reconciliation', {
      intentId, txid, error: getErrorMessage(error),
    });
    return false;
  }
};

const emitAcceptedTransactionEvent = (
  eventName: 'sent' | 'received',
  txid: string,
  walletId: string,
  emit: () => void,
): void => {
  try {
    emit();
  } catch (error) {
    log.warn('Accepted transaction event emission failed', {
      eventName,
      txid,
      walletId,
      error: getErrorMessage(error),
    });
  }
};

type BroadcastClaimed = Extract<Awaited<ReturnType<typeof claimSigningIntentBroadcast>>, { status: 'claimed' }>;

const STALLED_BROADCAST_MESSAGE = "This transaction's broadcast outcome could not be confirmed after repeated attempts. "
  + 'Check a block explorer for the txid before creating a replacement.';

type FailureTransition = { releasedToReady: boolean };

/**
 * Persist the outcome of a failed claim. Only a first (`ready`) claim may be
 * rolled back; a resumed claim may already have crossed the node boundary, so
 * it stays unknown, and a claim resumed from `stalled` returns to `stalled`.
 * `releasedToReady` is true only when the rollback to `ready` succeeded.
 */
const recordClaimFailure = async (
  intentId: string,
  claim: BroadcastClaimed,
  error: unknown,
): Promise<FailureTransition> => {
  const message = getErrorMessage(error);
  if (claim.priorState === 'stalled') {
    await markSigningIntentBroadcastStalled(intentId, claim.leaseToken, message);
    return { releasedToReady: false };
  }
  if (claim.priorState === 'ready' && error instanceof DefiniteBroadcastRejectionError) {
    return { releasedToReady: await releaseRejectedSigningIntentBroadcast(intentId, claim.leaseToken, message) };
  }
  await markSigningIntentBroadcastUnknown(intentId, claim.leaseToken, message, {
    countAttempt: isNodeAnsweredBroadcastFailure(error),
  });
  return { releasedToReady: false };
};

/** A failed re-submission of a stalled intent gets an actionable terminal conflict. */
const broadcastFailureToThrow = (claim: BroadcastClaimed, error: unknown): unknown => (
  claim.priorState === 'stalled'
    ? new ConflictError(STALLED_BROADCAST_MESSAGE, undefined, { reason: 'broadcast_stalled' })
    : error
);

/** Failed replacement-link check before any network call: release only a first claim. */
const recordReplacementLinkFailure = async (
  intentId: string,
  claim: BroadcastClaimed,
  error: unknown,
): Promise<FailureTransition> => {
  const message = getErrorMessage(error);
  if (claim.priorState === 'ready') {
    return { releasedToReady: await releaseRejectedSigningIntentBroadcast(intentId, claim.leaseToken, message) };
  }
  await (claim.priorState === 'stalled'
    ? markSigningIntentBroadcastStalled(intentId, claim.leaseToken, message)
    // Nothing reached a node, so this must not spend the stall-cap budget.
    : markSigningIntentBroadcastUnknown(intentId, claim.leaseToken, message, { countAttempt: false }));
  return { releasedToReady: false };
};

/**
 * A replay of a complete broadcast never reaches persistTransaction, so a draft
 * of the intent that its persistence did not archive (saved while the first
 * attempt was in flight) is archived here. Best effort: the spend is already
 * persisted, and an unarchived draft still expires.
 */
const archiveReplayedIntentDrafts = async (walletId: string, intentId: string): Promise<void> => {
  try {
    await archiveDraftsForSigningIntent(walletId, intentId);
  } catch (error) {
    log.warn('Could not archive drafts of a replayed broadcast', { walletId, intentId, error: getErrorMessage(error) });
  }
};

/**
 * Broadcast a signed transaction and save to database.
 *
 * Supports two modes:
 * The caller must supply an opaque validated artifact. Raw-only hardware
 * results remain blocked until an adapter can provide independently verifiable
 * signing proof.
 */
export async function broadcastAndSave(
  artifact: ValidatedBroadcastArtifact,
  metadata: {
    recipient: string;
    amount: number;
    fee: number;
    label?: string;
    memo?: string;
    replacesTxid?: string;
    utxos: Array<{ txid: string; vout: number }>;
    draftId?: string; // If broadcasting from a draft, release UTXO locks
    // Enhanced metadata for full I/O storage
    inputs?: TransactionInputMetadata[];
    outputs?: TransactionOutputMetadata[];
    // Policy usage held for this broadcast; persisted on every claim so a
    // retry of an unknown outcome can reuse it instead of reserving again.
    policyReservations?: Array<{ windowId: string; amount: string }>;
  },
  options: BroadcastClaimOptions = {},
): Promise<BroadcastResult> {
  const { walletId, rawTx, txid } = artifact;
  let claim: Awaited<ReturnType<typeof claimSigningIntentBroadcast>>;
  try {
    // Cover every network path before a broadcast claim or network side
    // effect, including replay and reconciliation entry points.
    await assertWalletHardwareCapabilityById(walletId, 'broadcast');
    // Log which broadcast path we're taking
    log.info('broadcastAndSave called', {
      intentId: artifact.intent.intentId,
      recipient: metadata.recipient,
      draftId: metadata.draftId,
    });

    claim = await claimSigningIntentBroadcast(artifact, metadata, new Date(), {
      resumeOnly: options.resumeOnly === true,
    });
  } catch (error) {
    throw asUnclaimedRejection(error);
  }
  if (claim.status === 'complete') {
    await archiveReplayedIntentDrafts(walletId, artifact.intent.intentId);
    return { txid, broadcasted: true, persistenceStatus: 'complete' };
  }
  if (claim.status === 'accepted') {
    return {
      txid,
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
      persistenceReason: 'post_acceptance_persistence_race',
    };
  }

  // A claimed RBF replacement must verify (same wallet, unconfirmed, shares
  // an input) BEFORE the transaction reaches the network. This only runs on
  // a genuine first attempt: an idempotent replay of an already
  // complete/accepted broadcast returns above without re-validating, so a
  // `replacesTxid` that confirmed in the meantime cannot turn a harmless
  // replay into a 400. If it does reject here, release the just-claimed
  // lease the same way a definite broadcast rejection would, so the signing
  // intent is not left stuck in 'claimed'.
  if (metadata.replacesTxid) {
    try {
      await assertReplacementLink(
        walletId,
        metadata.replacesTxid,
        selectCandidateOutpoints(metadata.inputs, metadata.utxos)
      );
    } catch (error) {
      let transition: FailureTransition = { releasedToReady: false };
      try {
        transition = await recordReplacementLinkFailure(artifact.intent.intentId, claim, error);
      } catch (releaseError) {
        log.error('Failed to release claimed lease after replacesTxid rejection; lease expiry will reconcile it', {
          intentId: artifact.intent.intentId,
          txid,
          error: getErrorMessage(releaseError),
        });
      }
      throw tagBroadcastFailure(asPreNetworkRejection(error), {
        claimed: true, priorState: claim.priorState, releasedToReady: transition.releasedToReady,
      });
    }
  }

  // Broadcast to network
  let broadcastResult;
  try {
    broadcastResult = await broadcastTransaction(artifact, claim.priorState === 'ready');
  } catch (error) {
    let transition: FailureTransition = { releasedToReady: false };
    try {
      transition = await recordClaimFailure(artifact.intent.intentId, claim, error);
    } catch (transitionError) {
      log.error('Failed to persist broadcast failure outcome; lease expiry will reconcile it', {
        intentId: artifact.intent.intentId,
        txid,
        error: getErrorMessage(transitionError),
      });
    }
    throw tagBroadcastFailure(broadcastFailureToThrow(claim, error), {
      claimed: true, priorState: claim.priorState, releasedToReady: transition.releasedToReady,
    });
  }

  if (!broadcastResult.broadcasted) {
    transactionBroadcastsTotal.inc({ status: 'failure' });
    await markSigningIntentBroadcastUnknown(
      artifact.intent.intentId,
      claim.leaseToken,
      'Node returned an unaccepted broadcast result',
    );
    throw new Error('Failed to broadcast transaction');
  }

  transactionBroadcastsTotal.inc({ status: 'success' });
  const intentConsumed = await recordAcceptedIntent(artifact, claim.leaseToken);

  const persisted = await persistAcceptedTransaction(walletId, txid, rawTx, metadata, { signingIntentId: artifact.intent.intentId });
  if (!persisted || !intentConsumed) {
    return {
      txid,
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
      persistenceReason: 'post_acceptance_persistence_race',
    };
  }

  const completed = await completeAcceptedIntent(artifact.intent.intentId, txid);
  if (!completed) {
    return {
      txid,
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
      persistenceReason: 'post_acceptance_persistence_race',
    };
  }

  if (metadata.draftId && persisted.unlockedCount > 0) {
    log.debug(`Released ${persisted.unlockedCount} UTXO locks for draft ${metadata.draftId}`);
  }

  if (metadata.draftId && persisted.draftArchived) {
    log.debug(`Archived draft ${metadata.draftId} after accepted broadcast`);
  }

  // Recalculate running balances for all affected wallets
  await recalculateAcceptedWalletBalance(walletId, txid);

  if (persisted.mainTransactionCreated) {
    // Send notifications for the broadcast transaction (Telegram + Push)
    // This is async and fire-and-forget to not block the response.
    /* v8 ignore start -- fire-and-forget post-broadcast hook; integration-tested end-to-end, not unit-testable from here */
    import('../../notifications/dispatch.js').then(({ dispatchTransactionNotifications }) => {
      dispatchTransactionNotifications(walletId, [{
        txid,
        type: persisted.txType,
        amount: BigInt(metadata.amount),
        feeSats: BigInt(metadata.fee),
      }]).catch(err => {
        log.warn('Failed to send notifications', { error: getErrorMessage(err) });
      });
    });
    /* v8 ignore stop */

    // Emit transaction sent event for real-time updates
    emitAcceptedTransactionEvent('sent', txid, walletId, () => {
      eventService.emitTransactionSent({
        walletId,
        txid,
        amount: BigInt(metadata.amount),
        fee: BigInt(metadata.fee),
        recipients: [{ address: metadata.recipient, amount: BigInt(metadata.amount) }],
        rawTx,
      });
    });
  }

  for (const receivingTx of persisted.receivingTransactions) {
    await recalculateAcceptedWalletBalance(receivingTx.walletId, txid);

    if (receivingTx.status === 'existing') {
      continue;
    }

    // Emit transaction received event for real-time updates
    emitAcceptedTransactionEvent('received', txid, receivingTx.walletId, () => {
      eventService.emitTransactionReceived({
        walletId: receivingTx.walletId,
        txid,
        amount: BigInt(receivingTx.amount),
        address: receivingTx.address,
        confirmations: 0,
      });
    });

    // Send notifications for the receiving wallet.
    /* v8 ignore start -- fire-and-forget post-broadcast hook; integration-tested end-to-end, not unit-testable from here */
    import('../../notifications/dispatch.js').then(({ dispatchTransactionNotifications }) => {
      dispatchTransactionNotifications(receivingTx.walletId, [{
        txid,
        type: 'received',
        amount: BigInt(receivingTx.amount),
      }]).catch(err => {
        log.warn('Failed to send notifications for receiving wallet', { error: getErrorMessage(err) });
      });
    });
    /* v8 ignore stop */
  }

  return {
    txid,
    broadcasted: true,
    persistenceStatus: 'complete',
  };
}
