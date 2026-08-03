import React from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { X } from 'lucide-react';

interface QrScannerFrameProps {
  children: React.ReactNode;
  maxWidthClassName: string;
  stopCameraLabel: string;
  onCameraError: (error: unknown) => void;
  onQrScan: (result: { rawValue: string }[]) => void;
  onStopCamera: () => void;
}

export const QrScannerFrame: React.FC<QrScannerFrameProps> = ({
  children,
  maxWidthClassName,
  stopCameraLabel,
  onCameraError,
  onQrScan,
  onStopCamera,
}) => (
  <div className="relative">
    <div className={`aspect-square ${maxWidthClassName} mx-auto`}>
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
      aria-label={stopCameraLabel}
      onClick={onStopCamera}
      className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
    >
      <X className="w-4 h-4" />
    </button>
    {children}
  </div>
);
