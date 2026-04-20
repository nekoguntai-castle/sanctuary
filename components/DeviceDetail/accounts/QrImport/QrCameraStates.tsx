import React from 'react';
import { AlertCircle, Camera } from 'lucide-react';
import { QrScannerFrame } from '../../../qr/QrScannerFrame';
import { isSecureContext } from '../../../../services/hardwareWallet/environment';
import { QrProgressOverlay } from './QrProgressOverlay';

interface CameraIdleStateProps {
  onStartCamera: () => void;
}

interface CameraActiveStateProps {
  urProgress: number;
  onQrScan: (result: { rawValue: string }[]) => void;
  onCameraError: (error: unknown) => void;
  onStopCamera: () => void;
}

interface CameraErrorStateProps {
  cameraError: string;
  onRetry: () => void;
}

export const CameraIdleState: React.FC<CameraIdleStateProps> = ({ onStartCamera }) => (
  <div className="text-center py-6">
    <Camera className="w-10 h-10 mx-auto text-sanctuary-400 mb-3" />
    <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
      Scan QR code from your device
    </p>
    {!isSecureContext() && (
      <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 px-4">
        Camera requires HTTPS
      </p>
    )}
    <button
      onClick={onStartCamera}
      className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
    >
      Start Camera
    </button>
  </div>
);

export const CameraActiveState: React.FC<CameraActiveStateProps> = ({
  urProgress,
  onQrScan,
  onCameraError,
  onStopCamera,
}) => (
  <QrScannerFrame
    maxWidthClassName="max-w-xs"
    stopCameraLabel="Stop camera"
    onQrScan={onQrScan}
    onCameraError={onCameraError}
    onStopCamera={onStopCamera}
  >
    {urProgress > 0 && urProgress < 100 && <QrProgressOverlay progress={urProgress} />}
  </QrScannerFrame>
);

export const CameraErrorState: React.FC<CameraErrorStateProps> = ({
  cameraError,
  onRetry,
}) => (
  <div className="text-center py-6">
    <AlertCircle className="w-10 h-10 mx-auto text-rose-400 mb-3" />
    <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
      {cameraError}
    </p>
    <button
      onClick={onRetry}
      className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
    >
      Try Again
    </button>
  </div>
);
