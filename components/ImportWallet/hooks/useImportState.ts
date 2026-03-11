import { useState, useRef } from 'react';
import { ImportValidationResult } from '../../../src/api/wallets';
import { ImportFormat, ScriptType, HardwareDeviceType } from '../importHelpers';

export interface XpubData {
  xpub: string;
  fingerprint: string;
  path: string;
}

export interface BytesUrDecoderLike {
  receivePart: (part: string) => unknown;
  estimatedPercentComplete: () => number;
  isComplete: () => boolean;
  isSuccess: () => boolean;
  resultError: () => string | undefined;
  resultUR: () => {
    decodeCBOR: () => Uint8Array;
  };
}

export function useImportState() {
  const [step, setStep] = useState(1);

  // Form State
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [importData, setImportData] = useState('');
  const [walletName, setWalletName] = useState('');
  const [network, setNetwork] = useState<'mainnet' | 'testnet' | 'regtest'>('mainnet');

  // Validation State
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Hardware Import State
  const [hardwareDeviceType, setHardwareDeviceType] = useState<HardwareDeviceType>('ledger');
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [scriptType, setScriptType] = useState<ScriptType>('native_segwit');
  const [accountIndex, setAccountIndex] = useState(0);
  const [xpubData, setXpubData] = useState<XpubData | null>(null);
  const [isFetchingXpub, setIsFetchingXpub] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hardwareError, setHardwareError] = useState<string | null>(null);

  // QR Code Import State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [urProgress, setUrProgress] = useState<number>(0);
  const [qrScanned, setQrScanned] = useState(false);
  const bytesDecoderRef = useRef<BytesUrDecoderLike | null>(null);

  const resetHardwareState = () => {
    setDeviceConnected(false);
    setDeviceLabel(null);
    setXpubData(null);
    setHardwareError(null);
  };

  const resetQrState = () => {
    setCameraActive(false);
    setCameraError(null);
    setUrProgress(0);
    setQrScanned(false);
    bytesDecoderRef.current = null;
  };

  const resetValidation = () => {
    setValidationResult(null);
    setValidationError(null);
  };

  return {
    step, setStep,
    format, setFormat,
    importData, setImportData,
    walletName, setWalletName,
    network, setNetwork,
    validationResult, setValidationResult,
    isValidating, setIsValidating,
    validationError, setValidationError,
    isImporting, setIsImporting,
    importError, setImportError,
    hardwareDeviceType, setHardwareDeviceType,
    deviceConnected, setDeviceConnected,
    deviceLabel, setDeviceLabel,
    scriptType, setScriptType,
    accountIndex, setAccountIndex,
    xpubData, setXpubData,
    isFetchingXpub, setIsFetchingXpub,
    isConnecting, setIsConnecting,
    hardwareError, setHardwareError,
    cameraActive, setCameraActive,
    cameraError, setCameraError,
    urProgress, setUrProgress,
    qrScanned, setQrScanned,
    bytesDecoderRef,
    resetHardwareState,
    resetQrState,
    resetValidation,
  };
}
