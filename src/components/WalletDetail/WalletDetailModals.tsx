import React from 'react';
import { DeviceSharePromptModal } from './modals';
import { AddressQrModalMount } from './WalletDetailModals/AddressQrModalMount';
import { DeleteModalMount } from './WalletDetailModals/DeleteModalMount';
import { ExportModalMount } from './WalletDetailModals/ExportModalMount';
import { ReceiveModalMount } from './WalletDetailModals/ReceiveModalMount';
import { TransactionExportModalMount } from './WalletDetailModals/TransactionExportModalMount';
import { TransferOwnershipModalMount } from './WalletDetailModals/TransferOwnershipModalMount';
import type { WalletDetailModalsProps } from './WalletDetailModals/types';

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
      <ExportModalMount
        showExport={showExport}
        walletId={walletId}
        walletName={walletName}
        walletType={walletType}
        walletScriptType={walletScriptType}
        walletDescriptor={walletDescriptor}
        walletQuorum={walletQuorum}
        walletTotalSigners={walletTotalSigners}
        devices={devices}
        onCloseExport={onCloseExport}
        onError={onError}
      />
      <TransactionExportModalMount
        showTransactionExport={showTransactionExport}
        walletId={walletId}
        walletName={walletName}
        onCloseTransactionExport={onCloseTransactionExport}
      />
      <ReceiveModalMount
        showReceive={showReceive}
        walletId={walletId}
        addresses={addresses}
        onCloseReceive={onCloseReceive}
        onNavigateToSettings={onNavigateToSettings}
        onFetchUnusedAddresses={onFetchUnusedAddresses}
      />
      <AddressQrModalMount
        qrModalAddress={qrModalAddress}
        onCloseQrModal={onCloseQrModal}
      />
      <DeviceSharePromptModal
        deviceSharePrompt={deviceSharePrompt}
        sharingLoading={sharingLoading}
        onDismiss={onDismissDeviceSharePrompt}
        onShareDevices={onShareDevicesWithUser}
      />
      <DeleteModalMount
        showDelete={showDelete}
        onConfirmDelete={onConfirmDelete}
        onCloseDelete={onCloseDelete}
      />
      <TransferOwnershipModalMount
        showTransferModal={showTransferModal}
        walletId={walletId}
        walletName={walletName}
        onCloseTransferModal={onCloseTransferModal}
        onTransferInitiated={onTransferInitiated}
      />
    </>
  );
};
