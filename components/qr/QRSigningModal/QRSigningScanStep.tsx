import type React from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Upload } from 'lucide-react';
import type { QrScanResult } from './types';

type QRSigningScanStepProps = {
  deviceLabel: string;
  scanProgress: number;
  scanError: string | null;
  cameraError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onScan: (results: QrScanResult[]) => void;
  onCameraError: (error: unknown) => void;
  onRetryCamera: () => void;
  onFileUpload: React.ChangeEventHandler<HTMLInputElement>;
  onUploadClick: () => void;
  onBack: () => void;
};

export function QRSigningScanStep({
  deviceLabel,
  scanProgress,
  scanError,
  cameraError,
  fileInputRef,
  onScan,
  onCameraError,
  onRetryCamera,
  onFileUpload,
  onUploadClick,
  onBack,
}: QRSigningScanStepProps) {
  return (
    <div className="flex flex-col items-center">
      <ScanStepIndicator />
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 text-center mb-4">
        After signing on your {deviceLabel}, scan the signed PSBT QR code displayed on the device.
      </p>
      <ScannerPanel
        cameraError={cameraError}
        scanProgress={scanProgress}
        onScan={onScan}
        onCameraError={onCameraError}
        onRetryCamera={onRetryCamera}
      />
      <ScanErrorMessage scanError={scanError} />
      <FileUploadFallback
        fileInputRef={fileInputRef}
        onFileUpload={onFileUpload}
        onUploadClick={onUploadClick}
      />
      <button
        onClick={onBack}
        className="mt-4 flex items-center text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to QR Code
      </button>
    </div>
  );
}

function ScanStepIndicator() {
  return (
    <div className="flex items-center text-sm text-sanctuary-500 mb-4">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white mr-2">
        <Check className="w-3 h-3" />
      </span>
      <span className="text-sanctuary-400">Shown to device</span>
      <ArrowRight className="w-4 h-4 mx-3 text-sanctuary-300" />
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-500 text-white mr-2">
        2
      </span>
      <span className="font-medium">Scan signed</span>
    </div>
  );
}

type ScannerPanelProps = {
  cameraError: string | null;
  scanProgress: number;
  onScan: (results: QrScanResult[]) => void;
  onCameraError: (error: unknown) => void;
  onRetryCamera: () => void;
};

function ScannerPanel({
  cameraError,
  scanProgress,
  onScan,
  onCameraError,
  onRetryCamera,
}: ScannerPanelProps) {
  if (cameraError) {
    return <CameraErrorPanel cameraError={cameraError} onRetryCamera={onRetryCamera} />;
  }

  return (
    <div className="relative w-full aspect-square max-w-[300px] rounded-lg overflow-hidden bg-black">
      <Scanner
        onScan={onScan}
        onError={onCameraError}
        constraints={{ facingMode: 'environment' }}
        scanDelay={100}
        styles={{
          container: { width: '100%', height: '100%' },
          video: { width: '100%', height: '100%', objectFit: 'cover' },
        }}
      />
      <ScanProgressOverlay scanProgress={scanProgress} />
    </div>
  );
}

function ScanProgressOverlay({ scanProgress }: { scanProgress: number }) {
  if (scanProgress <= 0 || scanProgress >= 100) {
    return null;
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-3">
      <div className="flex items-center justify-between text-white mb-2">
        <span className="flex items-center text-sm font-medium">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Scanning...
        </span>
        <span className="text-lg font-bold">{scanProgress}%</span>
      </div>
      <div className="w-full bg-white/20 rounded-full h-2">
        <div
          className="bg-green-400 h-2 rounded-full transition-all duration-300"
          style={{ width: `${scanProgress}%` }}
        />
      </div>
    </div>
  );
}

function CameraErrorPanel({
  cameraError,
  onRetryCamera,
}: {
  cameraError: string;
  onRetryCamera: () => void;
}) {
  return (
    <div className="w-full py-8 text-center">
      <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
      <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
        {cameraError}
      </p>
      <button
        onClick={onRetryCamera}
        className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium"
      >
        Try Again
      </button>
    </div>
  );
}

function ScanErrorMessage({ scanError }: { scanError: string | null }) {
  if (!scanError) {
    return null;
  }

  return (
    <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg">
      <p className="text-sm text-rose-600 dark:text-rose-400 text-center">
        {scanError}
      </p>
    </div>
  );
}

type FileUploadFallbackProps = {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileUpload: React.ChangeEventHandler<HTMLInputElement>;
  onUploadClick: () => void;
};

function FileUploadFallback({
  fileInputRef,
  onFileUpload,
  onUploadClick,
}: FileUploadFallbackProps) {
  return (
    <div className="mt-4 w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".psbt,.txt"
        onChange={onFileUpload}
        className="hidden"
      />
      <button
        onClick={onUploadClick}
        className="w-full flex items-center justify-center px-4 py-2 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-700/50 transition-colors"
      >
        <Upload className="w-4 h-4 mr-2" />
        Upload PSBT File Instead
      </button>
    </div>
  );
}
