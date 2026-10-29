/**
 * Backend Events Types
 */

/**
 * Backend event types
 *
 * - `transaction` - New incoming/outgoing transaction detected
 * - `confirmation` - Transaction received first confirmation
 * - `balance` - Balance changed (not sent as push)
 * - `sync` - Wallet sync completed (not sent as push)
 * - `broadcast_success` - Transaction broadcast succeeded
 * - `broadcast_failed` - Transaction broadcast failed
 * - `psbt_signing_required` - Multisig needs co-signer
 * - `draft_created` - New draft transaction for approval
 * - `draft_approved` - Draft was approved by co-signer
 * - `ai_insight` - Treasury Intelligence insight (gateway-only server event)
 * - `consolidation_suggestion` - Autopilot consolidation opportunity
 *   (gateway-only server event)
 */
export type BackendEventType =
  | 'transaction'
  | 'confirmation'
  | 'balance'
  | 'sync'
  | 'broadcast_success'
  | 'broadcast_failed'
  | 'psbt_signing_required'
  | 'draft_created'
  | 'draft_approved'
  | 'ai_insight'
  | 'consolidation_suggestion';

export interface BackendEvent {
  type: BackendEventType;
  walletId: string;
  walletName?: string;
  userId?: string;
  userIds?: string[];
  data: {
    txid?: string;
    type?: 'received' | 'sent' | 'consolidation';
    amount?: number;
    confirmations?: number;
    // Broadcast events
    error?: string;
    // Draft/PSBT events
    draftId?: string;
    creatorName?: string;
    signerName?: string;
    requiredSignatures?: number;
    currentSignatures?: number;
    // AI insight events (minimal: no summary text)
    insightId?: string;
    insightType?: string;
    insightTypeLabel?: string;
    severity?: string;
    // Consolidation suggestion events
    feeRate?: number;
  };
}

export interface DeviceInfo {
  id: string;
  platform: 'ios' | 'android';
  pushToken: string;
  userId: string;
}
