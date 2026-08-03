import type { ChangeEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import {
  createPsbtDecoder,
  feedDecoderPart,
  getDecodedPsbt,
  isUrFormat,
} from '../../../utils/urPsbt';
import { createLogger } from '../../../utils/logger';
import {
  invalidQrFormatMessage,
  getFirstScanContent,
  parseRawBase64PsbtScan,
} from './qrScanModel';
import {
  isInvalidPsbtFileFormatError,
  readSignedPsbtFile,
} from './psbtFileImport';
import type { QrScanResult, QRSigningStep, SignedPsbtImport } from './types';

const log = createLogger('QRSigningModal');

type ControllerOptions = {
  onClose: () => void;
  onSignedPsbt: (signedPsbt: string) => void;
};

/**
 * Orchestrates QR signing: display the unsigned PSBT to the hardware wallet,
 * then accept the signed PSBT back through UR QR scans, raw base64 QR scans,
 * or binary/base64/hex file upload fallback.
 */
export function useQRSigningModalController({ onClose, onSignedPsbt }: ControllerOptions) {
  const [step, setStep] = useState<QRSigningStep>('display');
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

  const showScanStep = useCallback(() => {
    resetScanner();
    setStep('scan');
  }, [resetScanner]);

  const showDisplayStep = useCallback(() => {
    resetScanner();
    setStep('display');
  }, [resetScanner]);

  const handleQrScan = useCallback((results: QrScanResult[]) => {
    const content = getFirstScanContent(results, processing);
    if (!content) return;

    log.debug('QR scanned', {
      preview: content.substring(0, 100),
      length: content.length,
      startsWithUr: content.toLowerCase().startsWith('ur:'),
    });

    if (!decoderRef.current) {
      decoderRef.current = createPsbtDecoder();
    }

    if (!isUrFormat(content)) {
      handleRawPsbtScan({
        content,
        onSignedPsbt,
        handleClose,
        setProcessing,
        setScanError,
      });
      return;
    }

    handleUrPsbtScan({
      decoder: decoderRef.current,
      content,
      onSignedPsbt,
      handleClose,
      setProcessing,
      setScanProgress,
      setScanError,
    });
  }, [handleClose, onSignedPsbt, processing]);

  const handleCameraError = useCallback((error: unknown) => {
    log.error('Camera error', { error });
    setCameraError(error instanceof Error ? error.message : 'Camera access denied');
  }, []);

  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    void importSignedPsbtFile({
      file,
      onSignedPsbt,
      handleClose,
      setScanError,
    });
    event.target.value = '';
  }, [handleClose, onSignedPsbt]);

  return {
    step,
    scanProgress,
    scanError,
    cameraError,
    fileInputRef,
    handleClose,
    handleQrScan,
    handleCameraError,
    handleFileUpload,
    showScanStep,
    showDisplayStep,
    retryCamera: () => setCameraError(null),
    openFilePicker: () => fileInputRef.current?.click(),
  };
}

type RawPsbtScanHandlers = {
  content: string;
  onSignedPsbt: (signedPsbt: string) => void;
  handleClose: () => void;
  setProcessing: (processing: boolean) => void;
  setScanError: (error: string) => void;
};

function handleRawPsbtScan({
  content,
  onSignedPsbt,
  handleClose,
  setProcessing,
  setScanError,
}: RawPsbtScanHandlers) {
  const result = parseRawBase64PsbtScan(content);

  if (result.kind === 'psbt') {
    setProcessing(true);
    log.info('Received raw base64 PSBT');
    onSignedPsbt(result.base64);
    handleClose();
    return;
  }

  if (result.kind === 'decoded-non-psbt') {
    log.warn('Base64 decoded but not a PSBT', { firstChars: result.preview });
  } else {
    log.warn('Not valid base64', { error: result.error });
  }

  log.error('Invalid QR format scanned', {
    preview: content.substring(0, 100),
    length: content.length,
  });
  setScanError(invalidQrFormatMessage(content));
}

type UrPsbtScanHandlers = {
  decoder: ReturnType<typeof createPsbtDecoder>;
  content: string;
  onSignedPsbt: (signedPsbt: string) => void;
  handleClose: () => void;
  setProcessing: (processing: boolean) => void;
  setScanProgress: (progress: number) => void;
  setScanError: (error: string) => void;
};

function handleUrPsbtScan({
  decoder,
  content,
  onSignedPsbt,
  handleClose,
  setProcessing,
  setScanProgress,
  setScanError,
}: UrPsbtScanHandlers) {
  const result = feedDecoderPart(decoder, content);

  if (result.error) {
    setScanError(result.error);
    return;
  }

  setScanProgress(result.progress);
  if (!result.complete) return;

  setProcessing(true);
  try {
    const signedPsbt = getDecodedPsbt(decoder);
    log.info('Successfully decoded signed PSBT');
    onSignedPsbt(signedPsbt);
    handleClose();
  } catch (error) {
    log.error('Failed to decode PSBT', { error });
    setScanError(error instanceof Error ? error.message : 'Failed to decode PSBT');
    setProcessing(false);
  }
}

type ImportSignedPsbtFileOptions = {
  file: File;
  onSignedPsbt: (signedPsbt: string) => void;
  handleClose: () => void;
  setScanError: (error: string) => void;
};

async function importSignedPsbtFile({
  file,
  onSignedPsbt,
  handleClose,
  setScanError,
}: ImportSignedPsbtFileOptions) {
  try {
    const signedPsbt = await readSignedPsbtFile(file);
    logSignedPsbtImport(signedPsbt);
    onSignedPsbt(signedPsbt.base64);
    handleClose();
  } catch (error) {
    if (!isInvalidPsbtFileFormatError(error)) {
      log.error('Failed to parse PSBT file', { error });
    }
    setScanError((error as Error).message);
  }
}

function logSignedPsbtImport(signedPsbt: SignedPsbtImport) {
  if (signedPsbt.source === 'binary') {
    log.info('Loaded binary PSBT from file', { size: signedPsbt.size });
    return;
  }

  if (signedPsbt.source === 'base64') {
    log.info('Loaded base64 PSBT from file');
    return;
  }

  log.info('Converted hex PSBT to base64');
}
