/**
 * Draft API Contract Types
 *
 * Types for transaction draft (PSBT) management.
 */

/**
 * Draft status enum value
 */
export type ApiDraftStatus = 'pending' | 'signed' | 'broadcast' | 'expired' | 'cancelled';

/**
 * GET /drafts/:id response
 */
export interface DraftResponse {
  id: string;
  walletId: string;
  status: ApiDraftStatus;
  psbt: string;
  amount: string; // bigint as string
  fee: string; // bigint as string
  recipients: Array<{
    address: string;
    amount: string; // bigint as string
  }>;
  signers: Array<{
    fingerprint: string;
    signed: boolean;
    signedAt: string | null;
  }>;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  expiresAt: string | null; // ISO date string
  memo: string | null;
}

/**
 * POST /drafts request
 */
export interface CreateDraftRequest {
  walletId: string;
  psbt: string;
  memo?: string;
}
