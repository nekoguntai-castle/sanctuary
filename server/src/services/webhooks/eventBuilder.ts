import { transactionRepository, walletRepository } from '../../repositories';
import type { Transaction, Wallet } from '../../generated/prisma/client';
import { TRANSACTION_NOTIFICATION_TYPES, type TransactionNotification } from '../notifications/channels/types';
import type { ConfirmationUpdate } from '../bitcoin/sync/confirmations/types';
import {
  WEBHOOK_EVENT_TRANSACTION_CONFIRMED,
  WEBHOOK_EVENT_TRANSACTION_OBSERVED,
  WEBHOOK_EVENT_TRANSACTION_RECEIVED,
  WEBHOOK_EVENT_TRANSACTION_SENT,
  type WalletWebhookEvent,
} from './types';

type TransactionEventBase = Omit<WalletWebhookEvent, 'eventId' | 'eventType'>;

export async function buildTransactionWebhookEvents(
  walletId: string,
  transaction: TransactionNotification,
): Promise<WalletWebhookEvent[]> {
  return buildTransactionWebhookEventsForBatch(walletId, [transaction]);
}

export async function buildTransactionWebhookEventsForBatch(
  walletId: string,
  transactions: TransactionNotification[],
): Promise<WalletWebhookEvent[]> {
  if (transactions.length === 0) return [];

  const loaded = await loadWalletAndStoredTransactions(walletId, transactions.map(transaction => transaction.txid));
  if (!loaded) return [];
  const { wallet, storedByTxid } = loaded;
  const events: WalletWebhookEvent[] = [];

  for (const transaction of transactions) {
    const storedTransaction = storedByTxid.get(transaction.txid) ?? null;
    events.push(...buildEventsForTransaction(walletId, wallet, storedTransaction, transaction));
  }

  return events;
}

/**
 * Build the events for committed confirmation changes, paired with the change
 * that produced them. Notification fields come from the stored row.
 */
export async function buildConfirmationWebhookEventsForBatch(
  walletId: string,
  updates: ConfirmationUpdate[],
): Promise<Array<{ update: ConfirmationUpdate; event: WalletWebhookEvent }>> {
  if (updates.length === 0) return [];

  const loaded = await loadWalletAndStoredTransactions(walletId, updates.map(update => update.txid));
  if (!loaded) return [];
  const { wallet, storedByTxid } = loaded;
  return updates.flatMap((update) => {
    const stored = storedByTxid.get(update.txid);
    if (!stored || !isNotificationType(stored.type)) return [];
    const notification: TransactionNotification = {
      txid: stored.txid,
      type: stored.type,
      amount: stored.amount,
      feeSats: stored.fee,
    };
    return buildEventsForTransaction(walletId, wallet, stored, notification, 'sync.confirmation')
      .map(event => ({ update, event }));
  });
}

async function loadWalletAndStoredTransactions(
  walletId: string,
  txids: string[],
): Promise<{ wallet: Wallet; storedByTxid: Map<string, Transaction> } | null> {
  const [wallet, storedTransactions] = await Promise.all([
    walletRepository.findById(walletId),
    transactionRepository.findManyByTxids(txids, walletId),
  ]);
  if (!wallet) return null;
  return {
    wallet,
    storedByTxid: new Map(storedTransactions.map(transaction => [transaction.txid, transaction])),
  };
}

const NOTIFICATION_TYPES: ReadonlySet<string> = new Set(TRANSACTION_NOTIFICATION_TYPES);

function isNotificationType(type: string): type is TransactionNotification['type'] {
  return NOTIFICATION_TYPES.has(type);
}

function buildEventsForTransaction(
  walletId: string,
  wallet: Pick<Wallet, 'id' | 'name' | 'network'>,
  storedTransaction: Transaction | null,
  transaction: TransactionNotification,
  dispatchPath = 'notifications.transaction',
): WalletWebhookEvent[] {
  const confirmations = storedTransaction?.confirmations ?? 0;
  const baseEvent = buildTransactionEventBase(wallet, storedTransaction, transaction, dispatchPath);

  return [
    buildTypedTransactionEvent(walletId, transaction.txid, WEBHOOK_EVENT_TRANSACTION_OBSERVED, baseEvent),
    ...buildDirectionEvents(walletId, transaction, baseEvent),
    ...buildConfirmationEvents(walletId, transaction.txid, confirmations, baseEvent),
  ];
}

