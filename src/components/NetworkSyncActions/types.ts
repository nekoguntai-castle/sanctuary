import type { TabNetwork } from '../NetworkTabs';

/** Just enough of a wallet to name it in a batch result. */
export interface NetworkSyncWallet {
  id: string;
  name: string;
}

export interface NetworkSyncActionsProps {
  network: TabNetwork;
  walletCount: number;
  /** The wallets in this network, so a partial batch can name what it missed. */
  wallets?: NetworkSyncWallet[];
  className?: string;
  compact?: boolean;
  onSyncStarted?: () => void;
}

export interface NetworkSyncResult {
  type: 'success' | 'warning' | 'error';
  message: string;
}

export interface NetworkSyncActionState {
  networkLabel: string;
  syncing: boolean;
  resyncing: boolean;
  showResyncDialog: boolean;
  result: NetworkSyncResult | null;
  isDisabled: boolean;
  handleSyncAll: () => Promise<void>;
  handleResyncAll: () => Promise<void>;
  openResyncDialog: () => void;
  closeResyncDialog: () => void;
}
