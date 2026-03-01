/**
 * QR Scanner Hook
 *
 * Manages state for QR code scanning with support for multiple formats:
 * - UR format (Keystone, Foundation Passport, SeedSigner)
 * - ur:bytes format (Foundation Passport JSON export)
 * - BBQr format (Coldcard Q multi-part)
 * - Plain JSON/text formats
 *
 * Key features:
 * - Multi-part QR code assembly (fountain codes)
 * - Progress tracking for animated QR codes
 * - Camera error handling
 * - File upload as alternative to camera
 */

import { useState, useRef, useCallback } from 'react';
import { URRegistryDecoder } from '@keystonehq/bc-ur-registry';
import { URDecoder as BytesURDecoder } from '@ngraveio/bc-ur';
import { BBQrDecoder, isBBQr } from '../../services/bbqr';
import { parseDeviceJson } from '../../services/deviceParsers';
import { getUrType } from '../../utils/urDeviceDecoder';
import {
  normalizeDerivationPath,
  generateMissingFieldsWarning,
  QrExtractedFields,
} from '../../utils/deviceConnection';
import { createLogger } from '../../utils/logger';
import { QrScanResult, UseQrScannerState, DecoderCallbacks } from './types';
import { processUrBytes, processUrRegistry } from './urDecoder';
import { processBBQr } from './bbqrDecoder';
import { DeviceAccount } from '../../services/deviceParsers';

const log = createLogger('useQrScanner');

/**
 * Hook for managing QR code scanning
 *
 * @example
 * const {
 *   qrMode, setQrMode,
 *   cameraActive, setCameraActive,
 *   urProgress,
 *   scanResult,
 *   error,
 *   handleQrScan,
 *   reset,
 * } = useQrScanner();
 *
 * // In Scanner component
 * <Scanner onScan={handleQrScan} onError={handleCameraError} />
 */
export function useQrScanner(): UseQrScannerState {
  // UI state
  const [qrMode, setQrMode] = useState<'camera' | 'file'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [urProgress, setUrProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<QrScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Decoder refs - managed internally, reset together
  const urDecoderRef = useRef<URRegistryDecoder | null>(null);
  const bytesDecoderRef = useRef<BytesURDecoder | null>(null);
  const bbqrDecoderRef = useRef<BBQrDecoder | null>(null);

  /**
   * Reset all state and decoder refs
   */
  const reset = useCallback(() => {
    setQrMode('camera');
    setCameraActive(false);
    setCameraError(null);
    setUrProgress(0);
    setScanning(false);
    setScanResult(null);
    setError(null);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
    bbqrDecoderRef.current = null;
  }, []);

  /**
   * Stop camera without full reset
   */
  const stopCamera = useCallback(() => {
    setCameraActive(false);
    setUrProgress(0);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
    bbqrDecoderRef.current = null;
  }, []);

  /**
   * Create scan result from extracted data
   */
  const createScanResult = useCallback((
    xpub: string,
    fingerprint: string,
    path: string,
    label?: string,
    accounts?: DeviceAccount[]
  ): QrScanResult => {
    const extractedFields: QrExtractedFields = {
      xpub: true,
      fingerprint: !!fingerprint,
      derivationPath: !!path,
      label: !!label,
    };

    const warning = generateMissingFieldsWarning({
      hasFingerprint: !!fingerprint,
      hasDerivationPath: !!path,
    });

    return {
      xpub,
      fingerprint: fingerprint ? fingerprint.toUpperCase() : '',
      derivationPath: path ? normalizeDerivationPath(path) : '',
      label,
      accounts,
      extractedFields,
      warning,
    };
  }, []);

  /** Callbacks shared with decoder modules */
  const getCallbacks = useCallback((): DecoderCallbacks => ({
    setUrProgress,
    setCameraActive,
    setScanning,
    setError,
    setScanResult,
    createScanResult,
  }), [createScanResult]);

  /**
   * Process plain JSON/text content
   */
  const processPlainContent = useCallback((content: string): boolean => {
    const parseResult = parseDeviceJson(content);
    if (parseResult && parseResult.xpub) {
      setScanResult(createScanResult(
        parseResult.xpub,
        parseResult.fingerprint || '',
        parseResult.derivationPath || '',
        parseResult.label,
        parseResult.accounts
      ));
      log.info('QR code parsed successfully', { format: parseResult.format });
      return true;
    }

    log.debug('No xpub found in non-UR content', { preview: content.substring(0, 200) });
    throw new Error(
      `Could not find xpub in QR code. Content starts with: "${content.substring(0, 30)}..."`
    );
  }, [createScanResult]);

  /**
   * Handle QR scan from camera
   */
  const handleQrScan = useCallback((result: { rawValue: string }[]) => {
    if (!result || result.length === 0) return;

    const content = result[0].rawValue;
    const contentLower = content.toLowerCase();

    log.info('QR code scanned', { length: content.length, prefix: content.substring(0, 50) });

    try {
      // Check if UR format
      if (contentLower.startsWith('ur:')) {
        const urType = getUrType(content) || 'unknown';
        log.debug('UR type detected', { urType });

        const callbacks = getCallbacks();

        // Use BytesURDecoder for ur:bytes
        if (urType === 'bytes') {
          processUrBytes(content, bytesDecoderRef, callbacks);
          return;
        }

        // Use URRegistryDecoder for other types
        processUrRegistry(content, urType, urDecoderRef, callbacks);
        return;
      }

      // Check for BBQr format
      if (isBBQr(content)) {
        processBBQr(content, bbqrDecoderRef, getCallbacks());
        return;
      }

      // Plain content
      setCameraActive(false);
      setScanning(true);
      setError(null);

      processPlainContent(content);
      setScanning(false);

    } catch (err) {
      log.error('Failed to process QR code', { error: err });
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      setCameraActive(false);
      setScanning(false);
      setUrProgress(0);
      urDecoderRef.current = null;
      bytesDecoderRef.current = null;
      bbqrDecoderRef.current = null;
    }
  }, [processPlainContent, getCallbacks]);

  /**
   * Handle camera error
   */
  const handleCameraError = useCallback((error: unknown) => {
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
  }, []);

  /**
   * Handle file content (alternative to camera)
   */
  const handleFileContent = useCallback((content: string) => {
    setScanning(true);
    setError(null);

    try {
      processPlainContent(content);
      setScanning(false);
    } catch (err) {
      log.error('Failed to process file content', { error: err });
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      setScanning(false);
    }
  }, [processPlainContent]);

  // Custom setter for qrMode that also clears camera error
  const setQrModeWithReset = useCallback((mode: 'camera' | 'file') => {
    setQrMode(mode);
    if (mode === 'camera') {
      setCameraError(null);
    } else {
      setCameraActive(false);
    }
  }, []);

  return {
    qrMode,
    setQrMode: setQrModeWithReset,
    cameraActive,
    setCameraActive,
    cameraError,
    urProgress,
    scanning,
    scanResult,
    error,
    handleQrScan,
    handleCameraError,
    handleFileContent,
    reset,
    stopCamera,
  };
}
