import React from 'react';
import { QrCameraPanel } from './QrImport/QrCameraPanel';
import { QrFilePanel } from './QrImport/QrFilePanel';
import { QrModeToggle } from './QrImport/QrModeToggle';
import type { QrImportProps } from './QrImport/types';
export type { QrImportProps };

export const QrImport: React.FC<QrImportProps> = ({
  qrMode,
  setQrMode,
  cameraActive,
  setCameraActive,
  cameraError,
  setCameraError,
  urProgress,
  setUrProgress,
  addAccountLoading,
  onQrScan,
  onCameraError,
  onFileUpload,
  urDecoderRef,
  bytesDecoderRef,
}) => {
  const handleCameraMode = () => {
    setQrMode('camera');
    setCameraError(null);
  };

  const handleFileMode = () => {
    setQrMode('file');
    setCameraActive(false);
  };

  return (
    <div className="space-y-3">
      <QrModeToggle
        qrMode={qrMode}
        onCameraMode={handleCameraMode}
        onFileMode={handleFileMode}
      />

      {qrMode === 'camera' && (
        <QrCameraPanel
          cameraActive={cameraActive}
          setCameraActive={setCameraActive}
          cameraError={cameraError}
          setCameraError={setCameraError}
          urProgress={urProgress}
          setUrProgress={setUrProgress}
          onQrScan={onQrScan}
          onCameraError={onCameraError}
          urDecoderRef={urDecoderRef}
          bytesDecoderRef={bytesDecoderRef}
        />
      )}

      {qrMode === 'file' && (
        <QrFilePanel addAccountLoading={addAccountLoading} onFileUpload={onFileUpload} />
      )}
    </div>
  );
};
