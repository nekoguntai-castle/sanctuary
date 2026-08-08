import { satsToBTC, formatBTC } from '@sanctuary/shared/utils/bitcoin';
import {
  WalletType,
  type Transaction,
  type Wallet,
  type WalletNetwork,
  type WebSocketBalanceData,
  type WebSocketConfirmationData,
  type WebSocketSyncData,
  type WebSocketTransactionData,
} from '../../../types';
import type { Notification } from '../../NotificationToast';
import type { TabNetwork } from '../../NetworkTabs';
import type {
  BitcoinStatus,
  BlockData,
  FeeEstimates,
  MempoolData,
  QueuedBlocksSummary,
} from '../../../api/bitcoin';
import type { RecentTransaction } from '../../../api/transactions/types';
import { toTabNetwork } from '../../../app/networks';
import type { SoundEvent } from '../../../hooks/useNotificationSound';

export interface DashboardFeeEstimate {
  fast: number;
  medium: number;
  slow: number;
}

interface MempoolSnapshot {
  mempoolBlocks: BlockData[];
  queuedBlocksSummary: QueuedBlocksSummary | null;
  lastMempoolUpdate: Date | null;
}

interface DashboardNotificationResult {
  notification: Omit<Notification, 'id'>;
  sound?: SoundEvent;
}

type DashboardTransaction = Transaction & { confirmed: boolean };

function numericValue(value: string | number | undefined | null): number {
  if (typeof value === 'string') {
    return parseInt(value, 10);
  }

  return value ?? 0;
}

export function resolveInitialNetwork(networkFromUrl: string | null): TabNetwork {
  return toTabNetwork(networkFromUrl);
}

export function applyNetworkSearchParam(searchParams: URLSearchParams, network: TabNetwork) {
  if (network === 'mainnet') {
    searchParams.delete('network');
  } else {
    searchParams.set('network', network);
  }

  return searchParams;
}

export function mapApiWalletToDashboardWallet(wallet: Wallet): Wallet {
  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type as WalletType,
    balance: wallet.balance,
    scriptType: wallet.scriptType,
    network: (wallet.network as WalletNetwork) || 'mainnet',
    derivationPath: wallet.descriptor || '',
    fingerprint: wallet.fingerprint || '',
    label: wallet.name,
    xpub: '',
    lastSyncedAt: wallet.lastSyncedAt,
    lastSyncStatus: wallet.lastSyncStatus as 'success' | 'failed' | 'partial' | null,
    syncInProgress: wallet.syncInProgress,
  };
}

export function getFilteredWallets(wallets: Wallet[], selectedNetwork: TabNetwork): Wallet[] {
  return wallets
    .filter((wallet) => toTabNetwork(wallet.network) === selectedNetwork)
    .sort((a, b) => b.balance - a.balance);
}

export function countWalletsByNetwork(wallets: Wallet[]): Record<TabNetwork, number> {
  return {
    mainnet: wallets.filter((wallet) => toTabNetwork(wallet.network) === 'mainnet').length,
    testnet3: wallets.filter((wallet) => toTabNetwork(wallet.network) === 'testnet3').length,
    testnet4: wallets.filter((wallet) => toTabNetwork(wallet.network) === 'testnet4').length,
    signet: wallets.filter((wallet) => toTabNetwork(wallet.network) === 'signet').length,
  };
}

export function mapRecentTransaction(transaction: RecentTransaction): DashboardTransaction {
  const rawAmount = numericValue(transaction.amount);
  const amount = transaction.type === 'sent' ? -Math.abs(rawAmount) : Math.abs(rawAmount);

  return {
    id: transaction.id,
    txid: transaction.txid,
    walletId: transaction.walletId,
    amount,
    fee: transaction.fee ? numericValue(transaction.fee) : undefined,
    confirmations: transaction.confirmations,
    confirmed: transaction.confirmations > 0,
    blockHeight: transaction.blockHeight,
    timestamp: transaction.blockTime ? new Date(transaction.blockTime).getTime() : Date.now(),
    label: transaction.label || '',
    type: transaction.type,
    isFrozen: !!transaction.isFrozen,
    isLocked: !!transaction.isLocked,
    lockedByDraftLabel: transaction.lockedByDraftLabel || undefined,
  };
}

export function toDashboardFeeEstimate(feeEstimates: FeeEstimates | undefined): DashboardFeeEstimate | null {
  if (!feeEstimates) {
    return null;
  }

  return {
    fast: feeEstimates.fastest,
    medium: feeEstimates.hour,
    slow: feeEstimates.economy,
  };
}

