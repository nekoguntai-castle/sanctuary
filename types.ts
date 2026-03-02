/**
 * Central Type Definitions
 *
 * Single source of truth for all shared types across the Sanctuary codebase.
 * This file contains both UI-facing types (enums for display) and API-facing types.
 */

// ============================================================================
// WALLET TYPE ENUMS & ALIASES
// ============================================================================

/**
 * WalletType enum - values match API/database format
 */
export enum WalletType {
  SINGLE_SIG = 'single_sig',
  MULTI_SIG = 'multi_sig',
}

/**
 * Display labels for wallet types (for UI rendering)
 */
export const WALLET_TYPE_LABELS: Record<WalletType, string> = {
  [WalletType.SINGLE_SIG]: 'Single Sig',
  [WalletType.MULTI_SIG]: 'Multisig',
};

/**
 * Helper to get display label for a wallet type
 */
export function getWalletTypeLabel(type: WalletType | string | undefined): string {
  if (!type) return 'Unknown';
  if (type === WalletType.MULTI_SIG || type === 'multi_sig') return WALLET_TYPE_LABELS[WalletType.MULTI_SIG];
  if (type === WalletType.SINGLE_SIG || type === 'single_sig') return WALLET_TYPE_LABELS[WalletType.SINGLE_SIG];
  return type as string;
}

/**
 * Helper to check if wallet type is multisig
 */
export function isMultisigType(type: WalletType | string | undefined): boolean {
  return type === WalletType.MULTI_SIG || type === 'multi_sig';
}

/**
 * Script type for wallet address derivation
 */
export type WalletScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';

/**
 * Bitcoin network
 */
export type WalletNetwork = 'mainnet' | 'testnet' | 'regtest' | 'signet';

// ============================================================================
// HARDWARE DEVICE ENUMS & TYPES
// ============================================================================

export enum HardwareDevice {
  COLDCARD_MK4 = 'ColdCardMk4',
  COLDCARD_Q = 'ColdCard Q',
  TREZOR = 'Trezor',
  TREZOR_SAFE_7 = 'Trezor Safe 7',
  LEDGER = 'Ledger Nano',
  LEDGER_STAX = 'Ledger Stax',
  LEDGER_FLEX = 'Ledger Flex',
  LEDGER_GEN_5 = 'Ledger Gen 5',
  BITBOX = 'BitBox02',
  FOUNDATION_PASSPORT = 'Foundation Passport',
  BLOCKSTREAM_JADE = 'Blockstream Jade',
  KEYSTONE = 'Keystone',
  GENERIC = 'Generic SD',
}

export interface HardwareDeviceModel {
  id: string;
  name: string;
  slug: string;
  manufacturer: string;
  connectivity: string[];
  secureElement: boolean;
  openSource: boolean;
  airGapped: boolean;
  supportsBitcoinOnly: boolean;
  supportsMultisig: boolean;
  supportsTaproot: boolean;
  supportsPassphrase: boolean;
  scriptTypes: string[];
  hasScreen: boolean;
  screenType?: string;
  integrationTested: boolean;
  releaseYear?: number;
  discontinued: boolean;
  imageUrl?: string;
  websiteUrl?: string;
}

// ============================================================================
// THEME & UI TYPES
// ============================================================================

export type ThemeOption =
  | 'sanctuary'
  | 'serenity'
  | 'forest'
  | 'cyber'
  | 'sunrise'
  | 'ocean'
  | 'sunset'
  | 'sakura-yoshino'
  | 'sakura-sumie'
  | 'midnight'
  | 'bamboo'
  | 'copper'
  | 'desert'
  | 'seasonal';

