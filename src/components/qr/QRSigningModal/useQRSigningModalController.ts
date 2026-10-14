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
  onSignedPsbt: (signedPsbt: string) => Promise<void> | void;
};

type SignedPsbtHandler = ControllerOptions['onSignedPsbt'];

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
  // Refs (not state) so frames delivered before a re-render still see the guard.
  const inFlightRef = useRef(false);
  const lastRejectedPsbtRef = useRef<string | null>(null);

  // A completed bc-ur decoder ignores further parts, so a rejected or undecodable
  // submission needs a fresh decoder for the next scan to be decoded at all.
  const resetDecoder = useCallback(() => {
    decoderRef.current = null;
    setScanProgress(0);
  }, []);

  const onSubmitStart = useCallback(() => {
    inFlightRef.current = true;
  }, []);

  const onSubmitFailed = useCallback((rejectedPsbt: string) => {
    inFlightRef.current = false;
    lastRejectedPsbtRef.current = rejectedPsbt;
    resetDecoder();
  }, [resetDecoder]);

  // Camera paths only: a camera still pointed at the rejected animated QR would
  // otherwise rebuild and resubmit the same PSBT in a loop. The existing scanError
  // stays visible and the decoder restarts so a corrected PSBT can still decode.
  const isRejectedRepeat = useCallback((psbt: string) => {
    if (psbt !== lastRejectedPsbtRef.current) return false;
    resetDecoder();
    return true;
  }, [resetDecoder]);

  const resetScanner = useCallback(() => {
    resetDecoder();
    inFlightRef.current = false;
    lastRejectedPsbtRef.current = null;
    setScanError(null);
    setCameraError(null);
    setProcessing(false);
  }, [resetDecoder]);

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
    if (inFlightRef.current) return;
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
        onSubmitStart,
        onSubmitFailed,
        isRejectedRepeat,
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
      onSubmitStart,
      onSubmitFailed,
      isRejectedRepeat,
      resetDecoder,
    });
  }, [handleClose, onSignedPsbt, processing, onSubmitStart, onSubmitFailed, isRejectedRepeat, resetDecoder]);

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
      setProcessing,
      setScanError,
      onSubmitStart,
      onSubmitFailed,
    });
    event.target.value = '';
  }, [handleClose, onSignedPsbt, onSubmitStart, onSubmitFailed]);

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

type RawPsbtScanHandlers = FinishSignedPsbtOptions & {
  content: string;
  isRejectedRepeat: (psbt: string) => boolean;
};

function handleRawPsbtScan({
  content,
  isRejectedRepeat,
  ...submitOptions
}: RawPsbtScanHandlers) {
  const { setScanError } = submitOptions;
  const result = parseRawBase64PsbtScan(content);

  if (result.kind === 'psbt') {
    if (isRejectedRepeat(result.base64)) return;
    log.info('Received raw base64 PSBT');
    void finishSignedPsbt(result.base64, submitOptions);
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

type UrPsbtScanHandlers = FinishSignedPsbtOptions & {
  decoder: ReturnType<typeof createPsbtDecoder>;
  content: string;
  setScanProgress: (progress: number) => void;
  isRejectedRepeat: (psbt: string) => boolean;
  resetDecoder: () => void;
};

function handleUrPsbtScan({
  decoder,
  content,
  setScanProgress,
  isRejectedRepeat,
  resetDecoder,
  ...submitOptions
}: UrPsbtScanHandlers) {
  const { setProcessing, setScanError } = submitOptions;
  const result = feedDecoderPart(decoder, content);

  if (result.error) {
    setScanError(result.error);
    return;
  }

  setScanProgress(result.progress);
  if (!result.complete) return;

  try {
    const signedPsbt = getDecodedPsbt(decoder);
    if (isRejectedRepeat(signedPsbt)) return;
    log.info('Successfully decoded signed PSBT');
    void finishSignedPsbt(signedPsbt, submitOptions);
  } catch (error) {
    log.error('Failed to decode PSBT', { error });
    resetDecoder();
    setScanError(error instanceof Error ? error.message : 'Failed to decode PSBT');
    setProcessing(false);
  }
}

type ImportSignedPsbtFileOptions = FinishSignedPsbtOptions & {
  file: File;
};

async function importSignedPsbtFile({ file, ...submitOptions }: ImportSignedPsbtFileOptions) {
  const { setScanError } = submitOptions;
  try {
    const signedPsbt = await readSignedPsbtFile(file);
    logSignedPsbtImport(signedPsbt);
    await finishSignedPsbt(signedPsbt.base64, submitOptions);
  } catch (error) {
    if (!isInvalidPsbtFileFormatError(error)) {
      log.error('Failed to parse PSBT file', { error });
    }
    setScanError((error as Error).message);
  }
}

type FinishSignedPsbtOptions = {
  onSignedPsbt: SignedPsbtHandler;
  handleClose: () => void;
  setProcessing: (processing: boolean) => void;
  setScanError: (error: string) => void;
  onSubmitStart: () => void;
  onSubmitFailed: (rejectedPsbt: string) => void;
};

async function finishSignedPsbt(
  signedPsbt: string,
  { onSignedPsbt, handleClose, setProcessing, setScanError, onSubmitStart, onSubmitFailed }: FinishSignedPsbtOptions,
): Promise<void> {
  setProcessing(true);
  onSubmitStart();
  try {
    await onSignedPsbt(signedPsbt);
    handleClose();
  } catch (error) {
    log.error('Failed to process signed PSBT', { error });
    onSubmitFailed(signedPsbt);
    setScanError(error instanceof Error ? error.message : 'Failed to process signed PSBT');
    setProcessing(false);
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
