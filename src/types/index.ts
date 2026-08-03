/**
 * Central Type Definitions
 *
 * Frontend-facing types for the Sanctuary codebase.
 * Domain enums and shared types are imported from shared/types/domain.ts
 * which is the canonical source for types used across frontend and server.
 *
 * This barrel re-exports from focused sub-modules and shared types.
 * All existing imports from 'types' continue to work unchanged.
 */

// ============================================================================
// Sub-module re-exports (focused type files)
// ============================================================================
export { HardwareDevice } from "./hardware";
export type { HardwareDeviceModel } from "./hardware";
export type {
  ThemeOption,
  BackgroundOption,
  SoundType,
  EventSoundConfig,
  NotificationSounds,
  WalletTelegramSettings,
  TelegramConfig,
  WalletAutopilotSettings,
  WalletWebhookDelivery,
  WalletWebhookEndpoint,
  WalletWebhookHeaderConfigInput,
  WalletWebhookHeaderConfigUpdate,
  WalletWebhookHeaderConfigView,
  WalletWebhookInput,
  WalletWebhookUpdateInput,
  WalletWebhookReplayResult,
  UtxoHealthStatus,
  FeeSnapshot,
  AutopilotStatus,
  TableColumnConfig,
  WalletColumnId,
  DeviceColumnId,
  SeasonalBackgrounds,
} from "./ui";
export type {
  PageViewSettings,
  ViewSettings,
  BitcoinDisplayUnit,
  PreferenceSelectedNetwork,
  UserPreferences,
  User,
  Group,
  DeviceAccount,
  Device,
  DeviceShareInfo,
} from "./user";

// ============================================================================
// Shared domain types (canonical source: shared/types/domain.ts)
// ============================================================================
import {
  WalletType,
  type WalletScriptType,
  type WalletNetwork,
  type WalletRole,
  type DeviceRole,
  type TransactionType,
  type TransactionOutputType,
  type RbfStatus,
  type SelectionStrategy,
  type DraftStatus,
  type TransferStatus,
  type TransferResourceType,
  type SyncStatus,
  type SyncPriority,
  type ConnectionMode,
  type LoadBalancingStrategy,
  type PrivacyGrade,
  type HealthStatus,
  type Quorum,
} from "@sanctuary/shared/types/domain";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  PaginationParams,
  CursorPaginationParams,
  PaginatedResponse,
  CursorPaginatedResponse,
  SortDirection,
  SortParams,
  DateRangeParams,
  FeeEstimates,
  PriceSource,
  AggregatedPrice,
} from "@sanctuary/shared/types/api";
import type { PendingTransactionType } from "@sanctuary/shared/constants/transactions";
import type { NodeMempoolEstimator } from "@sanctuary/shared/constants/nodeConfig";

export { WalletType };
export type {
  WalletScriptType,
  WalletNetwork,
  WalletRole,
  DeviceRole,
  TransactionType,
  TransactionOutputType,
  RbfStatus,
  SelectionStrategy,
  DraftStatus,
  TransferStatus,
  TransferResourceType,
  SyncStatus,
  SyncPriority,
  NodeMempoolEstimator,
  ConnectionMode,
  LoadBalancingStrategy,
  PrivacyGrade,
  HealthStatus,
  Quorum,
};

export type {
  ApiErrorResponse,
  ApiSuccessResponse,
  PaginationParams,
  CursorPaginationParams,
  PaginatedResponse,
  CursorPaginatedResponse,
  SortDirection,
  SortParams,
  DateRangeParams,
  FeeEstimates,
  PriceSource,
  AggregatedPrice,
};

// ============================================================================
// WALLET TYPE ENUMS & ALIASES
// ============================================================================

export const WALLET_TYPE_LABELS: Record<WalletType, string> = {
  [WalletType.SINGLE_SIG]: "Single Sig",
  [WalletType.MULTI_SIG]: "Multisig",
};

export function getWalletTypeLabel(
  type: WalletType | string | undefined,
): string {
  if (!type) return "Unknown";
  if (type === WalletType.MULTI_SIG)
    return WALLET_TYPE_LABELS[WalletType.MULTI_SIG];
  if (type === WalletType.SINGLE_SIG)
    return WALLET_TYPE_LABELS[WalletType.SINGLE_SIG];
  return type as string;
}

