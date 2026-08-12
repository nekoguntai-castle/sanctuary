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
  recalculateWalletBalances,
} from '../blockchain';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage, isPrismaError } from '../../../utils/errors';
import { eventService } from '../../eventService';
import { transactionBroadcastsTotal } from '../../../observability/metrics';
import { persistTransaction } from './persistTransaction';
import type { TransactionInputMetadata, TransactionOutputMetadata, BroadcastResult } from './types';
import type { ValidatedBroadcastArtifact } from '../signingIntent/artifactValidation';
import {
  claimSigningIntentBroadcast,
  markSigningIntentBroadcastAccepted,
  markSigningIntentBroadcastComplete,
  markSigningIntentBroadcastUnknown,
  releaseRejectedSigningIntentBroadcast,
} from '../signingIntent/broadcastLifecycle';
import { assertWalletHardwareCapabilityById } from '../../hardwareWalletCapabilities';

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
): Promise<Awaited<ReturnType<typeof persistTransaction>> | null> => {
  for (let attempt = 1; attempt <= MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    try {
      return await persistTransaction(walletId, txid, rawTx, metadata);
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
    utxos: Array<{ txid: string; vout: number }>;
    draftId?: string; // If broadcasting from a draft, release UTXO locks
    // Enhanced metadata for full I/O storage
    inputs?: TransactionInputMetadata[];
    outputs?: TransactionOutputMetadata[];
  }
): Promise<BroadcastResult> {
  const { walletId, rawTx, txid } = artifact;
  // Cover every network path before a broadcast claim or network side effect,
  // including replay and reconciliation entry points.
  await assertWalletHardwareCapabilityById(walletId, 'broadcast');
  // Log which broadcast path we're taking
  log.info('broadcastAndSave called', {
    intentId: artifact.intent.intentId,
    recipient: metadata.recipient,
    draftId: metadata.draftId,
  });

  const claim = await claimSigningIntentBroadcast(artifact, metadata);
  if (claim.status === 'complete') {
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

  // Broadcast to network
  let broadcastResult;
  try {
    broadcastResult = await broadcastTransaction(artifact);
  } catch (error) {
    const transition = error instanceof DefiniteBroadcastRejectionError
      ? releaseRejectedSigningIntentBroadcast
      : markSigningIntentBroadcastUnknown;
    try {
      await transition(artifact.intent.intentId, claim.leaseToken, getErrorMessage(error));
    } catch (transitionError) {
      log.error('Failed to persist broadcast failure outcome; lease expiry will reconcile it', {
        intentId: artifact.intent.intentId,
        txid,
        error: getErrorMessage(transitionError),
      });
    }
    throw error;
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

  const persisted = await persistAcceptedTransaction(walletId, txid, rawTx, metadata);
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
    import('../../notifications/dispatch').then(({ dispatchTransactionNotifications }) => {
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
    import('../../notifications/dispatch').then(({ dispatchTransactionNotifications }) => {
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
