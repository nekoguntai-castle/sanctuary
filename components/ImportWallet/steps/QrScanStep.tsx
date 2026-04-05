import React from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Camera,
  X,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import { isSecureContext } from '../../../services/hardwareWallet/environment';
import { createLogger } from '../../../utils/logger';
import type { BytesUrDecoderLike } from '../hooks/useImportState';

const log = createLogger('ImportWallet');

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
  // Handle camera error
  const handleCameraError = (error: unknown) => {
    log.error('Camera error', { error });
    setCameraActive(false);
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Please allow camera permissions and try again.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError(`Camera error: ${error.message}`);
      }
    } else {
      setCameraError('Failed to access camera. Make sure you are using HTTPS.');
    }
  };

  // Handle QR code scan - parse wallet data from various formats
  const handleQrScan = async (result: { rawValue: string }[]) => {
    if (!result || result.length === 0) return;

    const content = result[0].rawValue;
    const contentLower = content.toLowerCase();

    log.info('QR code scanned', { length: content.length, prefix: content.substring(0, 50) });

    // Check if this is UR format (Foundation Passport, Keystone, etc.)
    if (contentLower.startsWith('ur:')) {
      const urTypeMatch = contentLower.match(/^ur:([a-z0-9-]+)/);
      const urType = urTypeMatch ? urTypeMatch[1] : 'unknown';

      try {
        // Use BytesURDecoder for ur:bytes (Foundation Passport format)
        if (urType === 'bytes') {
          if (!bytesDecoderRef.current) {
            const { URDecoder } = await import('@ngraveio/bc-ur');
            bytesDecoderRef.current = new URDecoder() as BytesUrDecoderLike;
          }

          bytesDecoderRef.current.receivePart(content);

          // Check progress for multi-part QR codes
          const progress = bytesDecoderRef.current.estimatedPercentComplete();
          const progressPercent = Math.round(progress * 100);
          setUrProgress(progressPercent);

          const isComplete = bytesDecoderRef.current.isComplete() === true;

          if (!isComplete) {
            return; // Wait for more parts
          }

          // Decode is complete
          setCameraActive(false);

          if (!bytesDecoderRef.current.isSuccess()) {
            const errResult = bytesDecoderRef.current.resultError();
            throw new Error(`UR decode failed: ${errResult || 'unknown error'}`);
          }

          // Get the decoded UR and extract bytes
          const decodedUR = bytesDecoderRef.current.resultUR();
          const rawBytes = decodedUR.decodeCBOR();

          // Try to decode as UTF-8 text (Passport exports JSON)
          const textDecoder = new TextDecoder('utf-8');
          const textContent = textDecoder.decode(rawBytes);

          // Set the import data as JSON for validation
          setImportData(textContent);
          setQrScanned(true);
          setUrProgress(0);
          bytesDecoderRef.current = null;
          return;
        }

        // For other UR types, try direct decode
        setValidationError(`Unsupported UR type: ${urType}. Please export as JSON or output descriptor.`);
        return;
      } catch (err) {
        log.error('UR decode error', { error: err });
        setValidationError(err instanceof Error ? err.message : 'Failed to decode QR code');
        setCameraActive(false);
        bytesDecoderRef.current = null;
        return;
      }
    }

    // Not UR format - try to parse directly as JSON or descriptor
    setCameraActive(false);

    // Check if it's JSON
    if (content.trim().startsWith('{')) {
      try {
        JSON.parse(content); // Validate JSON
        setImportData(content);
        setQrScanned(true);
        return;
      } catch {
        setValidationError('Invalid JSON in QR code');
        return;
      }
    }

    // Check if it's an output descriptor
    const descriptorPrefixes = ['wpkh(', 'wsh(', 'sh(', 'pkh(', 'tr('];
    if (descriptorPrefixes.some(p => content.toLowerCase().startsWith(p))) {
      setImportData(content);
      setQrScanned(true);
      return;
    }

    // Unknown format
    setValidationError('QR code format not recognized. Please use a wallet export QR code.');
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        Scan Wallet QR Code
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        Scan the wallet export QR code from your hardware device.
      </p>

      <div className="space-y-4">
        {/* Camera Scanner */}
        {!qrScanned && (
          <div className="surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
            {!cameraActive && !cameraError && (
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
                <Button onClick={() => { setCameraActive(true); setCameraError(null); }}>
                  Start Camera
                </Button>
              </div>
            )}
            {cameraActive && (
              <div className="relative">
                <div className="aspect-square max-w-sm mx-auto">
                  <Scanner
                    onScan={handleQrScan}
                    onError={handleCameraError}
                    constraints={{ facingMode: 'environment' }}
                    scanDelay={100}
                    styles={{
                      container: { width: '100%', height: '100%' },
                      video: { width: '100%', height: '100%', objectFit: 'cover' },
                    }}
                  />
                </div>
                <button
                  onClick={() => { setCameraActive(false); setUrProgress(0); bytesDecoderRef.current = null; }}
                  className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
                >
                  <X className="w-4 h-4" />
                </button>
                {/* Progress overlay for animated QR codes */}
                {urProgress > 0 && urProgress < 100 && (
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
                )}
                {urProgress === 0 && (
                  <p className="text-xs text-center text-sanctuary-500 py-2">
                    Position the QR code within the frame
                  </p>
                )}
              </div>
            )}
            {cameraError && (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
                <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
                  {cameraError}
                </p>
                <Button onClick={() => { setCameraActive(true); setCameraError(null); }}>
                  Try Again
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Success state */}
        {qrScanned && (
          <div className="text-center py-6 surface-muted rounded-lg border border-sanctuary-300 dark:border-sanctuary-700">
            <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-10 h-10 mb-2" />
              <p className="font-medium">QR Code Scanned Successfully</p>
              <p className="text-xs text-sanctuary-500 mt-1">Wallet data captured</p>
            </div>
          </div>
        )}

        {validationError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{validationError}</span>
          </div>
        )}

        <div className="text-xs text-sanctuary-500 surface-secondary p-4 rounded-lg">
          <p className="font-medium mb-2">Supported formats:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Foundation Passport (animated UR:BYTES QR)</li>
            <li>Coldcard wallet export QR</li>
            <li>Sparrow wallet export QR</li>
            <li>Output descriptor QR codes</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