export function isMultisigType(type: WalletType | string | undefined): boolean {
  return type === WalletType.MULTI_SIG;
}

// ============================================================================
// NODE CONFIGURATION
// ============================================================================

export interface NodeConfig {
  type: "electrum";
  explorerUrl?: string;
  feeEstimatorUrl?: string;
  testnet3ExplorerUrl?: string | null;
  testnet3FeeEstimatorUrl?: string | null;
  testnet4ExplorerUrl?: string | null;
  testnet4FeeEstimatorUrl?: string | null;
  signetExplorerUrl?: string | null;
  signetFeeEstimatorUrl?: string | null;
  mempoolEstimator?: NodeMempoolEstimator;
  allowSelfSignedCert?: boolean;

  // MAINNET SETTINGS
  mainnetMode: ConnectionMode;
  mainnetSingletonHost?: string;
  mainnetSingletonPort?: number;
  mainnetSingletonSsl?: boolean;
  mainnetPoolMin?: number;
  mainnetPoolMax?: number;
  mainnetPoolLoadBalancing?: LoadBalancingStrategy;

  // TESTNET3 SETTINGS
  testnet3Enabled?: boolean;
  testnet3Mode?: ConnectionMode;
  testnet3SingletonHost?: string | null;
  testnet3SingletonPort?: number | null;
  testnet3SingletonSsl?: boolean | null;
  testnet3PoolMin?: number | null;
  testnet3PoolMax?: number | null;
  testnet3PoolLoadBalancing?: LoadBalancingStrategy;

  // TESTNET4 SETTINGS
  testnet4Enabled?: boolean;
  testnet4Mode?: ConnectionMode;
  testnet4SingletonHost?: string | null;
  testnet4SingletonPort?: number | null;
  testnet4SingletonSsl?: boolean | null;
  testnet4PoolMin?: number | null;
  testnet4PoolMax?: number | null;
  testnet4PoolLoadBalancing?: LoadBalancingStrategy;

  // LEGACY TESTNET SETTINGS (deprecated, mirrored to testnet3)
  testnetEnabled?: boolean;
  testnetMode?: ConnectionMode;
  testnetSingletonHost?: string | null;
  testnetSingletonPort?: number | null;
  testnetSingletonSsl?: boolean | null;
  testnetPoolMin?: number | null;
  testnetPoolMax?: number | null;
  testnetPoolLoadBalancing?: LoadBalancingStrategy;

  // SIGNET SETTINGS
  signetEnabled?: boolean;
  signetMode?: ConnectionMode;
  signetSingletonHost?: string;
  signetSingletonPort?: number;
  signetSingletonSsl?: boolean;
  signetPoolMin?: number;
  signetPoolMax?: number;
  signetPoolLoadBalancing?: LoadBalancingStrategy;

  // PROXY SETTINGS
  proxyEnabled?: boolean;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;

  // LEGACY FIELDS (deprecated, kept for backward compatibility)
  host?: string;
  port?: string;
  useSsl?: boolean;
  poolEnabled?: boolean;
  poolMinConnections?: number;
  poolMaxConnections?: number;
  poolLoadBalancing?: LoadBalancingStrategy;

  servers?: ElectrumServer[];
}

