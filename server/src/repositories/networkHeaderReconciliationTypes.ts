import type { BitcoinNetwork } from '../constants/bitcoinNetworks';

export type NetworkHeaderReconciliationMode =
  | 'forward'
  | 'ancestor_search'
  | 'genesis_rebuild';

export type NetworkHeaderReconciliationFailureClass =
  | 'endpoint_unavailable'
  | 'validation_failed'
  | 'confirmation_failed'
  | 'ownership_lost';

/** Raised when a generation/owner fence no longer authorizes a write. */
export class HeaderReconciliationOwnershipError extends Error {
  constructor() {
    super('Header reconciliation ownership changed');
    this.name = 'HeaderReconciliationOwnershipError';
  }
}

export interface ReconciledHeaderRecord {
  height: number;
  hash: string;
  previousHash: string;
  observedAt: Date;
}

export interface NetworkHeaderReconciliationState {
  network: BitcoinNetwork;
  generation: number;
  ownerToken: string;
  mode: NetworkHeaderReconciliationMode;
  targetHeight: number;
  targetHash: string;
  targetHeaderHex: string;
  targetObservedAt: Date;
  anchorHeight: number;
  anchorHash: string;
  cursorHeight: number | null;
  cursorHash: string | null;
  confirmationCursorWalletId: string | null;
  confirmationEnumerationComplete: boolean;
  pendingTargetHeight: number | null;
  pendingTargetHash: string | null;
  pendingTargetPreviousHash: string | null;
  pendingTargetHeaderHex: string | null;
  pendingTargetObservedAt: Date | null;
  pendingTargetGenesisHash: string | null;
  gapStartedAt: Date;
  lastAttemptAt: Date | null;
  lastFailureClass: NetworkHeaderReconciliationFailureClass | null;
  consecutiveFailureCount: number;
  retryEligibleAt: Date;
}

export interface NetworkHeaderFinalizationResult {
  checkpoint: {
    network: BitcoinNetwork;
    lastProcessedHeight: number;
    lastProcessedHash: string;
    observedAt: Date;
    coverageGapStartedAt: Date | null;
  };
  continuation: NetworkHeaderReconciliationState | null;
}

export interface ObserveNetworkHeaderInput {
  network: BitcoinNetwork;
  ownerToken: string;
  height: number;
  hash: string;
  previousHash: string;
  headerHex: string;
  observedAt: Date;
  genesisHash: string;
}

export interface ReconciliationFence {
  network: BitcoinNetwork;
  generation: number;
  ownerToken: string;
}