export type BackgroundOption =
  // Static backgrounds
  | 'minimal'
  | 'zen'
  | 'circuit'
  | 'topography'
  | 'waves'
  | 'lines'
  | 'sanctuary'
  | 'sanctuary-hero'
  | 'hexagons'
  | 'triangles'
  | 'stars'
  | 'aurora'
  | 'dots'
  | 'cross'
  | 'mountains'
  | 'noise'
  // Bitcoin themed
  | 'sakura-petals'
  | 'floating-shields'
  | 'bitcoin-particles'
  | 'stacking-blocks'
  | 'digital-rain'
  | 'constellation'
  | 'sanctuary-logo'
  | 'sats-symbol'
  | 'hash-storm'
  // Weather
  | 'snowfall'
  | 'fireflies'
  | 'gentle-rain'
  | 'northern-lights'
  | 'thunderstorm'
  | 'ice-crystals'
  | 'raindrop-window'
  // Nature
  | 'ink-drops'
  | 'rippling-water'
  | 'falling-leaves'
  | 'embers-rising'
  | 'butterfly-garden'
  | 'dandelion-wishes'
  | 'lavender-fields'
  | 'serene-meadows'
  | 'autumn-wind'
  // Sumi-e / Zen
  | 'brush-stroke-blossoms'
  | 'ink-branch'
  | 'calligraphy-wind'
  | 'mountain-mist'
  | 'koi-shadows'
  | 'bamboo-sway'
  | 'ink-on-water'
  | 'enso-circles'
  | 'zen-sand-garden'
  | 'smoke-calligraphy'
  | 'breath'
  | 'sakura-redux'
  // Water
  | 'gentle-waves'
  | 'tide-pools'
  | 'bioluminescent-beach'
  | 'tidal-patterns'
  | 'jellyfish-drift'
  // Sky
  | 'stargazing'
  | 'moonlit-clouds'
  | 'eclipse'
  | 'fireworks'
  // Landscape
  | 'misty-valley'
  | 'desert-dunes'
  | 'volcanic-islands'
  | 'still-ponds'
  // Creatures
  | 'duckling-parade'
  | 'bunny-meadow'
  // Whimsical
  | 'floating-lanterns'
  | 'paper-boats'
  | 'paper-airplanes'
  | 'wind-chimes'
  | 'lotus-bloom'
  | 'sunset-sailing'
  | 'train-station'
  // Organic
  | 'mycelium-network'
  | 'oil-slick'
  | 'wisteria';

// ============================================================================
// TELEGRAM & NOTIFICATION TYPES
// ============================================================================

export interface WalletTelegramSettings {
  enabled: boolean;
  notifyReceived: boolean;
  notifySent: boolean;
  notifyConsolidation: boolean;
  notifyDraft: boolean;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  wallets: Record<string, WalletTelegramSettings>;
}

export type SoundType = 'chime' | 'bell' | 'coin' | 'success' | 'gentle' | 'zen' | 'ping' | 'pop' | 'harp' | 'retro' | 'marimba' | 'glass' | 'synth' | 'drop' | 'sparkle' | 'drums' | 'whistle' | 'brass' | 'windchime' | 'click' | 'none';

export interface EventSoundConfig {
  enabled: boolean;
  sound: SoundType;
}

export interface NotificationSounds {
  enabled: boolean;
  volume: number; // 0-100
  // Per-event sound configuration
  confirmation?: EventSoundConfig; // Transaction confirmed
  receive?: EventSoundConfig;      // Bitcoin received
  send?: EventSoundConfig;         // Transaction broadcast
  // Legacy fields for backwards compatibility
  confirmationChime?: boolean;
  soundType?: SoundType;
}

// ============================================================================
// TABLE COLUMN CONFIGURATION
// ============================================================================

/**
 * Configuration for a table column (used in WalletList, DeviceList, etc.)
 */
export interface TableColumnConfig {
  id: string;
  label: string;
  sortable?: boolean;
  sortKey?: string;
  defaultVisible?: boolean;
  required?: boolean;        // Cannot be hidden (e.g., name column)
  align?: 'left' | 'center' | 'right';
}

/**
 * Column IDs for wallet list table
 */
export type WalletColumnId = 'name' | 'type' | 'devices' | 'sync' | 'pending' | 'balance';

/**
 * Column IDs for device list table
 */
export type DeviceColumnId = 'label' | 'type' | 'fingerprint' | 'accounts' | 'wallets' | 'actions';

// ============================================================================
// USER & GROUP TYPES
// ============================================================================

// View settings for a single page/component
export interface PageViewSettings {
  layout?: string;          // 'grid' | 'table' | 'list' | 'grouped' | etc.
  sortBy?: string;          // Column to sort by (future)
  sortOrder?: 'asc' | 'desc'; // Sort direction (future)
  ownershipFilter?: 'all' | 'owned' | 'shared'; // For filtering by ownership
  visibleColumns?: string[];  // Column IDs that are visible
  columnOrder?: string[];     // Column IDs in display order
}

