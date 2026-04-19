import type { TabNetwork } from '../NetworkTabs';

export type WalletViewMode = 'grid' | 'table';
export type WalletSortField = 'name' | 'type' | 'devices' | 'network' | 'balance';
export type WalletSortOrder = 'asc' | 'desc';

export interface PendingData {
  net: number;
  count: number;
  hasIncoming: boolean;
  hasOutgoing: boolean;
}

export type WalletCountsByNetwork = Record<TabNetwork, number>;
export type WalletValueFormatter = (value: number) => string | null;
