/**
 * Draft Transactions API
 *
 * API calls for managing draft transactions (saved, unsigned/partially signed PSBTs)
 */

import apiClient from './client';
import { DraftTransactionSchema, DraftTransactionsResponseSchema } from '@sanctuary/shared/schemas/transactionResponses';

export type DraftIntegerValue = number | string;
export type DraftTextValue = string | null;

export interface DraftOutput {
  address: string;
  amount: number;
  sendMax?: boolean;
}

export interface DraftInput {
  txid: string;
  vout: number;
  address: string;
  amount: number;
}

export interface DraftOutputRequest {
  address: string;
  amount: DraftIntegerValue;
  sendMax?: boolean;
}

export interface DraftInputRequest {
  txid: string;
  vout: number;
  address: string;
  amount: DraftIntegerValue;
}

export interface DraftTransaction {
  id: string;
  walletId: string;
  userId: string;

  // Transaction parameters (single output - backwards compatible)
  recipient: string;
  amount: number;
  feeRate: number;
  selectedUtxoIds: string[];
  enableRBF: boolean;
  subtractFees: boolean;
  sendMax: boolean;
  isRBF: boolean; // True if this is an RBF replacement transaction

  // Multiple outputs support
  outputs?: DraftOutput[];

  // Multiple inputs support (for flow visualization)
  inputs?: DraftInput[];

  // Decoy change outputs (for privacy)
  decoyOutputs?: Array<{ address: string; amount: number }>;

  // Payjoin support
  payjoinUrl?: string;

  // Labels
  label?: DraftTextValue;
  memo?: DraftTextValue;

  // PSBT data
  psbtBase64: string;
  signedPsbtBase64?: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  effectiveAmount: number;
  inputPaths: string[];

  // Signing status
  status: 'unsigned' | 'partial' | 'signed';
  signedDeviceIds: string[];
  agentId?: string;
  agentOperationalWalletId?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface CreateDraftRequest {
  recipient: string;
  amount: DraftIntegerValue;
  feeRate: number | string;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  subtractFees?: boolean;
  sendMax?: boolean;
  isRBF?: boolean; // Skip UTXO locking for RBF replacement transactions
  outputs?: DraftOutputRequest[]; // Multiple outputs support
  inputs?: DraftInputRequest[]; // Multiple inputs for flow visualization
  decoyOutputs?: Array<{ address: string; amount: DraftIntegerValue }>; // Decoy change outputs
  payjoinUrl?: string; // Payjoin endpoint URL
  label?: DraftTextValue;
  memo?: DraftTextValue;
  psbtBase64: string;
  fee?: DraftIntegerValue;
  totalInput?: DraftIntegerValue;
  totalOutput?: DraftIntegerValue;
  changeAmount?: DraftIntegerValue;
  changeAddress?: string;
  effectiveAmount?: DraftIntegerValue;
  inputPaths?: string[];
  signedPsbtBase64?: string;
  signedDeviceId?: string;
}

export interface UpdateDraftRequest {
  signedPsbtBase64?: string;
  signedDeviceId?: string;
  status?: 'unsigned' | 'partial' | 'signed';
  label?: DraftTextValue;
  memo?: DraftTextValue;
}

/**
 * Get all draft transactions for a wallet
 */
export async function getDrafts(walletId: string): Promise<DraftTransaction[]> {
  // `DraftAmountSummary` calls `draft.fee.toLocaleString()`; a null there is
  // the same crash that took the dashboard down, on the signing queue.
  return apiClient.get<DraftTransaction[]>(`/wallets/${walletId}/drafts`, undefined, undefined, {
    schema: DraftTransactionsResponseSchema,
  });
}

/**
 * Get a specific draft transaction
 */
export async function getDraft(walletId: string, draftId: string): Promise<DraftTransaction> {
  return apiClient.get<DraftTransaction>(
    `/wallets/${walletId}/drafts/${draftId}`,
    undefined,
    undefined,
    { schema: DraftTransactionSchema },
  );
}

/**
 * Create a new draft transaction
 */
export async function createDraft(walletId: string, data: CreateDraftRequest): Promise<DraftTransaction> {
  return apiClient.post<DraftTransaction>(`/wallets/${walletId}/drafts`, data);
}

/**
 * Update a draft transaction (e.g., add signature)
 */
export async function updateDraft(
  walletId: string,
  draftId: string,
  data: UpdateDraftRequest
): Promise<DraftTransaction> {
  return apiClient.patch<DraftTransaction>(`/wallets/${walletId}/drafts/${draftId}`, data);
}

/**
 * Delete a draft transaction
 */
export async function deleteDraft(walletId: string, draftId: string): Promise<void> {
  await apiClient.delete(`/wallets/${walletId}/drafts/${draftId}`);
}
