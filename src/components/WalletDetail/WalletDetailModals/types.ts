import type { Address, Device } from '../../../types';
import type { DeviceSharePromptState } from '../types';

export interface WalletDetailModalsProps {
  walletId: string | undefined;
  walletName: string;
  walletType: string;
  walletDescriptor?: string;
  devices: Device[];
  addresses: Address[];
  showExport: boolean;
  onCloseExport: () => void;
  onError: (err: unknown, title: string) => void;
  showTransactionExport: boolean;
  onCloseTransactionExport: () => void;
  showReceive: boolean;
  onCloseReceive: () => void;
  onNavigateToSettings: () => void;
  onFetchUnusedAddresses: (walletId: string) => Promise<Address[]>;
  qrModalAddress: string | null;
  onCloseQrModal: () => void;
  deviceSharePrompt: DeviceSharePromptState;
  sharingLoading: boolean;
  onDismissDeviceSharePrompt: () => void;
  onShareDevicesWithUser: () => Promise<void>;
  showDelete: boolean;
  onCloseDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  showTransferModal: boolean;
  onCloseTransferModal: () => void;
  onTransferInitiated: () => void;
}
