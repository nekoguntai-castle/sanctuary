import React from 'react';
import { ManualAccountForm } from '../../ManualAccountForm';
import { FileImport } from '../FileImport';
import { ImportReview } from '../ImportReview';
import { QrImport } from '../QrImport';
import type { AddAccountFlowProps, AddAccountMethod } from '../types';
import { UsbImport } from '../UsbImport';
import type { AddAccountFlowController } from './types';

interface AddAccountMethodPanelProps {
  method: Exclude<AddAccountMethod, null>;
  controller: AddAccountFlowController;
  device: AddAccountFlowProps['device'];
}

export const AddAccountMethodPanel: React.FC<AddAccountMethodPanelProps> = ({
  method,
  controller,
  device,
}) => {
  if (controller.parsedAccounts.length > 0) {
    return (
      <ImportReview
        parsedAccounts={controller.parsedAccounts}
        selectedParsedAccounts={controller.selectedParsedAccounts}
        setSelectedParsedAccounts={controller.setSelectedParsedAccounts}
        accountConflict={controller.accountConflict}
        addAccountLoading={controller.addAccountLoading}
        onAddParsedAccounts={controller.handleAddParsedAccounts}
      />
    );
  }

  switch (method) {
    case 'usb':
      return (
        <UsbImport
          deviceType={device.type}
          addAccountLoading={controller.addAccountLoading}
          usbProgress={controller.usbProgress}
          onConnect={controller.handleAddAccountsViaUsb}
        />
      );
    case 'sdcard':
      return (
        <FileImport
          deviceType={device.type}
          addAccountLoading={controller.addAccountLoading}
          onFileUpload={controller.handleFileUpload}
        />
      );
    case 'qr':
      return (
        <QrImport
          qrMode={controller.qrMode}
          setQrMode={controller.setQrMode}
          cameraActive={controller.cameraActive}
          setCameraActive={controller.setCameraActive}
          cameraError={controller.cameraError}
          setCameraError={controller.setCameraError}
          urProgress={controller.urProgress}
          setUrProgress={controller.setUrProgress}
          addAccountLoading={controller.addAccountLoading}
          onQrScan={controller.handleQrScan}
          onCameraError={controller.handleCameraError}
          onFileUpload={controller.handleFileUpload}
          urDecoderRef={controller.urDecoderRef}
          bytesDecoderRef={controller.bytesDecoderRef}
        />
      );
    case 'manual':
      return (
        <ManualAccountForm
          account={controller.manualAccount}
          onChange={controller.setManualAccount}
          onSubmit={controller.handleAddAccountManually}
          loading={controller.addAccountLoading}
        />
      );
    default:
      return null;
  }
};