export interface ElectrumServer {
  id: string;
  nodeConfigId: string;
  network: WalletNetwork;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  lastHealthCheck?: string | null;
  healthCheckFails?: number;
  isHealthy?: boolean;
  lastHealthCheckError?: string | null;
  serverUsage?: "general" | "silent_payments" | "both";
  serverFeatures?: Record<string, unknown> | null;
  serverVersion?: string | null;
  protocolVersion?: string | null;
  supportsVerbose?: boolean | null;
  silentPaymentVersions?: number[] | null;
  supportsSilentPaymentsV0?: boolean | null;
  capabilityProfileKey?: string | null;
  lastCapabilityCheck?: string | null;
  lastCapabilityError?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface HealthCheckResult {
  timestamp: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ElectrumServerStats {
  serverId: string;
  label: string;
  host: string;
  port: number;
  connectionCount: number;
  healthyConnections: number;
  totalRequests: number;
  failedRequests: number;
  isHealthy: boolean;
  lastHealthCheck: string | null;
  consecutiveFailures: number;
  backoffLevel: number;
  cooldownUntil: string | null;
  weight: number;
  healthHistory: HealthCheckResult[];
  supportsVerbose?: boolean | null;
}

export interface ElectrumPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalAcquisitions: number;
  averageAcquisitionTimeMs: number;
  healthCheckFailures: number;
  serverCount: number;
  servers: ElectrumServerStats[];
}

// ============================================================================
// LABEL TYPES
// ============================================================================

export interface Label {
  id: string;
  walletId: string;
  name: string;
  color: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  transactionCount?: number;
  addressCount?: number;
}

export interface LabelWithItems extends Label {
  transactions: Array<{
    id: string;
    txid: string;
    type: string;
    amount: number;
    confirmations: number;
    blockTime?: string;
  }>;
  addresses: Array<{
    id: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
  }>;
}

// ============================================================================
// UTXO TYPES
// ============================================================================

export interface UTXO {
  id?: string;
  txid: string;
  vout: number;
  amount: number;
  address: string;
  label?: string;
  frozen?: boolean;
  spendable?: boolean;
  spent?: boolean;
  confirmations: number;
  date?: number | string;
  scriptType?: WalletScriptType;
  scriptPubKey?: string;
  blockHeight?: number;
  createdAt?: string;
  lockedByDraftId?: string;
  lockedByDraftLabel?: string;
}

// ============================================================================
// ADDRESS TYPES
// ============================================================================

export interface Address {
  id?: string;
  address: string;
  derivationPath: string;
  index: number;
  label?: string;
  labels?: Label[];
  used: boolean;
  balance: number;
  isChange?: boolean;
  createdAt?: string;
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

export interface TransactionInput {
  id?: string;
  transactionId?: string;
  inputIndex: number;
  txid: string;
  vout: number;
  address: string;
  amount: number;
  derivationPath?: string;
}

export interface TransactionOutput {
  id?: string;
  transactionId?: string;
  outputIndex: number;
  address: string;
  amount: number;
  scriptPubKey?: string;
  outputType:
    | "recipient"
    | "change"
    | "decoy"
    | "consolidation"
    | "op_return"
    | "unknown";
  isOurs: boolean;
  label?: string;
}

export interface Transaction {
  id: string;
  txid: string;
  walletId: string;
  amount: number;
  fee?: number;
  balanceAfter?: number;
  timestamp?: number;
  blockTime?: string;
  label?: string;
  memo?: string;
  labels?: Label[];
  confirmations: number;
  address?: string | { address: string; derivationPath?: string };
  blockHeight?: number;
  counterpartyAddress?: string;
  inputs?: TransactionInput[];
  outputs?: TransactionOutput[];
  type?: TransactionType;
  replacedByTxid?: string;
  replacementForTxid?: string;
  rbfStatus?: RbfStatus;
  isFrozen?: boolean;
  isLocked?: boolean;
  lockedByDraftLabel?: string;
}

export interface PendingTransaction {
  txid: string;
  walletId: string;
  walletName?: string;
  type: PendingTransactionType;
  amount: number;
  fee: number;
  feeRate: number;
  vsize?: number;
  recipient?: string;
  timeInQueue: number;
  createdAt: string;
}

// ============================================================================
// WALLET TYPES
// ============================================================================

export function getQuorumM(
  quorum: Quorum | number | undefined | null,
  fallback = 1,
): number {
  if (quorum === undefined || quorum === null) return fallback;
  return typeof quorum === "number" ? quorum : quorum.m;
}

export function getQuorumN(
  quorum: Quorum | number | undefined | null,
  totalSigners?: number,
  fallback = 1,
): number {
  if (quorum === undefined || quorum === null) return totalSigners ?? fallback;
  return typeof quorum === "number" ? (totalSigners ?? fallback) : quorum.n;
}

export interface Wallet {
  id: string;
  name: string;
  type: WalletType | string;
  scriptType?: WalletScriptType;
  network?: WalletNetwork;
  quorum?: Quorum | number;
  totalSigners?: number;
  deviceIds?: string[];
  balance: number;
  unit?: "BTC" | "sats" | "btc";
  descriptor?: string;
  ownerId?: string;
  groupIds?: string[];
  derivationPath?: string;
  fingerprint?: string;
  label?: string;
  xpub?: string;
  deviceCount?: number;
  addressCount?: number;
  createdAt?: string;
  lastSyncedAt?: string | null;
  lastSyncedBlockHeight?: number | null;
  lastSyncStatus?:
    | "success"
    | "failed"
    | "partial"
    | "retrying"
    | string
    | null;
  lastSyncError?: string | null;
  syncInProgress?: boolean;
  isShared?: boolean;
  sharedWith?: {
    groupName?: string | null;
    userCount: number;
  };
  userRole?: WalletRole;
  canEdit?: boolean;
}

// ============================================================================
// FEE ESTIMATE TYPES
// ============================================================================

export interface FeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee?: number;
  minimumFee?: number;
}

// ============================================================================
// BITCOIN TRANSACTION DETAILS
// ============================================================================

export interface BitcoinTransactionDetails {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: Array<{
    txid: string;
    vout: number;
    scriptSig?: string;
    sequence: number;
    prevout?: {
      value: number;
      scriptPubKey: {
        type: string;
        address?: string;
      };
    };
  }>;
  vout: Array<{
    value: number;
    n: number;
    scriptPubKey: {
      type: string;
      address?: string;
      addresses?: string[];
    };
  }>;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

export interface BlockHeader {
  height: number;
  hash: string;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  merkleroot: string;
  previousblockhash?: string;
  nextblockhash?: string;
}

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

export interface WebSocketTransactionData {
  txid?: string;
  type?: "received" | "sent" | "consolidation";
  amount?: number;
  confirmations?: number;
  walletId?: string;
}

export interface WebSocketBalanceData {
  balance?: number;
  confirmed?: number;
  unconfirmed?: number;
  change?: number;
  walletId?: string;
}

export interface WebSocketConfirmationData {
  txid?: string;
  confirmations?: number;
  walletId?: string;
}

export interface WebSocketSyncData {
  inProgress?: boolean;
  status?:
    | "scanning"
    | "complete"
    | "error"
    | "retry"
    | "retrying"
    | "success"
    | "failed";
  lastSyncedAt?: string;
  lastSyncedBlockHeight?: number | null;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  walletId?: string;
}

export interface WebSocketEventData {
  walletId?: string;
  balance?: number;
  txid?: string;
  amount?: number;
  type?: string;
  confirmations?: number;
  message?: string;
  change?: number;
  inProgress?: boolean;
  status?: string;
  lastSyncedAt?: string;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  [key: string]: unknown;
}

export interface WebSocketCallbacks {
  onTransaction?: (data: WebSocketTransactionData) => void;
  onBalance?: (data: WebSocketBalanceData) => void;
  onConfirmation?: (data: WebSocketConfirmationData) => void;
  onSync?: (data: WebSocketSyncData) => void;
}

// ============================================================================
// APP STATE
// ============================================================================

export interface AppState {
  isAuthenticated: boolean;
  darkMode: boolean;
  activeWalletId: string | null;
}

// ============================================================================
// OWNERSHIP TRANSFERS
// ============================================================================

export interface Transfer {
  id: string;
  resourceType: TransferResourceType;
  resourceId: string;
  fromUserId: string;
  toUserId: string;
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  message: string | null;
  declineReason: string | null;
  keepExistingUsers: boolean;
  fromUser?: { id: string; username: string };
  toUser?: { id: string; username: string };
  resourceName?: string;
}

export interface TransferFilters {
  role?: "initiator" | "recipient" | "all";
  status?: TransferStatus | "active" | "all";
  resourceType?: TransferResourceType;
}

export interface TransferCounts {
  pendingIncoming: number;
  awaitingConfirmation: number;
  total: number;
}