/**
 * The parameter type is a declaration, not a guarantee. `FeeEstimates` types
 * these fields as `number`, but the response is never validated at runtime —
 * `apiClient.get<FeeEstimates>` is an unchecked assertion — so a null from the
 * node reaches this function as readily as a number, and `null.toFixed(1)`
 * threw during render and took the dashboard down with it. NaN and Infinity
 * got through too, and printed themselves.
 *
 * Anything that is not a finite number is not a rate, and the card already has
 * a way to say so. Keep the guard even though the type says it cannot happen.
 */
/**
 * True when a query failed *and* never delivered anything.
 *
 * The distinction carries the dashboard's error states. React Query keeps the
 * last good `data` through a failed refetch, and these queries are invalidated
 * constantly — visibility change, socket reconnect, every balance event. So
 * `isError` alone would blank a card that is displaying perfectly good figures,
 * and would yank a genuinely new user out of the welcome state on the first
 * transient blip. Only the absence of any answer means we never got one.
 */
export function neverAnswered(isError: boolean | undefined, data: unknown): boolean {
  return Boolean(isError) && data === undefined;
}

export function formatFeeRate(rate: number | undefined): string {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '---';
  if (rate >= 10) return Math.round(rate).toString();
  if (Number.isInteger(rate)) return rate.toString();
  return rate.toFixed(1);
}

export function getNodeStatus(
  statusLoading: boolean,
  bitcoinStatus: BitcoinStatus | undefined
): 'unknown' | 'checking' | 'connected' | 'error' {
  if (statusLoading) return 'checking';
  if (bitcoinStatus === undefined) return 'unknown';
  return bitcoinStatus.connected ? 'connected' : 'error';
}

export function buildMempoolSnapshot(mempoolData: MempoolData | undefined): MempoolSnapshot {
  if (!mempoolData) {
    return {
      mempoolBlocks: [],
      queuedBlocksSummary: null,
      lastMempoolUpdate: null,
    };
  }

  return {
    mempoolBlocks: [...mempoolData.mempool, ...mempoolData.blocks],
    queuedBlocksSummary: mempoolData.queuedBlocksSummary || null,
    lastMempoolUpdate: new Date(),
  };
}

export function buildTransactionNotification(
  data: WebSocketTransactionData
): DashboardNotificationResult {
  const title = data.type === 'received' ? 'Bitcoin Received'
    : data.type === 'consolidation' ? 'Consolidation'
    : 'Bitcoin Sent';
  const prefix = data.type === 'received' ? '+' : '-';
  const sound = data.type === 'received' ? 'receive'
    : data.type === 'sent' || data.type === 'consolidation' ? 'send'
    : undefined;

  return {
    notification: {
      type: 'transaction',
      title,
      message: `${prefix}${formatBTC(satsToBTC(Math.abs(data.amount ?? 0)), 8, false)} BTC • ${data.confirmations ?? 0} confirmations`,
      duration: 10000,
      data,
    },
    sound,
  };
}

export function buildBalanceNotification(data: WebSocketBalanceData): Omit<Notification, 'id'> | null {
  const change = data.change ?? 0;

  if (Math.abs(change) <= 10000) {
    return null;
  }

  return {
    type: 'balance',
    title: 'Balance Updated',
    message: `${change > 0 ? '+' : ''}${formatBTC(satsToBTC(change), 8, false)} BTC`,
    duration: 8000,
    data,
  };
}

export function buildBlockNotification(data: { height: number; transactionCount?: number }): Omit<Notification, 'id'> {
  return {
    type: 'block',
    title: 'New Block Mined',
    message: `Block #${data.height.toLocaleString()} • ${data.transactionCount || 0} transactions`,
    duration: 6000,
    data,
  };
}

export function buildConfirmationNotification(
  data: WebSocketConfirmationData & { previousConfirmations?: number }
): DashboardNotificationResult | null {
  const confirmations = data.confirmations ?? 0;
  const isFirstConfirmation = data.previousConfirmations === 0 && confirmations >= 1;

  if (![1, 3, 6].includes(confirmations) && !isFirstConfirmation) {
    return null;
  }

  return {
    notification: {
      type: 'confirmation',
      title: 'Transaction Confirmed',
      message: `${confirmations} confirmation${confirmations > 1 ? 's' : ''} reached`,
      duration: 5000,
      data,
    },
    sound: isFirstConfirmation ? 'confirmation' : undefined,
  };
}

export function getSyncWalletId(data: WebSocketSyncData): string | null {
  return data.walletId || null;
}