function buildTransactionEventBase(
  wallet: Pick<Wallet, 'id' | 'name' | 'network'>,
  storedTransaction: Transaction | null,
  transaction: TransactionNotification,
  dispatchPath: string,
): TransactionEventBase {
  const timing = getTransactionTiming(storedTransaction);
  const storedFields = getStoredTransactionFields(storedTransaction);
  return {
    schemaVersion: 'v1' as const,
    occurredAt: timing.occurredAt,
    wallet: {
      id: wallet.id,
      name: wallet.name,
      network: wallet.network,
    },
    transaction: {
      txid: transaction.txid,
      type: transaction.type,
      amountSats: transaction.amount.toString(),
      feeSats: getFeeSats(transaction, storedTransaction),
      confirmations: storedFields.confirmations,
      blockHeight: storedFields.blockHeight,
      blockTime: timing.blockTime,
      memo: storedFields.memo,
      label: storedFields.label,
      counterpartyAddress: storedFields.counterpartyAddress,
    },
    source: {
      service: 'sanctuary' as const,
      dispatchPath,
    },
  };
}

function getTransactionTiming(storedTransaction: Transaction | null): {
  occurredAt: string;
  blockTime: string | null;
} {
  if (!storedTransaction) {
    return { occurredAt: new Date().toISOString(), blockTime: null };
  }

  const blockTime = storedTransaction.blockTime
    ? storedTransaction.blockTime.toISOString()
    : null;
  return {
    occurredAt: blockTime ?? storedTransaction.createdAt.toISOString(),
    blockTime,
  };
}

function getStoredTransactionFields(storedTransaction: Transaction | null): {
  confirmations: number;
  blockHeight: number | null;
  memo: string | null;
  label: string | null;
  counterpartyAddress: string | null;
} {
  if (!storedTransaction) {
    return {
      confirmations: 0,
      blockHeight: null,
      memo: null,
      label: null,
      counterpartyAddress: null,
    };
  }

  return {
    confirmations: storedTransaction.confirmations,
    blockHeight: storedTransaction.blockHeight,
    memo: storedTransaction.memo,
    label: storedTransaction.label,
    counterpartyAddress: storedTransaction.counterpartyAddress,
  };
}

function getFeeSats(
  transaction: TransactionNotification,
  storedTransaction: Transaction | null,
): string | null {
  if (transaction.feeSats !== null && transaction.feeSats !== undefined) {
    return transaction.feeSats.toString();
  }
  return storedTransaction?.fee?.toString() ?? null;
}

function buildDirectionEvents(
  walletId: string,
  transaction: TransactionNotification,
  baseEvent: TransactionEventBase,
): WalletWebhookEvent[] {
  const directionEventType = getDirectionEventType(transaction.type);
  return directionEventType
    ? [buildTypedTransactionEvent(walletId, transaction.txid, directionEventType, baseEvent)]
    : [];
}

function buildConfirmationEvents(
  walletId: string,
  txid: string,
  confirmations: number,
  baseEvent: TransactionEventBase,
): WalletWebhookEvent[] {
  return confirmations > 0
    ? [buildTypedTransactionEvent(walletId, txid, WEBHOOK_EVENT_TRANSACTION_CONFIRMED, baseEvent)]
    : [];
}

function getDirectionEventType(type: TransactionNotification['type']): string | null {
  if (type === 'received') return WEBHOOK_EVENT_TRANSACTION_RECEIVED;
  if (type === 'sent') return WEBHOOK_EVENT_TRANSACTION_SENT;
  return null;
}

function buildTypedTransactionEvent(
  walletId: string,
  txid: string,
  eventType: string,
  baseEvent: TransactionEventBase,
): WalletWebhookEvent {
  return {
    ...baseEvent,
    eventId: buildTransactionEventId(walletId, txid, eventType),
    eventType,
  };
}

function buildTransactionEventId(
  walletId: string,
  txid: string,
  eventType: string,
): string {
  // Confirmation webhooks model "threshold reached" as one logical event; the
  // stable id lets receivers and the outbox dedupe repeat notification passes.
  return `wallet:${walletId}:tx:${txid}:${eventType}:v1`;
}
