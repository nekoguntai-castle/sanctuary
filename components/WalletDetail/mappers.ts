/**
 * WalletDetail Data Mappers
 *
 * Normalizes API response data into the shapes expected by the UI.
 * Extracted from WalletDetail.tsx to eliminate duplicate mapping blocks.
 */

import type { Transaction, UTXO } from '../../types';

/**
 * Normalize an API transaction into the UI Transaction shape.
 * Converts string amounts to numbers, ISO dates to timestamps, and fills defaults.
 */
export function formatApiTransaction(tx: Transaction, walletId: string): Transaction {
  return {
    id: tx.id,
    txid: tx.txid,
    type: tx.type as 'sent' | 'received' | 'consolidation' | undefined,
    // Amount is already signed by the API: positive for received, negative for sent/consolidation
    amount: Number(tx.amount),
    balanceAfter: tx.balanceAfter != null ? Number(tx.balanceAfter) : undefined,
    timestamp: tx.blockTime ? new Date(tx.blockTime).getTime() : Date.now(),
    confirmations: tx.confirmations,
    fee: tx.fee ? Number(tx.fee) : 0,
    walletId,
    label: tx.label || tx.memo || '',
    labels: tx.labels || [],
    address: tx.address && typeof tx.address === 'object' ? tx.address.address : tx.address as string | undefined,
    blockHeight: tx.blockHeight ? Number(tx.blockHeight) : undefined,
    counterpartyAddress: tx.counterpartyAddress || undefined,
    rbfStatus: tx.rbfStatus,
    replacedByTxid: tx.replacedByTxid || undefined,
  };
}

/**
 * Normalize an API UTXO into the UI UTXO shape.
 * Converts string amounts to numbers and ISO dates to timestamps.
 */
export function formatApiUtxo(utxo: UTXO): UTXO {
  return {
    id: utxo.id,
    txid: utxo.txid,
    vout: utxo.vout,
    amount: Number(utxo.amount),
    address: utxo.address,
    confirmations: utxo.confirmations,
    frozen: utxo.frozen ?? false,
    spendable: utxo.spendable,
    date: new Date(utxo.createdAt!).getTime(),
    lockedByDraftId: utxo.lockedByDraftId,
    lockedByDraftLabel: utxo.lockedByDraftLabel,
  };
}
