import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { ImportValidationResult } from '../../../api/wallets';
import type { TabNetwork } from '../../../app/networks';
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

export interface ImportNetworkOwner {
  network: TabNetwork;
  generation: number;
}

/** Exact input and ownership accepted by one validation request. */
export interface ImportInputSnapshot {
  owner: ImportNetworkOwner;
  generation: number;
  data: string;
  format: ImportFormat | null;
}

function useInvalidatingSetter<T>(setter: Dispatch<SetStateAction<T>>, invalidate: () => void) {
  return useCallback((value: SetStateAction<T>) => {
    invalidate();
    setter(value);
  }, [invalidate, setter]);
}

export function useImportState(network: TabNetwork = 'mainnet') {
  const [step, setStep] = useState(1);

  // Form State
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [importData, setImportData] = useState('');
  const [walletName, setWalletName] = useState('');

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
  const [scriptType, setScriptType] = useState<ScriptType>(WalletScriptType.NATIVE_SEGWIT);
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

  const ownerRef = useRef<ImportNetworkOwner>({ network, generation: 0 });
  const mountedRef = useRef(true);
  const inputGenerationRef = useRef(0);
  const [validatedInput, setValidatedInput] = useState<ImportInputSnapshot | null>(null);
  // Every edit advances ownership, including A → B → A; equality cannot revive A.
  const resetValidation = useCallback(() => {
    inputGenerationRef.current += 1;
    setValidatedInput(null);
    setStep(current => current > 2 ? 2 : current);
    setValidationResult(null);
    setValidationError(null);
    setIsValidating(false);
  }, []);

  const ownedSetImportData = useInvalidatingSetter(setImportData, resetValidation);
  const ownedSetFormat = useInvalidatingSetter(setFormat, resetValidation);
  const ownedSetScriptType = useInvalidatingSetter(setScriptType, resetValidation);
  const ownedSetAccountIndex = useInvalidatingSetter(setAccountIndex, resetValidation);
  const ownedSetHardwareDeviceType = useInvalidatingSetter(setHardwareDeviceType, resetValidation);
  const ownedSetXpubData = useInvalidatingSetter(setXpubData, resetValidation);

  const resetNetworkOwnedState = () => {
    resetValidation();
    setStep(1);
    setFormat(null);
    setImportData('');
    setWalletName('');
    setValidationResult(null);
    setIsValidating(false);
    setValidationError(null);
    setIsImporting(false);
    setImportError(null);
    setHardwareDeviceType('ledger');
    setDeviceConnected(false);
    setDeviceLabel(null);
    setScriptType(WalletScriptType.NATIVE_SEGWIT);
    setAccountIndex(0);
    setXpubData(null);
    setIsFetchingXpub(false);
    setIsConnecting(false);
    setHardwareError(null);
    setCameraActive(false);
    setCameraError(null);
    setUrProgress(0);
    setQrScanned(false);
    bytesDecoderRef.current = null;
  };

  if (ownerRef.current.network !== network) {
    ownerRef.current = {
      network,
      generation: ownerRef.current.generation + 1,
    };
    resetNetworkOwnedState();
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inputGenerationRef.current += 1;
    };
  }, []);

  const getNetworkOwner = useCallback(
    (): ImportNetworkOwner => ({ ...ownerRef.current }),
    [],
  );

  const isNetworkOwnerCurrent = useCallback((owner: ImportNetworkOwner): boolean => (
    mountedRef.current
    && owner.network === ownerRef.current.network
    && owner.generation === ownerRef.current.generation
  ), []);

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

  // Retire prior work before capture. Hardware callers set the descriptor first
  // and pass it explicitly because React has not rendered that write yet.
  const beginValidation = (dataOverride?: string): ImportInputSnapshot => {
    resetValidation();
    return {
      owner: getNetworkOwner(),
      generation: inputGenerationRef.current,
      data: dataOverride ?? importData,
      format,
    };
  };
  const isValidationCurrent = (snapshot: ImportInputSnapshot): boolean => (
    isNetworkOwnerCurrent(snapshot.owner)
    && snapshot.generation === inputGenerationRef.current
  );
  const acceptValidation = (snapshot: ImportInputSnapshot, result: ImportValidationResult | null) => {
    if (!isValidationCurrent(snapshot)) return;
    setValidationResult(result);
    setValidatedInput(result?.valid ? snapshot : null);
  };

  return {
    step, setStep,
    format, setFormat: ownedSetFormat,
    importData, setImportData: ownedSetImportData,
    walletName, setWalletName,
    network,
    validationResult, setValidationResult,
    isValidating, setIsValidating,
    validationError, setValidationError,
    isImporting, setIsImporting,
    importError, setImportError,
    hardwareDeviceType, setHardwareDeviceType: ownedSetHardwareDeviceType,
    deviceConnected, setDeviceConnected,
    deviceLabel, setDeviceLabel,
    scriptType, setScriptType: ownedSetScriptType,
    accountIndex, setAccountIndex: ownedSetAccountIndex,
    xpubData, setXpubData: ownedSetXpubData,
    isFetchingXpub, setIsFetchingXpub,
    isConnecting, setIsConnecting,
    hardwareError, setHardwareError,
    cameraActive, setCameraActive,
    cameraError, setCameraError,
    urProgress, setUrProgress,
    qrScanned, setQrScanned,
    bytesDecoderRef,
    getNetworkOwner,
    isNetworkOwnerCurrent,
    resetHardwareState,
    resetQrState,
    resetValidation,
    beginValidation, isValidationCurrent, acceptValidation, validatedInput,
  };
}
