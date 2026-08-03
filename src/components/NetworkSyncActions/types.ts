import type { TabNetwork } from '../NetworkTabs';

export interface NetworkSyncActionsProps {
  network: TabNetwork;
  walletCount: number;
  className?: string;
  compact?: boolean;
  onSyncStarted?: () => void;
}

export interface NetworkSyncResult {
  type: 'success' | 'error';
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
