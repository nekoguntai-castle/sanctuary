/**
 * QrScannerPanel Component
 *
 * QR code scanning UI with camera/file toggle, progress for animated QR codes,
 * and error handling.
 */

import React from 'react';
import { CameraScannerPanel } from './QrScannerPanel/CameraScannerPanel';
import { QrFileUploadPanel } from './QrScannerPanel/QrFileUploadPanel';
import { QrModeToggle } from './QrScannerPanel/QrModeToggle';
import { QrScanSuccess } from './QrScannerPanel/QrScanSuccess';
import { QrScannerPanelProps } from './types';

export const QrScannerPanel: React.FC<QrScannerPanelProps> = ({
  selectedModel,
  scanned,
  qrMode,
  cameraActive,
  cameraError,
  urProgress,
  scanning,
  fingerprint,
  isSecure,
  onQrModeChange,
  onCameraActiveChange,
  onQrScan,
  onCameraError,
  onFileUpload,
  onStopCamera,
}) => {
  return (
    <div className="space-y-3">
      <QrModeToggle qrMode={qrMode} onQrModeChange={onQrModeChange} />

      {qrMode === 'camera' && !scanned && (
        <CameraScannerPanel
          selectedModel={selectedModel}
          cameraActive={cameraActive}
          cameraError={cameraError}
          urProgress={urProgress}
          isSecure={isSecure}
          onCameraActiveChange={onCameraActiveChange}
          onQrScan={onQrScan}
          onCameraError={onCameraError}
          onStopCamera={onStopCamera}
        />
      )}

      {qrMode === 'file' && !scanned && (
        <QrFileUploadPanel scanning={scanning} onFileUpload={onFileUpload} />
      )}

      {scanned && <QrScanSuccess fingerprint={fingerprint} />}
    </div>
  );
};
