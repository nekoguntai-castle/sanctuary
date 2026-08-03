import { AlertCircle, Camera, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { QrScannerFrame } from '../../qr/QrScannerFrame';
import { isSecureContext } from '../../../services/hardwareWallet/environment';
import type { QrScanResult } from './useQrScanHandlers';

export function QrScanHeader() {
  return (
    <>
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        Scan Wallet QR Code
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        Scan the wallet export QR code from your hardware device.
      </p>
    </>
  );
}

export function QrScannerCard({
  cameraActive,
  cameraError,
  qrScanned,
  urProgress,
  onCameraError,
  onQrScan,
  onStartCamera,
  onStopCamera,
}: {
  cameraActive: boolean;
  cameraError: string | null;
  qrScanned: boolean;
  urProgress: number;
  onCameraError: (error: unknown) => void;
  onQrScan: (result: QrScanResult[]) => void;
  onStartCamera: () => void;
  onStopCamera: () => void;
}) {
  if (qrScanned) return null;

  return (
    <div className="surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
      {!cameraActive && !cameraError && <CameraIdlePanel onStartCamera={onStartCamera} />}
      {cameraActive && (
        <ActiveQrScanner
          urProgress={urProgress}
          onCameraError={onCameraError}
          onQrScan={onQrScan}
          onStopCamera={onStopCamera}
        />
      )}
      {cameraError && (
        <CameraErrorPanel
          cameraError={cameraError}
          onStartCamera={onStartCamera}
        />
      )}
    </div>
  );
}

function CameraIdlePanel({
  onStartCamera,
}: {
  onStartCamera: () => void;
}) {
  return (
    <div className="text-center py-8">
      <Camera className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
        Point your camera at the wallet export QR code.
      </p>
      {!isSecureContext() && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 px-4">
          Camera access requires HTTPS. Please use https://localhost:8443
        </p>
      )}
      <Button onClick={onStartCamera}>Start Camera</Button>
    </div>
  );
}

function ActiveQrScanner({
  urProgress,
  onCameraError,
  onQrScan,
  onStopCamera,
}: {
  urProgress: number;
  onCameraError: (error: unknown) => void;
  onQrScan: (result: QrScanResult[]) => void;
  onStopCamera: () => void;
}) {
  return (
    <QrScannerFrame
      maxWidthClassName="max-w-sm"
      stopCameraLabel="Stop camera"
      onQrScan={onQrScan}
      onCameraError={onCameraError}
      onStopCamera={onStopCamera}
    >
      <QrScanProgress urProgress={urProgress} />
    </QrScannerFrame>
  );
}

function QrScanProgress({
  urProgress,
}: {
  urProgress: number;
}) {
  if (urProgress > 0 && urProgress < 100) {
    return <UrProgressOverlay urProgress={urProgress} />;
  }

  if (urProgress === 0) {
    return (
      <p className="text-xs text-center text-sanctuary-500 py-2">
        Position the QR code within the frame
      </p>
    );
  }

  return null;
}

function UrProgressOverlay({
  urProgress,
}: {
  urProgress: number;
}) {
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

function CameraErrorPanel({
  cameraError,
  onStartCamera,
}: {
  cameraError: string;
  onStartCamera: () => void;
}) {
  return (
    <div className="text-center py-8">
      <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
      <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
        {cameraError}
      </p>
      <Button onClick={onStartCamera}>Try Again</Button>
    </div>
  );
}

export function QrSuccessState({
  qrScanned,
}: {
  qrScanned: boolean;
}) {
  if (!qrScanned) return null;

  return (
    <div className="text-center py-6 surface-muted rounded-lg border border-sanctuary-300 dark:border-sanctuary-700">
      <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
        <CheckCircle className="w-10 h-10 mb-2" />
        <p className="font-medium">QR Code Scanned Successfully</p>
        <p className="text-xs text-sanctuary-500 mt-1">Wallet data captured</p>
      </div>
    </div>
  );
}

export function QrValidationError({
  validationError,
}: {
  validationError: string | null;
}) {
  if (!validationError) return null;

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <span className="text-sm">{validationError}</span>
    </div>
  );
}

export function SupportedQrFormats() {
  return (
    <div className="text-xs text-sanctuary-500 surface-secondary p-4 rounded-lg">
      <p className="font-medium mb-2">Supported formats:</p>
      <ul className="list-disc list-inside space-y-1">
        <li>Foundation Passport (animated UR:BYTES QR)</li>
        <li>Coldcard wallet export QR</li>
        <li>Sparrow wallet export QR</li>
        <li>Output descriptor QR codes</li>
      </ul>
    </div>
  );
}
