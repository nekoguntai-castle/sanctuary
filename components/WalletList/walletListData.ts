import type { Wallet } from '../../src/api/wallets';
import type { TabNetwork } from '../NetworkTabs';
import type { PendingData, WalletCountsByNetwork, WalletSortField, WalletSortOrder } from './types';
import type { WalletWithPending } from '../cells/WalletCells';

interface PendingTransaction {
  walletId: string;
  amount: number;
  type: string;
}

const TAB_NETWORKS: TabNetwork[] = ['mainnet', 'testnet', 'signet'];

export function isTabNetwork(value: string | null): value is TabNetwork {
  return value !== null && TAB_NETWORKS.includes(value as TabNetwork);
}

export function resolveInitialNetwork(networkFromUrl: string | null): TabNetwork {
  return isTabNetwork(networkFromUrl) ? networkFromUrl : 'mainnet';
}

export function formatNetworkTitle(network: TabNetwork): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}

export function filterWalletsByNetwork(wallets: Wallet[], selectedNetwork: TabNetwork): Wallet[] {
  return wallets.filter(wallet => wallet.network === selectedNetwork);
}

export function countWalletsByNetwork(wallets: Wallet[]): WalletCountsByNetwork {
  return {
    mainnet: wallets.filter(wallet => wallet.network === 'mainnet').length,
    testnet: wallets.filter(wallet => wallet.network === 'testnet').length,
    signet: wallets.filter(wallet => wallet.network === 'signet').length,
  };
}

export function sortWallets(
  wallets: Wallet[],
  sortBy: WalletSortField,
  sortOrder: WalletSortOrder
): Wallet[] {
  if (!wallets.length) return wallets;

  return [...wallets].sort((a, b) => {
    const comparison = compareWallets(a, b, sortBy);
    return sortOrder === 'asc' ? comparison : -comparison;
  });
}

export function totalWalletBalance(wallets: Wallet[]): number {
  return wallets.reduce((acc, wallet) => acc + wallet.balance, 0);
}

export function walletIds(wallets: Wallet[]): string[] {
  return wallets.map(wallet => wallet.id);
}

export function buildPendingByWallet(
  pendingTransactions: PendingTransaction[]
): Record<string, PendingData> {
  const result: Record<string, PendingData> = {};

  for (const tx of pendingTransactions) {
    const pending = result[tx.walletId] ?? { net: 0, count: 0, hasIncoming: false, hasOutgoing: false };
    pending.net += tx.amount;
    pending.count++;
    if (tx.type === 'received') pending.hasIncoming = true;
    else pending.hasOutgoing = true;
    result[tx.walletId] = pending;
  }

  return result;
}

export function attachPendingData(
  wallets: Wallet[],
  pendingByWallet: Record<string, PendingData>
): WalletWithPending[] {
  return wallets.map(wallet => ({
    ...wallet,
    pendingData: pendingByWallet[wallet.id],
  }));
}

function compareWallets(a: Wallet, b: Wallet, sortBy: WalletSortField): number {
  switch (sortBy) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'type':
      return a.type.localeCompare(b.type);
    case 'devices':
      return (a.deviceCount ?? 0) - (b.deviceCount ?? 0);
    case 'network':
      return (a.network ?? '').localeCompare(b.network ?? '');
    case 'balance':
      return a.balance - b.balance;
    default:
      return 0;
  }
}