// View settings keyed by page name (wallets, devices, transactions, etc.)
export interface ViewSettings {
  [pageKey: string]: PageViewSettings;
}

export interface SeasonalBackgrounds {
  spring?: BackgroundOption;
  summer?: BackgroundOption;
  fall?: BackgroundOption;
  winter?: BackgroundOption;
}

export interface UserPreferences {
  darkMode: boolean;
  unit: 'sats' | 'btc';
  fiatCurrency: 'USD' | 'EUR' | 'GBP' | 'JPY';
  showFiat: boolean;
  theme: ThemeOption;
  background: BackgroundOption;
  contrastLevel?: number; // -2 to +2, adjusts background contrast (0 = default)
  patternOpacity?: number; // 0 to 100, controls background visibility (default 50)
  priceProvider?: string;
  telegram?: TelegramConfig;
  notificationSounds?: NotificationSounds;
  viewSettings?: ViewSettings;
  seasonalBackgrounds?: SeasonalBackgrounds; // Custom backgrounds for each season
  favoriteBackgrounds?: BackgroundOption[]; // User's favorite backgrounds for quick access
  favoriteThemes?: ThemeOption[]; // User's favorite color themes
}

export interface User {
  id: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  password?: string; // Simple mock password
  preferences?: UserPreferences;
  twoFactorEnabled?: boolean;
  usingDefaultPassword?: boolean;
}

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
}

// ============================================================================
// NODE CONFIGURATION
// ============================================================================

export type ConnectionMode = 'singleton' | 'pool';
export type LoadBalancingStrategy = 'round_robin' | 'least_connections' | 'failover_only';

export interface NodeConfig {
  type: 'electrum'; // Only Electrum is supported
  explorerUrl?: string; // e.g., https://mempool.space
  feeEstimatorUrl?: string; // e.g., https://mempool.space (mempool.space-compatible API for fee estimation)
  mempoolEstimator?: 'simple' | 'mempool_space'; // Algorithm for block confirmation estimation
  allowSelfSignedCert?: boolean;

  // ========================================
  // MAINNET SETTINGS (always enabled)
  // ========================================
  mainnetMode: ConnectionMode;
  mainnetSingletonHost?: string;
  mainnetSingletonPort?: number;
  mainnetSingletonSsl?: boolean;
  mainnetPoolMin?: number;
  mainnetPoolMax?: number;
  mainnetPoolLoadBalancing?: LoadBalancingStrategy;

  // ========================================
  // TESTNET SETTINGS (optional)
  // ========================================
  testnetEnabled?: boolean;
  testnetMode?: ConnectionMode;
  testnetSingletonHost?: string;
  testnetSingletonPort?: number;
  testnetSingletonSsl?: boolean;
  testnetPoolMin?: number;
  testnetPoolMax?: number;
  testnetPoolLoadBalancing?: LoadBalancingStrategy;

  // ========================================
  // SIGNET SETTINGS (optional)
  // ========================================
  signetEnabled?: boolean;
  signetMode?: ConnectionMode;
  signetSingletonHost?: string;
  signetSingletonPort?: number;
  signetSingletonSsl?: boolean;
  signetPoolMin?: number;
  signetPoolMax?: number;
  signetPoolLoadBalancing?: LoadBalancingStrategy;

  // ========================================
  // PROXY SETTINGS (global, applies to all networks)
  // ========================================
  proxyEnabled?: boolean;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;

  // ========================================
  // LEGACY FIELDS (deprecated, kept for backward compatibility)
  // ========================================
  host?: string;
  port?: string;
  useSsl?: boolean;
  poolEnabled?: boolean;
  poolMinConnections?: number;
  poolMaxConnections?: number;
  poolLoadBalancing?: LoadBalancingStrategy;

  // Electrum server list (multi-server pool support)
  servers?: ElectrumServer[];
}

// Electrum server configuration
export interface ElectrumServer {
  id: string;
  nodeConfigId: string;
  network: 'mainnet' | 'testnet' | 'signet';
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  // Health tracking
  lastHealthCheck?: string | null;
  healthCheckFails?: number;
  isHealthy?: boolean;
  lastHealthCheckError?: string | null;
  // Capability tracking
  supportsVerbose?: boolean | null; // null = unknown
  lastCapabilityCheck?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// Health check result for history tracking
export interface HealthCheckResult {
  timestamp: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
}

// Per-server statistics (from pool stats)
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
  // Backoff state
  consecutiveFailures: number;
  backoffLevel: number;
  cooldownUntil: string | null;
  weight: number;
  // Health check history (most recent first)
  healthHistory: HealthCheckResult[];
  // Capability flags
  supportsVerbose?: boolean | null; // null = unknown
}

