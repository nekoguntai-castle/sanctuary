import React from 'react';
import type { HardwareDeviceModel } from '../../../src/api/devices';
import type { ConnectionMethod, DeviceFormData, QrScannerPanelProps, UsbConnectionPanelProps } from '../types';
import { FileUploadPanel } from '../FileUploadPanel';
import { QrScannerPanel } from '../QrScannerPanel';
import { UsbConnectionPanel } from '../UsbConnectionPanel';
import { ManualConnectionWarning } from './ManualConnectionWarning';

interface ConnectionActionPanelProps {
  selectedModel: HardwareDeviceModel;
  method: ConnectionMethod;
  scanned: boolean;
  fileScanning: boolean;
  formData: DeviceFormData;
  usbScanning: boolean;
  usbProgress: UsbConnectionPanelProps['usbProgress'];
  usbError: string | null;
  qrMode: QrScannerPanelProps['qrMode'];
  cameraActive: boolean;
  cameraError: string | null;
  urProgress: number;
  qrScanning: boolean;
  isSecure: boolean;
  onConnectUsb: (model: HardwareDeviceModel) => void | Promise<void>;
  onFileUpload: QrScannerPanelProps['onFileUpload'];
  onQrModeChange: QrScannerPanelProps['onQrModeChange'];
  onCameraActiveChange: QrScannerPanelProps['onCameraActiveChange'];
  onQrScan: QrScannerPanelProps['onQrScan'];
  onCameraError: QrScannerPanelProps['onCameraError'];
  onStopCamera: QrScannerPanelProps['onStopCamera'];
}

export const ConnectionActionPanel: React.FC<ConnectionActionPanelProps> = ({
  selectedModel,
  method,
  scanned,
  fileScanning,
  formData,
  usbScanning,
  usbProgress,
  usbError,
  qrMode,
  cameraActive,
  cameraError,
  urProgress,
  qrScanning,
  isSecure,
  onConnectUsb,
  onFileUpload,
  onQrModeChange,
  onCameraActiveChange,
  onQrScan,
  onCameraError,
  onStopCamera,
}) => (
  <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
    <ConnectionActionContent
      selectedModel={selectedModel}
      method={method}
      scanned={scanned}
      fileScanning={fileScanning}
      formData={formData}
      usbScanning={usbScanning}
      usbProgress={usbProgress}
      usbError={usbError}
      qrMode={qrMode}
      cameraActive={cameraActive}
      cameraError={cameraError}
      urProgress={urProgress}
      qrScanning={qrScanning}
      isSecure={isSecure}
      onConnectUsb={onConnectUsb}
      onFileUpload={onFileUpload}
      onQrModeChange={onQrModeChange}
      onCameraActiveChange={onCameraActiveChange}
      onQrScan={onQrScan}
      onCameraError={onCameraError}
      onStopCamera={onStopCamera}
    />
  </div>
);

const ConnectionActionContent: React.FC<ConnectionActionPanelProps> = ({
  selectedModel,
  method,
  scanned,
  fileScanning,
  formData,
  usbScanning,
  usbProgress,
  usbError,
  qrMode,
  cameraActive,
  cameraError,
  urProgress,
  qrScanning,
  isSecure,
  onConnectUsb,
  onFileUpload,
  onQrModeChange,
  onCameraActiveChange,
  onQrScan,
  onCameraError,
  onStopCamera,
}) => {
  switch (method) {
    case 'usb':
      return (
        <UsbConnectionPanel
          selectedModel={selectedModel}
          scanning={usbScanning}
          scanned={scanned}
          error={usbError}
          usbProgress={usbProgress}
          parsedAccountsCount={formData.parsedAccounts.length}
          fingerprint={formData.fingerprint}
          onConnect={() => onConnectUsb(selectedModel)}
        />
      );
    case 'sd_card':
      return (
        <FileUploadPanel
          selectedModel={selectedModel}
          scanning={fileScanning}
          scanned={scanned}
          onFileUpload={onFileUpload}
        />
      );
    case 'qr_code':
      return (
        <QrScannerPanel
          selectedModel={selectedModel}
          scanned={scanned}
          qrMode={qrMode}
          cameraActive={cameraActive}
          cameraError={cameraError}
          urProgress={urProgress}
          scanning={qrScanning}
          fingerprint={formData.fingerprint}
          isSecure={isSecure}
          onQrModeChange={onQrModeChange}
          onCameraActiveChange={onCameraActiveChange}
          onQrScan={onQrScan}
          onCameraError={onCameraError}
          onFileUpload={onFileUpload}
          onStopCamera={onStopCamera}
        />
      );
    case 'manual':
      return <ManualConnectionWarning />;
  }
};
