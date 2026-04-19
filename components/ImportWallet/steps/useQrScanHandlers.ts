import type React from 'react';
import { createLogger } from '../../../utils/logger';
import type { BytesUrDecoderLike } from '../hooks/useImportState';

const log = createLogger('ImportWallet');

export interface QrScanResult {
  rawValue: string;
}

export function useQrScanHandlers({
  bytesDecoderRef,
  setCameraActive,
  setCameraError,
  setImportData,
  setQrScanned,
  setUrProgress,
  setValidationError,
}: {
  bytesDecoderRef: React.MutableRefObject<BytesUrDecoderLike | null>;
  setCameraActive: (active: boolean) => void;
  setCameraError: (error: string | null) => void;
  setImportData: (data: string) => void;
  setQrScanned: (scanned: boolean) => void;
  setUrProgress: (progress: number) => void;
  setValidationError: (error: string | null) => void;
}) {
  const startCamera = () => {
    setCameraActive(true);
    setCameraError(null);
  };

  const stopCamera = () => {
    setCameraActive(false);
    setUrProgress(0);
    bytesDecoderRef.current = null;
  };

  const handleCameraError = (error: unknown) => {
    log.error('Camera error', { error });
    setCameraActive(false);
    setCameraError(cameraErrorMessage(error));
  };

  const handleQrScan = async (result: QrScanResult[]) => {
    const content = getFirstQrContent(result);
    if (!content) return;

    log.info('QR code scanned', { length: content.length, prefix: content.substring(0, 50) });

    if (isUrContent(content)) {
      await handleUrQrContent({
        bytesDecoderRef,
        content,
        setCameraActive,
        setImportData,
        setQrScanned,
        setUrProgress,
        setValidationError,
      });
      return;
    }

    handlePlainQrContent({
      content,
      setCameraActive,
      setImportData,
      setQrScanned,
      setValidationError,
    });
  };

  return {
    handleCameraError,
    handleQrScan,
    startCamera,
    stopCamera,
  };
}

function getFirstQrContent(result: QrScanResult[]): string | null {
  if (!result || result.length === 0) return null;
  return result[0].rawValue;
}

function isUrContent(content: string): boolean {
  return content.toLowerCase().startsWith('ur:');
}

async function handleUrQrContent({
  bytesDecoderRef,
  content,
  setCameraActive,
  setImportData,
  setQrScanned,
  setUrProgress,
  setValidationError,
}: {
  bytesDecoderRef: React.MutableRefObject<BytesUrDecoderLike | null>;
  content: string;
  setCameraActive: (active: boolean) => void;
  setImportData: (data: string) => void;
  setQrScanned: (scanned: boolean) => void;
  setUrProgress: (progress: number) => void;
  setValidationError: (error: string | null) => void;
}) {
  const urType = getUrType(content);

  try {
    if (urType === 'bytes') {
      await decodeBytesUr({
        bytesDecoderRef,
        content,
        setCameraActive,
        setImportData,
        setQrScanned,
        setUrProgress,
      });
      return;
    }

    setValidationError(`Unsupported UR type: ${urType}. Please export as JSON or output descriptor.`);
  } catch (error) {
    log.error('UR decode error', { error });
    setValidationError(error instanceof Error ? error.message : 'Failed to decode QR code');
    setCameraActive(false);
    bytesDecoderRef.current = null;
  }
}

async function decodeBytesUr({
  bytesDecoderRef,
  content,
  setCameraActive,
  setImportData,
  setQrScanned,
  setUrProgress,
}: {
  bytesDecoderRef: React.MutableRefObject<BytesUrDecoderLike | null>;
  content: string;
  setCameraActive: (active: boolean) => void;
  setImportData: (data: string) => void;
  setQrScanned: (scanned: boolean) => void;
  setUrProgress: (progress: number) => void;
}) {
  if (!bytesDecoderRef.current) {
    const { URDecoder } = await import('@ngraveio/bc-ur');
    bytesDecoderRef.current = new URDecoder() as BytesUrDecoderLike;
  }

  bytesDecoderRef.current.receivePart(content);
  setUrProgress(Math.round(bytesDecoderRef.current.estimatedPercentComplete() * 100));

  if (!bytesDecoderRef.current.isComplete()) {
    return;
  }

  setCameraActive(false);

  if (!bytesDecoderRef.current.isSuccess()) {
    throw new Error(`UR decode failed: ${bytesDecoderRef.current.resultError() || 'unknown error'}`);
  }

  const decodedUR = bytesDecoderRef.current.resultUR();
  const rawBytes = decodedUR.decodeCBOR();
  const textContent = new TextDecoder('utf-8').decode(rawBytes);

  setImportData(textContent);
  setQrScanned(true);
  setUrProgress(0);
  bytesDecoderRef.current = null;
}

function handlePlainQrContent({
  content,
  setCameraActive,
  setImportData,
  setQrScanned,
  setValidationError,
}: {
  content: string;
  setCameraActive: (active: boolean) => void;
  setImportData: (data: string) => void;
  setQrScanned: (scanned: boolean) => void;
  setValidationError: (error: string | null) => void;
}) {
  setCameraActive(false);

  if (isJsonContent(content)) {
    handleJsonQrContent({ content, setImportData, setQrScanned, setValidationError });
    return;
  }

  if (isDescriptorContent(content)) {
    setImportData(content);
    setQrScanned(true);
    return;
  }

  setValidationError('QR code format not recognized. Please use a wallet export QR code.');
}

function handleJsonQrContent({
  content,
  setImportData,
  setQrScanned,
  setValidationError,
}: {
  content: string;
  setImportData: (data: string) => void;
  setQrScanned: (scanned: boolean) => void;
  setValidationError: (error: string | null) => void;
}) {
  try {
    JSON.parse(content);
    setImportData(content);
    setQrScanned(true);
  } catch {
    setValidationError('Invalid JSON in QR code');
  }
}

function getUrType(content: string): string {
  const urTypeMatch = content.toLowerCase().match(/^ur:([a-z0-9-]+)/);
  return urTypeMatch ? urTypeMatch[1] : 'unknown';
}

function isJsonContent(content: string): boolean {
  return content.trim().startsWith('{');
}

function isDescriptorContent(content: string): boolean {
  const descriptorPrefixes = ['wpkh(', 'wsh(', 'sh(', 'pkh(', 'tr('];
  return descriptorPrefixes.some((prefix) => content.toLowerCase().startsWith(prefix));
}

function cameraErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to access camera. Make sure you are using HTTPS.';
  }

  if (error.name === 'NotAllowedError') {
    return 'Camera access denied. Please allow camera permissions and try again.';
  }

  if (error.name === 'NotFoundError') {
    return 'No camera found on this device.';
  }

  return `Camera error: ${error.message}`;
}
