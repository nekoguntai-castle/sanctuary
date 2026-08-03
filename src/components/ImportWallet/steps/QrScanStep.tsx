import React from 'react';
import {
  QrScanHeader,
  QrScannerCard,
  QrSuccessState,
  QrValidationError,
  SupportedQrFormats,
} from './QrScanSections';
import type { BytesUrDecoderLike } from '../hooks/useImportState';
import { useQrScanHandlers } from './useQrScanHandlers';

interface QrScanStepProps {
  cameraActive: boolean;
  setCameraActive: (active: boolean) => void;
  cameraError: string | null;
  setCameraError: (error: string | null) => void;
  urProgress: number;
  setUrProgress: (progress: number) => void;
  qrScanned: boolean;
  setQrScanned: (scanned: boolean) => void;
  setImportData: (data: string) => void;
  validationError: string | null;
  setValidationError: (error: string | null) => void;
  bytesDecoderRef: React.MutableRefObject<BytesUrDecoderLike | null>;
}

export const QrScanStep: React.FC<QrScanStepProps> = ({
  cameraActive,
  setCameraActive,
  cameraError,
  setCameraError,
  urProgress,
  setUrProgress,
  qrScanned,
  setQrScanned,
  setImportData,
  validationError,
  setValidationError,
  bytesDecoderRef,
}) => {
  const {
    handleCameraError,
    handleQrScan,
    startCamera,
    stopCamera,
  } = useQrScanHandlers({
    bytesDecoderRef,
    setCameraActive,
    setCameraError,
    setImportData,
    setQrScanned,
    setUrProgress,
    setValidationError,
  });

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <QrScanHeader />

      <div className="space-y-4">
        <QrScannerCard
          cameraActive={cameraActive}
          cameraError={cameraError}
          qrScanned={qrScanned}
          urProgress={urProgress}
          onCameraError={handleCameraError}
          onQrScan={handleQrScan}
          onStartCamera={startCamera}
          onStopCamera={stopCamera}
        />
        <QrSuccessState qrScanned={qrScanned} />
        <QrValidationError validationError={validationError} />
        <SupportedQrFormats />
      </div>
    </div>
  );
};
