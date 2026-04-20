import { Scanner } from '@yudiel/react-qr-scanner';
import { AlertCircle, Camera, Loader2, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { QrScannerPanelProps } from '../types';

type CameraScannerPanelProps = Pick<
  QrScannerPanelProps,
  | 'selectedModel'
  | 'cameraActive'
  | 'cameraError'
  | 'urProgress'
  | 'isSecure'
  | 'onCameraActiveChange'
  | 'onQrScan'
  | 'onCameraError'
  | 'onStopCamera'
>;

export function CameraScannerPanel({
  selectedModel,
  cameraActive,
  cameraError,
  urProgress,
  isSecure,
  onCameraActiveChange,
  onQrScan,
  onCameraError,
  onStopCamera,
}: CameraScannerPanelProps) {
  return (
    <div className="surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
      {!cameraActive && !cameraError && (
        <CameraIdleState
          selectedModel={selectedModel}
          isSecure={isSecure}
          onCameraActiveChange={onCameraActiveChange}
        />
      )}

      {cameraActive && (
        <ActiveCameraState
          urProgress={urProgress}
          onQrScan={onQrScan}
          onCameraError={onCameraError}
          onStopCamera={onStopCamera}
        />
      )}

      {cameraError && (
        <CameraErrorState
          cameraError={cameraError}
          onCameraActiveChange={onCameraActiveChange}
        />
      )}
    </div>
  );
}

function CameraIdleState({
  selectedModel,
  isSecure,
  onCameraActiveChange,
}: Pick<QrScannerPanelProps, 'selectedModel' | 'isSecure' | 'onCameraActiveChange'>) {
  return (
    <div className="text-center py-8">
      <Camera className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
        Point your camera at the QR code on your {selectedModel.name}.
      </p>
      {!isSecure && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 px-4">
          Camera access requires HTTPS. Please use https://localhost:8443
        </p>
      )}
      <Button onClick={() => onCameraActiveChange(true)}>Start Camera</Button>
    </div>
  );
}

function ActiveCameraState({
  urProgress,
  onQrScan,
  onCameraError,
  onStopCamera,
}: Pick<QrScannerPanelProps, 'urProgress' | 'onQrScan' | 'onCameraError' | 'onStopCamera'>) {
  return (
    <div className="relative">
      <div className="aspect-square max-w-sm mx-auto">
        <Scanner
          onScan={onQrScan}
          onError={onCameraError}
          constraints={{ facingMode: 'environment' }}
          scanDelay={100}
          styles={{
            container: { width: '100%', height: '100%' },
            video: { width: '100%', height: '100%', objectFit: 'cover' },
          }}
        />
      </div>
      <button
        onClick={onStopCamera}
        className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
      >
        <X className="w-4 h-4" />
      </button>

      {urProgress > 0 && urProgress < 100 && <AnimatedQrProgress urProgress={urProgress} />}
      {urProgress === 0 && <PositioningHint />}
    </div>
  );
}

function AnimatedQrProgress({ urProgress }: Pick<QrScannerPanelProps, 'urProgress'>) {
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-3 z-10">
      <div className="flex items-center justify-between text-white mb-2">
        <span className="flex items-center text-sm font-medium">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Scanning animated QR...
        </span>
        <span className="text-lg font-bold">{urProgress}%</span>
      </div>
      <div className="w-full bg-white/20 rounded-full h-2">
        <div
          className="bg-green-400 h-2 rounded-full transition-all duration-300"
          style={{ width: `${urProgress}%` }}
        />
      </div>
      <p className="text-xs text-center text-white/70 mt-2">
        Keep camera pointed at animated QR code
      </p>
    </div>
  );
}

function PositioningHint() {
  return (
    <p className="text-xs text-center text-sanctuary-500 py-2">
      Position the QR code within the frame
    </p>
  );
}

function CameraErrorState({
  cameraError,
  onCameraActiveChange,
}: Pick<QrScannerPanelProps, 'cameraError' | 'onCameraActiveChange'>) {
  return (
    <div className="text-center py-8">
      <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
      <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
        {cameraError}
      </p>
      <Button onClick={() => onCameraActiveChange(true)}>Try Again</Button>
    </div>
  );
}
