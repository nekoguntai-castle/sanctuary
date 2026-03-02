/**
 * Event Type Definitions
 *
 * All event interfaces and type unions for the typed event bus.
 */

/**
 * Wallet-related events
 */
export interface WalletEvents {
  'wallet:created': {
    walletId: string;
    userId: string;
    name: string;
    type: 'single' | 'multisig';
    network: string;
  };
  'wallet:deleted': {
    walletId: string;
    userId: string;
  };
  'wallet:synced': {
    walletId: string;
    balance: bigint;
    unconfirmedBalance: bigint;
    transactionCount: number;
    duration: number;
  };
  'wallet:syncStarted': {
    walletId: string;
    fullResync: boolean;
  };
  'wallet:syncFailed': {
    walletId: string;
    error: string;
    retryCount: number;
  };
  'wallet:balanceChanged': {
    walletId: string;
    previousBalance: bigint;
    newBalance: bigint;
    difference: bigint;
  };
}

/**
 * Transaction-related events
 */
export interface TransactionEvents {
  'transaction:received': {
    walletId: string;
    txid: string;
    amount: bigint;
    address: string;
    confirmations: number;
  };
  'transaction:sent': {
    walletId: string;
    txid: string;
    amount: bigint;
    fee: bigint;
    recipients: Array<{ address: string; amount: bigint }>;
  };
  'transaction:confirmed': {
    walletId: string;
    txid: string;
    confirmations: number;
    blockHeight: number;
  };
  'transaction:rbfReplaced': {
    walletId: string;
    originalTxid: string;
    replacementTxid: string;
  };
  'transaction:broadcast': {
    walletId: string;
    txid: string;
    rawTx: string;
  };
}

/**
 * Device-related events
 */
export interface DeviceEvents {
  'device:registered': {
    deviceId: string;
    userId: string;
    type: string;
    fingerprint: string;
  };
  'device:deleted': {
    deviceId: string;
    userId: string;
  };
  'device:shared': {
    deviceId: string;
    ownerId: string;
    sharedWithUserId: string;
    role: 'owner' | 'viewer';
  };
}

/**
 * User-related events
 */
export interface UserEvents {
  'user:created': {
    userId: string;
    username: string;
  };
  'user:login': {
    userId: string;
    username: string;
    ipAddress?: string;
  };
  'user:logout': {
    userId: string;
  };
  'user:passwordChanged': {
    userId: string;
  };
  'user:twoFactorEnabled': {
    userId: string;
  };
  'user:twoFactorDisabled': {
    userId: string;
  };
}

/**
 * System-related events
 */
export interface SystemEvents {
  'system:startup': {
    version: string;
    environment: string;
  };
  'system:shutdown': {
    reason: string;
  };
  'system:healthCheck': {
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: Record<string, boolean>;
  };
  'system:maintenanceStarted': {
    task: string;
  };
  'system:maintenanceCompleted': {
    task: string;
    duration: number;
    success: boolean;
  };
  'system:config.changed': {
    key: string;
    previousValue: string;
    newValue: string;
    changedBy: string;
  };
}

/**
 * Blockchain-related events
 */
export interface BlockchainEvents {
  'blockchain:newBlock': {
    network: string;
    height: number;
    hash: string;
  };
  'blockchain:feeEstimateUpdated': {
    network: string;
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
  };
  'blockchain:priceUpdated': {
    btcUsd: number;
    source: string;
  };
}

/**
 * All event types combined
 */
export type EventTypes = WalletEvents &
  TransactionEvents &
  DeviceEvents &
  UserEvents &
  SystemEvents &
  BlockchainEvents;

/**
 * Event names
 */
export type EventName = keyof EventTypes;

/**
 * Event handler type
 */
export type EventHandler<E extends EventName> = (data: EventTypes[E]) => void | Promise<void>;
