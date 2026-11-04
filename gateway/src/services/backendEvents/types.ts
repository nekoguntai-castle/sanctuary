/**
 * Backend Events Types
 */

import type { GatewayNotifiedEventType } from '@sanctuary/shared/constants/gatewayEvents';

/**
 * Backend event types
 *
 * The pushed types come from the shared vocabulary (see
 * `GATEWAY_NOTIFIED_EVENT_TYPES`): `transaction`, `confirmation`, and the
 * gateway-only `ai_insight` and `consolidation_suggestion`. The server also
 * forwards other WebSocket events, such as `balance` and `sync`; these are
 * never pushed.
 */
export type BackendEventType = GatewayNotifiedEventType | 'balance' | 'sync';

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
    // Sent by the server with confirmation events (milestone detection)
    previousConfirmations?: number;
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