// Electrum connection pool statistics
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
// DEVICE TYPES
// ============================================================================

/**
 * Device account - represents one xpub at a specific derivation path
 */
export interface DeviceAccount {
  id: string;
  purpose: 'single_sig' | 'multisig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  derivationPath: string;
  xpub: string;
}

export interface Device {
  id: string;
  type: HardwareDevice | string;
  label: string;
  fingerprint: string;
  derivationPath?: string;
  xpub?: string; // Optional for backward compat, but typically present
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  model?: HardwareDeviceModel;
  accounts?: DeviceAccount[]; // All accounts (multi-account support)
  walletCount?: number; // Number of associated wallets (list view)
  wallets?: Array<{    // Full wallet details (detail view only)
    wallet: {
      id: string;
      name: string;
      type: string;
      scriptType?: string;
    };
  }>;
  // Wallet-specific metadata (set by formatDevicesForWallet)
  accountMissing?: boolean;
  // Sharing info (present when fetching accessible devices)
  isOwner?: boolean;
  userRole?: DeviceRole;
  sharedBy?: string; // Username of owner if shared
  groupId?: string;
  groupRole?: string;
}

export type DeviceRole = 'owner' | 'viewer' | null;

export interface DeviceShareInfo {
  group: { id: string; name: string } | null;
  users: Array<{ id: string; username: string; role: string }>;
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
  // Optional counts (present on list responses)
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
  id?: string; // Database ID (needed for freeze API)
  txid: string;
  vout: number;
  amount: number; // in sats
  address: string;
  label?: string;
  frozen?: boolean;
  spendable?: boolean;
  spent?: boolean;
  confirmations: number;
  date?: number | string; // timestamp
  scriptType?: WalletScriptType;
  scriptPubKey?: string;
  blockHeight?: number;
  createdAt?: string;
  // Draft lock info (UTXO is reserved for a pending draft transaction)
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
  labels?: Label[]; // Multiple labels support
  used: boolean;
  balance: number;
  isChange?: boolean; // true for change addresses (/1/x), false for receive (/0/x)
  createdAt?: string;
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

/**
 * Full transaction input with UTXO reference and derivation path
 * Stores which UTXOs were spent in a transaction
 */
export interface TransactionInput {
  id?: string;
  transactionId?: string;
  inputIndex: number;
  txid: string; // Previous tx being spent
  vout: number; // Output index being spent
  address: string;
  amount: number; // in satoshis
  derivationPath?: string; // BIP32 path if known (for our wallet inputs)
}

/**
 * Full transaction output with classification
 * Stores all outputs with type classification (recipient, change, decoy, etc.)
 */
export interface TransactionOutput {
  id?: string;
  transactionId?: string;
  outputIndex: number;
  address: string;
  amount: number; // in satoshis
  scriptPubKey?: string;
  outputType: 'recipient' | 'change' | 'decoy' | 'consolidation' | 'op_return' | 'unknown';
  isOurs: boolean; // Does this address belong to our wallet?
  label?: string;
}

export interface Transaction {
  id: string;
  txid: string;
  walletId: string;
  amount: number; // in sats, negative for send, positive for receive
  fee?: number;
  balanceAfter?: number; // Wallet balance after this transaction (running balance)
  timestamp?: number; // Unix timestamp (legacy field)
  blockTime?: string; // ISO timestamp (preferred)
  label?: string;
  memo?: string;
  labels?: Label[]; // Multiple labels support
  confirmations: number;
  address?: string | { address: string; derivationPath?: string }; // Address this transaction is associated with
  blockHeight?: number; // Block height when confirmed
  counterpartyAddress?: string; // Sender (for receives) or recipient (for sends)
  inputs?: TransactionInput[];
  outputs?: TransactionOutput[];
  type?: 'sent' | 'received' | 'consolidation' | 'receive'; // Transaction type from sync
  // RBF tracking
  replacedByTxid?: string; // If this tx was replaced, points to replacement
  replacementForTxid?: string; // If this is a replacement, points to original
  rbfStatus?: 'active' | 'replaced' | 'confirmed'; // Transaction RBF status
}

/**
 * Pending transaction for block queue visualization
 * Shows user's unconfirmed transactions and their position in mempool
 */
export interface PendingTransaction {
  txid: string;
  walletId: string;
  walletName?: string;
  type: 'sent' | 'received';
  amount: number; // in satoshis
  fee: number; // in satoshis
  feeRate: number; // sat/vB (fee / vsize)
  vsize?: number; // virtual size in vBytes
  recipient?: string; // recipient address for sent txs
  timeInQueue: number; // seconds since broadcast
  createdAt: string; // ISO timestamp
}

// ============================================================================
// WALLET TYPES
// ============================================================================

export interface Quorum {
  m: number;
  n: number;
}

/**
 * Helper to get the 'm' value from a Quorum (required signatures)
 * Handles both Quorum object and plain number
 */
export function getQuorumM(quorum: Quorum | number | undefined | null, fallback = 1): number {
  if (quorum === undefined || quorum === null) return fallback;
  return typeof quorum === 'number' ? quorum : quorum.m;
}

/**
 * Helper to get the 'n' value from a Quorum (total signers)
 * Handles both Quorum object and plain number (needs totalSigners)
 */
export function getQuorumN(quorum: Quorum | number | undefined | null, totalSigners?: number, fallback = 1): number {
  if (quorum === undefined || quorum === null) return totalSigners ?? fallback;
  return typeof quorum === 'number' ? (totalSigners ?? fallback) : quorum.n;
}

export type WalletRole = 'owner' | 'signer' | 'viewer' | null;

export interface Wallet {
  id: string;
  name: string;
  type: WalletType | string; // Supports both enum values and API strings
  scriptType?: WalletScriptType;
  network?: WalletNetwork;
  quorum?: Quorum | number; // Quorum object or just m value
  totalSigners?: number; // n value when quorum is a number
  deviceIds?: string[];
  balance: number;
  unit?: 'BTC' | 'sats' | 'btc';
  descriptor?: string;
  ownerId?: string; // User ID of the creator
  groupIds?: string[]; // IDs of groups this wallet is shared with
  derivationPath?: string;
  fingerprint?: string;
  label?: string;
  xpub?: string;
  // Counts
  deviceCount?: number;
  addressCount?: number;
  // Timestamps
  createdAt?: string;
  // Sync metadata
  lastSyncedAt?: string | null;
  lastSyncedBlockHeight?: number | null;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'retrying' | string | null;
  syncInProgress?: boolean;
  // Sharing info
  isShared?: boolean;
  sharedWith?: {
    groupName?: string | null;
    userCount: number;
  };
  // User permissions for this wallet
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

export interface FeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum?: number;
}

// ============================================================================
// BITCOIN TRANSACTION DETAILS (for Electrum/mempool.space responses)
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
  type?: 'received' | 'sent' | 'consolidation';
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
  status?: 'scanning' | 'complete' | 'error' | 'retry' | 'retrying' | 'success' | 'failed';
  lastSyncedAt?: string;
  lastSyncedBlockHeight?: number | null;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  walletId?: string;
}

// Generic event data for backward compatibility
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
// UTXO SELECTION STRATEGIES
// ============================================================================

/**
 * UTXO selection strategy for transaction building
 * - privacy: Minimize address linking and metadata leakage
 * - efficiency: Minimize fees and optimize transaction size
 * - oldest_first: Select oldest UTXOs first (useful for coin age)
 * - largest_first: Select largest UTXOs first (consolidation)
 * - smallest_first: Select smallest UTXOs first (dust cleanup)
 */
export type SelectionStrategy =
  | 'privacy'
  | 'efficiency'
  | 'oldest_first'
  | 'largest_first'
  | 'smallest_first';

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

export type TransferStatus = 'pending' | 'accepted' | 'confirmed' | 'cancelled' | 'declined' | 'expired';
export type TransferResourceType = 'wallet' | 'device';

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
  role?: 'initiator' | 'recipient' | 'all';
  status?: TransferStatus | 'active' | 'all';
  resourceType?: TransferResourceType;
}

export interface TransferCounts {
  pendingIncoming: number;
  awaitingConfirmation: number;
  total: number;
}
