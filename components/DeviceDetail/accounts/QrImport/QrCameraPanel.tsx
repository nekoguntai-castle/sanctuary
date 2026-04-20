import React from 'react';
import {
  CameraActiveState,
  CameraErrorState,
  CameraIdleState,
} from './QrCameraStates';
import type { QrImportProps } from './types';

type QrCameraPanelProps = Pick<
  QrImportProps,
  | 'cameraActive'
  | 'setCameraActive'
  | 'cameraError'
  | 'setCameraError'
  | 'urProgress'
  | 'setUrProgress'
  | 'onQrScan'
  | 'onCameraError'
  | 'urDecoderRef'
  | 'bytesDecoderRef'
>;

export const QrCameraPanel: React.FC<QrCameraPanelProps> = ({
  cameraActive,
  setCameraActive,
  cameraError,
  setCameraError,
  urProgress,
  setUrProgress,
  onQrScan,
  onCameraError,
  urDecoderRef,
  bytesDecoderRef,
}) => {
  const handleStartCamera = () => {
    setCameraActive(true);
    setCameraError(null);
  };

  const handleStopCamera = () => {
    setCameraActive(false);
    setUrProgress(0);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
  };

  return (
    <div className="surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
      {!cameraActive && !cameraError && (
        <CameraIdleState onStartCamera={handleStartCamera} />
      )}
      {cameraActive && (
        <CameraActiveState
          urProgress={urProgress}
          onQrScan={onQrScan}
          onCameraError={onCameraError}
          onStopCamera={handleStopCamera}
        />
      )}
      {cameraError && (
        <CameraErrorState cameraError={cameraError} onRetry={handleStartCamera} />
      )}
    </div>
  );
};
