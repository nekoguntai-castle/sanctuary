/**
 * Unified notification dispatch entry point.
 *
 * Encapsulates the "try queue, fall back to inline" pattern so callers don't
 * choose between sync and queued paths themselves. Every caller goes through
 * here; the dual-path bug (some callers retry, others don't, depending on which
 * function they imported) becomes structurally impossible.
 *
 * Behaviour:
 *   1. Attempt to enqueue the notification job. The worker handles delivery
 *      with the configured retry/backoff policy.
 *   2. If queueing fails (Redis unavailable), deliver inline so notifications
 *      still go out — best-effort instead of silently dropped.
 *
 * This module lives in the services layer (not infrastructure) because it
 * imports from both: it ties together the queue-side dispatcher and the
 * sync-side notificationService.
 */

import {
  queueDraftNotification,
  queueTransactionNotification,
  type TransactionEnqueueResult,
} from '../../infrastructure';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  notifyNewDraft,
  notifyNewTransactions,
  type DraftData,
  type TransactionData,
} from './notificationService';
import {
  summarizeSafeNotificationOutcome,
  type SafeNotificationOutcome,
} from './outcomes';
import { recordNotificationTelemetry } from './telemetry';

const log = createLogger('NOTIFY:DISPATCH');

export async function dispatchTransactionNotifications(
  walletId: string,
  transactions: TransactionData[],
): Promise<void> {
  if (transactions.length === 0) return;

  // Probe with the first transaction; if Redis is up, queue the rest. If the
  // probe fails, fall back to inline for everything in one call so we don't
  // mix delivery semantics within a single notification batch.
  const [first, ...rest] = transactions;
  const queued = await queueTransactionNotification({
    walletId,
    txid: first.txid,
    type: first.type as 'received' | 'sent' | 'consolidation',
    amount: first.amount.toString(),
    feeSats: first.feeSats?.toString() ?? null,
  });

  if (!isEnqueueResolved(queued)) {
    log.debug('Falling back to inline transaction notification delivery', {
      walletId,
      count: transactions.length,
    });
    try {
      await deliverInlineTransactionNotifications(walletId, transactions);
    } catch (err) {
      log.warn('Inline transaction notification failed', { error: getErrorMessage(err), walletId });
    }
    return;
  }

  if (rest.length === 0) return;

  const restResults = await Promise.all(
    rest.map(async (tx) => ({
      tx,
      enqueue: await queueTransactionNotification({
        walletId,
        txid: tx.txid,
        type: tx.type as 'received' | 'sent' | 'consolidation',
        amount: tx.amount.toString(),
        feeSats: tx.feeSats?.toString() ?? null,
      }),
    })),
  );

  const failedTransactions = restResults
    .filter(({ enqueue }) => !isEnqueueResolved(enqueue))
    .map(({ tx }) => tx);
  if (failedTransactions.length === 0) return;

  log.debug('Falling back to inline delivery for transaction queue failures', {
    walletId,
    count: failedTransactions.length,
  });
  try {
    await deliverInlineTransactionNotifications(walletId, failedTransactions);
  } catch (err) {
    log.warn('Inline transaction notification failed', {
      error: getErrorMessage(err),
      walletId,
    });
  }
}

type EnqueueResult = TransactionEnqueueResult | boolean;

function isEnqueueResolved(result: EnqueueResult): boolean {
  return typeof result === 'boolean' ? result : result.outcome === 'resolved';
}

async function deliverInlineTransactionNotifications(
  walletId: string,
  transactions: TransactionData[],
): Promise<SafeNotificationOutcome> {
  recordNotificationTelemetry({
    family: 'transaction',
    stage: 'inline_fallback_attempted',
    path: 'inline',
    channel: 'none',
    outcome: 'none',
    failureClass: 'none',
  });

  try {
    const results = await notifyNewTransactions(walletId, transactions);
    const summary = summarizeSafeNotificationOutcome(results);
    recordInlineTerminalOutcome(summary);
    return summary;
  } catch (error) {
    recordInlineTerminalOutcome({
      outcome: 'ambiguous',
      failureClass: 'internal',
      channels: [],
    });
    throw error;
  }
}

function recordInlineTerminalOutcome(summary: SafeNotificationOutcome): void {
  recordNotificationTelemetry({
    family: 'transaction',
    stage: 'inline_terminal_outcome',
    path: 'inline',
    channel: 'none',
    outcome: summary.outcome,
    failureClass: summary.failureClass,
  });
}

export async function dispatchDraftNotification(
  walletId: string,
  draft: DraftData,
  createdByUserId: string | null,
  createdByLabel?: string,
): Promise<void> {
  const queued = await queueDraftNotification({
    walletId,
    draftId: draft.id,
    creatorUserId: createdByUserId,
    creatorLabel: createdByLabel,
    agentId: draft.agentId ?? null,
    agentName: draft.agentName ?? null,
    agentOperationalWalletId: draft.agentOperationalWalletId ?? null,
    agentSigned: draft.agentSigned ?? false,
    dedupeKey: draft.dedupeKey,
  });

  if (queued) return;

  log.debug('Falling back to inline draft notification delivery', { walletId, draftId: draft.id });
  try {
    await notifyNewDraft(walletId, draft, createdByUserId, createdByLabel);
  } catch (err) {
    log.warn('Inline draft notification failed', { error: getErrorMessage(err), walletId, draftId: draft.id });
  }
}
