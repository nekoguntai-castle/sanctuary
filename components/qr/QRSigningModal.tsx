/**
 * QRSigningModal Component
 *
 * Two-step modal for QR code-based PSBT signing:
 * 1. Display unsigned PSBT as animated QR for hardware wallet to scan
 * 2. Scan signed PSBT QR from hardware wallet
 */

import React, { useState, useRef, useCallback } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import {
  X,
  QrCode,
  Camera,
  ArrowRight,
  ArrowLeft,
  Upload,
  Loader2,
  Check,
  AlertCircle,
} from 'lucide-react';
import { AnimatedQRCode } from './AnimatedQRCode';
import {
  createPsbtDecoder,
  feedDecoderPart,
  getDecodedPsbt,
  isUrFormat,
} from '../../utils/urPsbt';
import { createLogger } from '../../utils/logger';

const log = createLogger('QRSigningModal');

type Step = 'display' | 'scan';

interface QRSigningModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Base64-encoded unsigned PSBT */
  psbtBase64: string;
  /** Device label for display */
  deviceLabel: string;
  /** Callback when signed PSBT is received */
  onSignedPsbt: (signedPsbt: string) => void;
}

export const QRSigningModal: React.FC<QRSigningModalProps> = ({
  isOpen,
  onClose,
  psbtBase64,
  deviceLabel,
  onSignedPsbt,
}) => {
  const [step, setStep] = useState<Step>('display');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const decoderRef = useRef<ReturnType<typeof createPsbtDecoder> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetScanner = useCallback(() => {
    decoderRef.current = null;
    setScanProgress(0);
    setScanError(null);
    setCameraError(null);
    setProcessing(false);
  }, []);

  const handleClose = useCallback(() => {
    resetScanner();
    setStep('display');
    onClose();
  }, [onClose, resetScanner]);

  const handleQrScan = useCallback((results: { rawValue: string }[]) => {
    if (!results || results.length === 0 || processing) return;

    const content = results[0].rawValue;
    log.debug('QR scanned', {
      preview: content.substring(0, 100),
      length: content.length,
      startsWithUr: content.toLowerCase().startsWith('ur:'),
    });

    // Initialize decoder if needed
    if (!decoderRef.current) {
      decoderRef.current = createPsbtDecoder();
    }

    // Check if UR format
    if (!isUrFormat(content)) {
      // Try to parse as raw base64 PSBT
      try {
        // Check if it's valid base64
        const decoded = atob(content);
        if (decoded.startsWith('psbt')) {
          // Valid PSBT
          setProcessing(true);
          log.info('Received raw base64 PSBT');
          onSignedPsbt(content);
          handleClose();
          return;
        }
        log.warn('Base64 decoded but not a PSBT', { firstChars: decoded.substring(0, 10) });
      } catch (e) {
        log.warn('Not valid base64', { error: e });
      }
      log.error('Invalid QR format scanned', {
        preview: content.substring(0, 100),
        length: content.length,
      });
      setScanError(`Invalid QR code format. Expected UR (ur:crypto-psbt) or base64 PSBT. Got: ${content.substring(0, 30)}...`);
      return;
    }

    // Feed to UR decoder
    const result = feedDecoderPart(decoderRef.current, content);

    if (result.error) {
      setScanError(result.error);
      return;
    }

    setScanProgress(result.progress);

    if (result.complete) {
      setProcessing(true);
      try {
        const signedPsbt = getDecodedPsbt(decoderRef.current);
        log.info('Successfully decoded signed PSBT');
        onSignedPsbt(signedPsbt);
        handleClose();
      } catch (error) {
        log.error('Failed to decode PSBT', { error });
        setScanError(error instanceof Error ? error.message : 'Failed to decode PSBT');
        setProcessing(false);
      }
    }
  }, [processing, onSignedPsbt, handleClose]);

  const handleCameraError = useCallback((error: unknown) => {
    log.error('Camera error', { error });
    const message = error instanceof Error ? error.message : 'Camera access denied';
    setCameraError(message);
  }, []);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // First try reading as binary (for Coldcard and other devices that output binary PSBTs)
    const binaryReader = new FileReader();
    binaryReader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);

      // Check for PSBT magic bytes: "psbt" + 0xff
      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (magic === 'psbt' && bytes[4] === 0xff) {
        // Valid binary PSBT - convert to base64
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        log.info('Loaded binary PSBT from file', { size: bytes.length });
        onSignedPsbt(base64);
        handleClose();
        return;
      }

      // Not binary PSBT, try reading as text
      const textReader = new FileReader();
      textReader.onload = (textEvent) => {
        const content = (textEvent.target?.result as string).trim();

        try {
          // Check if file contains base64 data
          const base64Match = content.match(/^[A-Za-z0-9+/=\s]+$/);
          if (base64Match) {
            const cleanBase64 = content.replace(/\s/g, '');
            const decoded = atob(cleanBase64);
            if (decoded.startsWith('psbt')) {
              log.info('Loaded base64 PSBT from file');
              onSignedPsbt(cleanBase64);
              handleClose();
              return;
            }
          }

          // Try hex format
          const hexMatch = content.match(/^[0-9a-fA-F\s]+$/);
          if (hexMatch) {
            const cleanHex = content.replace(/\s/g, '');
            const hexBytes = new Uint8Array(cleanHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            let binary = '';
            for (let i = 0; i < hexBytes.length; i++) {
              binary += String.fromCharCode(hexBytes[i]);
            }
            const base64 = btoa(binary);
            log.info('Converted hex PSBT to base64');
            onSignedPsbt(base64);
            handleClose();
            return;
          }

          setScanError('Invalid PSBT file format. Expected binary PSBT, base64, or hex.');
        } catch (error) {
          log.error('Failed to parse PSBT file', { error });
          setScanError('Failed to parse PSBT file');
        }
      };

      textReader.onerror = () => {
        setScanError('Failed to read file as text');
      };

      textReader.readAsText(file);
    };

    binaryReader.onerror = () => {
      setScanError('Failed to read file');
    };

    binaryReader.readAsArrayBuffer(file);
    event.target.value = '';
  }, [onSignedPsbt, handleClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-sanctuary-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sanctuary-200 dark:border-sanctuary-700">
          <div className="flex items-center">
            <QrCode className="w-5 h-5 text-primary-500 mr-2" />
            <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-white">
              QR Signing - {deviceLabel}
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
          >
            <X className="w-5 h-5 text-sanctuary-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'display' && (
            <div className="flex flex-col items-center">
              {/* Step indicator */}
              <div className="flex items-center text-sm text-sanctuary-500 mb-4">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-500 text-white mr-2">
                  1
                </span>
                <span className="font-medium">Show to device</span>
                <ArrowRight className="w-4 h-4 mx-3 text-sanctuary-300" />
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 mr-2">
                  2
                </span>
                <span className="text-sanctuary-400">Scan signed</span>
              </div>

              {/* Instructions */}
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 text-center mb-4">
                Scan this QR code with your {deviceLabel} to receive the transaction for signing.
              </p>

              {/* Animated QR */}
              <AnimatedQRCode
                psbtBase64={psbtBase64}
                size={260}
                frameInterval={200}
              />

              {/* Continue button */}
              <button
                onClick={() => {
                  resetScanner();
                  setStep('scan');
                }}
                className="mt-6 w-full flex items-center justify-center px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-medium transition-colors"
              >
                <Check className="w-4 h-4 mr-2" />
                I've Signed It
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            </div>
          )}

          {step === 'scan' && (
            <div className="flex flex-col items-center">
              {/* Step indicator */}
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

              {/* Instructions */}
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 text-center mb-4">
                After signing on your {deviceLabel}, scan the signed PSBT QR code displayed on the device.
              </p>

              {/* Camera scanner */}
              {!cameraError ? (
                <div className="relative w-full aspect-square max-w-[300px] rounded-xl overflow-hidden bg-black">
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

                  {/* Progress overlay */}
                  {scanProgress > 0 && scanProgress < 100 && (
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
                  )}

                </div>
              ) : (
                <div className="w-full py-8 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
                  <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
                    {cameraError}
                  </p>
                  <button
                    onClick={() => setCameraError(null)}
                    className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {/* Error message */}
              {scanError && (
                <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg">
                  <p className="text-sm text-rose-600 dark:text-rose-400 text-center">
                    {scanError}
                  </p>
                </div>
              )}

              {/* File upload fallback */}
              <div className="mt-4 w-full">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".psbt,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center px-4 py-2 border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-700/50 transition-colors"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload PSBT File Instead
                </button>
              </div>

              {/* Back button */}
              <button
                onClick={() => {
                  resetScanner();
                  setStep('display');
                }}
                className="mt-4 flex items-center text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to QR Code
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QRSigningModal;
