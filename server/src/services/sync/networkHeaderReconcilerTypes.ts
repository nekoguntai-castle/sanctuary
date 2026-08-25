import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import type {
  NetworkHeaderReconciliationFailureClass,
  NetworkHeaderReconciliationState,
  ObserveNetworkHeaderInput,
  ReconciledHeaderRecord,
  ReconciliationFence,
} from '../../repositories/networkHeaderReconciliationTypes';

export interface RawHeaderObservation {
  height: number;
  hex: string;
  observedAt?: Date;
}

export type HeaderRangeFetcher = (startHeight: number, count: number) => Promise<string[]>;

export interface HeaderReconciliationRepositoryPort {
  observe(input: ObserveNetworkHeaderInput): Promise<NetworkHeaderReconciliationState>;
  recordCursor(input: ReconciliationFence & {
    expectedCursor: { height: number; hash: string } | null;
    headers: ReconciledHeaderRecord[];
  }): Promise<NetworkHeaderReconciliationState>;
  recordNetworkHeaderConfirmationPage(input: ReconciliationFence & {
    expectedCursor: string | null;
    cursor: string | null;
    enumerationComplete: boolean;
    /** DB-ordered page IDs; failures are a subset and the final ID equals cursor. */
    attemptedWalletIds: string[];
    failedWalletIds: string[];
  }): Promise<NetworkHeaderReconciliationState>;
  findNetworkHeaderConfirmationRetries(
    fence: ReconciliationFence,
    limit?: number,
  ): Promise<string[]>;
  recordNetworkHeaderConfirmationRetryResult(input: ReconciliationFence & {
    attemptedWalletIds: string[];
    failedWalletIds: string[];
  }): Promise<NetworkHeaderReconciliationState>;
  resetCursor(input: ReconciliationFence & {
    mode: NetworkHeaderReconciliationState['mode'];
    anchorHeight: number;
    anchorHash: string;
  }): Promise<NetworkHeaderReconciliationState>;
  recordFailure(input: ReconciliationFence & {
    failureClass: NetworkHeaderReconciliationFailureClass;
    retryDelayMs: number;
  }): Promise<boolean>;
  findHistory(
    network: NetworkType,
    maxHeight: number,
    limit?: number,
  ): Promise<ReconciledHeaderRecord[]>;
  finalize(fence: ReconciliationFence): Promise<{
    checkpoint: unknown;
    continuation: NetworkHeaderReconciliationState | null;
  }>;
}

export interface NetworkHeaderReconcilerDependencies {
  repository: HeaderReconciliationRepositoryPort;
  refreshConfirmations(
    network: NetworkType,
    height: number,
    afterWalletId: string | null,
    isActive?: () => boolean,
  ): Promise<{
    walletIds: string[];
    failures: Array<{ walletId: string; error: unknown }>;
    nextCursor: string | null;
    enumerationComplete: boolean;
  }>;
  refreshConfirmationRetryWallets(
    network: NetworkType,
    height: number,
    walletIds: string[],
    isActive?: () => boolean,
  ): Promise<{
    failures: Array<{ walletId: string; error: unknown }>;
  }>;
  setAuthoritativeHeight(height: number, network: NetworkType): void;
  now?: () => Date;
  pageSize?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
}

export type HeaderReconciliationAttemptResult =
  | { status: 'complete'; height: number; hash: string }
  | { status: 'progressed'; state: NetworkHeaderReconciliationState }
  | { status: 'deferred'; failureClass: NetworkHeaderReconciliationFailureClass };
