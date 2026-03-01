/**
 * Transaction API Contract Types
 *
 * Types for transaction listing and status.
 */

/**
 * Transaction type enum value
 */
export type ApiTransactionType = 'sent' | 'received' | 'self' | 'consolidation';

/**
 * Transaction status enum value
 */
export type ApiTransactionStatus = 'confirmed' | 'pending' | 'replaced';

/**
 * GET /wallets/:id/transactions (array of these)
 */
export interface TransactionResponse {
  id: string;
  txid: string;
  type: ApiTransactionType;
  status: ApiTransactionStatus;
  amount: string; // bigint as string
  fee: string; // bigint as string
  confirmations: number;
  blockHeight: number | null;
  blockTime: string | null; // ISO date string
  createdAt: string; // ISO date string
  label: string | null;
  memo: string | null;
  isRbf: boolean;
  replacedByTxid: string | null;
}
