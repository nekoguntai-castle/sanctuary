import React from 'react';
import type { Address, Device, Quorum } from '../../types';
import { TransactionExportModal } from '../TransactionExportModal';
import { TransferOwnershipModal } from '../TransferOwnershipModal';
import { DeleteModal, ReceiveModal, ExportModal, AddressQRModal, DeviceSharePromptModal } from './modals';
import type { DeviceSharePromptState } from './types';

interface WalletDetailModalsProps {
  // Wallet data
  walletId: string | undefined;
  walletName: string;
  walletType: string;
  walletScriptType?: string;
  walletDescriptor?: string;
  walletQuorum?: Quorum | number | null;
  walletTotalSigners?: number;
  devices: Device[];
  addresses: Address[];

  // Export Modal
  showExport: boolean;
  onCloseExport: () => void;
  onError: (err: unknown, title: string) => void;

  // Transaction Export Modal
  showTransactionExport: boolean;
  onCloseTransactionExport: () => void;

  // Receive Modal
  showReceive: boolean;
  onCloseReceive: () => void;
  onNavigateToSettings: () => void;
  onFetchUnusedAddresses: (walletId: string) => Promise<Address[]>;

  // Address QR Modal
  qrModalAddress: string | null;
  onCloseQrModal: () => void;

  // Device Share Prompt Modal
  deviceSharePrompt: DeviceSharePromptState;
  sharingLoading: boolean;
  onDismissDeviceSharePrompt: () => void;
  onShareDevicesWithUser: () => Promise<void>;

  // Delete Modal
  showDelete: boolean;
  onCloseDelete: () => void;
  onConfirmDelete: () => Promise<void>;

  // Transfer Modal
  showTransferModal: boolean;
  onCloseTransferModal: () => void;
  onTransferInitiated: () => void;
}

export const WalletDetailModals: React.FC<WalletDetailModalsProps> = ({
  walletId,
  walletName,
  walletType,
  walletScriptType,
  walletDescriptor,
  walletQuorum,
  walletTotalSigners,
  devices,
  addresses,

  showExport,
  onCloseExport,
  onError,

  showTransactionExport,
  onCloseTransactionExport,

  showReceive,
  onCloseReceive,
  onNavigateToSettings,
  onFetchUnusedAddresses,

  qrModalAddress,
  onCloseQrModal,

  deviceSharePrompt,
  sharingLoading,
  onDismissDeviceSharePrompt,
  onShareDevicesWithUser,

  showDelete,
  onCloseDelete,
  onConfirmDelete,

  showTransferModal,
  onCloseTransferModal,
  onTransferInitiated,
}) => {
  return (
    <>
      {/* Export Modal */}
      {showExport && walletId && (
        <ExportModal
          walletId={walletId}
          walletName={walletName}
          walletType={walletType}
          scriptType={walletScriptType}
          descriptor={walletDescriptor}
          quorum={walletQuorum}
          totalSigners={walletTotalSigners}
          devices={devices}
          onClose={onCloseExport}
          onError={onError}
        />
      )}

      {/* Transaction Export Modal */}
      {showTransactionExport && walletId && (
        <TransactionExportModal
          walletId={walletId}
          walletName={walletName}
          onClose={onCloseTransactionExport}
        />
      )}

      {/* Receive Modal */}
      {showReceive && walletId && (
        <ReceiveModal
          walletId={walletId}
          addresses={addresses}
          onClose={onCloseReceive}
          onNavigateToSettings={onNavigateToSettings}
          onFetchUnusedAddresses={onFetchUnusedAddresses}
        />
      )}

      {/* Address QR Code Modal */}
      {qrModalAddress && (
        <AddressQRModal
          address={qrModalAddress}
          onClose={onCloseQrModal}
        />
      )}

      {/* Device Share Prompt Modal */}
      <DeviceSharePromptModal
        deviceSharePrompt={deviceSharePrompt}
        sharingLoading={sharingLoading}
        onDismiss={onDismissDeviceSharePrompt}
        onShareDevices={onShareDevicesWithUser}
      />

      {/* Delete Confirmation Modal */}
      {showDelete && (
        <DeleteModal
          onConfirm={onConfirmDelete}
          onClose={onCloseDelete}
        />
      )}

      {/* Transfer Ownership Modal */}
      {showTransferModal && walletId && (
        <TransferOwnershipModal
          resourceType="wallet"
          resourceId={walletId}
          resourceName={walletName}
          onClose={onCloseTransferModal}
          onTransferInitiated={onTransferInitiated}
        />
      )}
    </>
  );
};
