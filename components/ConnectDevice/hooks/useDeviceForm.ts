/**
 * useDeviceForm Hook
 *
 * Manages all form state and business logic handlers for the ConnectDevice flow:
 * - Form data (label, xpub, fingerprint, derivation path, accounts)
 * - QR extraction tracking and warnings
 * - Applying parsed results from QR scan, USB connection, and file upload
 * - Save/merge handlers that build device account payloads
 *
 * Extracted from ConnectDevice.tsx for better separation of concerns.
 */

import { useState, useEffect, useCallback } from 'react';
import { HardwareDeviceModel, CreateDeviceRequest, DeviceAccountInput } from '../../../src/api/devices';
import { DeviceAccount, parseDeviceJson } from '../../../services/deviceParsers';
import { QrScanResult } from '../../../hooks/qr/useQrScanner';
import { normalizeDerivationPath } from '../../../utils/deviceConnection';
import { ConnectionMethod, DeviceFormData } from '../types';

/** QR extraction tracking for which fields came from QR scan */
export interface QrExtractedFields {
  xpub: boolean;
  fingerprint: boolean;
  derivationPath: boolean;
  label: boolean;
}

/** Result from a USB device connection */
export interface ConnectionResult {
  fingerprint: string;
  accounts: DeviceAccount[];
}

/** Dependencies injected into the hook */
export interface UseDeviceFormDeps {
  selectedModel: HardwareDeviceModel | null;
  scanResult: QrScanResult | null;
  connectionResult: ConnectionResult | null;
  saveDevice: (data: CreateDeviceRequest) => Promise<void>;
  mergeDevice: (data: CreateDeviceRequest) => Promise<void>;
  resetQr: () => void;
  resetUsb: () => void;
  resetSave: () => void;
}

/** Return type of useDeviceForm */
export interface UseDeviceFormReturn {
  formData: DeviceFormData;
  scanned: boolean;
  fileScanning: boolean;
  warning: string | null;
  qrExtractedFields: QrExtractedFields | null;
  showQrDetails: boolean;
  method: ConnectionMethod | null;
  handleFormDataChange: (updates: Partial<DeviceFormData>) => void;
  handleToggleAccount: (index: number) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSelectMethod: (method: ConnectionMethod) => void;
  handleSave: () => Promise<void>;
  handleMerge: () => Promise<void>;
  setShowQrDetails: (show: boolean) => void;
}

function createInitialFormData(modelName?: string): DeviceFormData {
  return {
    label: modelName ? `My ${modelName}` : '',
    xpub: '',
    fingerprint: '',
    derivationPath: "m/84'/0'/0'",
    parsedAccounts: [],
    selectedAccounts: new Set(),
  };
}

export function useDeviceForm(deps: UseDeviceFormDeps): UseDeviceFormReturn {
  const {
    selectedModel,
    scanResult,
    connectionResult,
    saveDevice,
    mergeDevice,
    resetQr,
    resetUsb,
    resetSave,
  } = deps;

  // Local form state
  const [method, setMethod] = useState<ConnectionMethod | null>(null);
  const [scanned, setScanned] = useState(false);
  const [fileScanning, setFileScanning] = useState(false);
  const [formData, setFormData] = useState<DeviceFormData>(
    createInitialFormData(selectedModel?.name),
  );
  const [qrExtractedFields, setQrExtractedFields] = useState<QrExtractedFields | null>(null);
  const [showQrDetails, setShowQrDetails] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // Reset state when model changes
  useEffect(() => {
    setMethod(null);
    setScanned(false);
    resetQr();
    resetUsb();
    resetSave();
    setQrExtractedFields(null);
    setWarning(null);
    setFormData(createInitialFormData(selectedModel?.name));
  }, [selectedModel, resetQr, resetUsb, resetSave]);

  /**
   * Apply parsed device data to form
   */
  const applyParseResult = useCallback((result: QrScanResult | {
    xpub?: string;
    fingerprint?: string;
    derivationPath?: string;
    label?: string;
    accounts?: DeviceAccount[];
  }) => {
    setFormData(prev => {
      const updates: Partial<DeviceFormData> = {};

      if ('extractedFields' in result) {
        // QR scan result
        updates.xpub = result.xpub;
        updates.fingerprint = result.fingerprint;
        if (result.derivationPath) {
          updates.derivationPath = result.derivationPath;
        }
        if (result.label && !prev.label.startsWith('My ')) {
          updates.label = result.label;
        }
        if (result.accounts && result.accounts.length > 0) {
          updates.parsedAccounts = result.accounts;
          updates.selectedAccounts = new Set(result.accounts.map((_, i) => i));
        }

        setQrExtractedFields(result.extractedFields);
        setWarning(result.warning);
      } else {
        // File parse result
        if (result.xpub) updates.xpub = result.xpub;
        if (result.fingerprint) updates.fingerprint = result.fingerprint;
        if (result.derivationPath) {
          updates.derivationPath = normalizeDerivationPath(result.derivationPath);
        }
        if (result.label && !prev.label.startsWith('My ')) {
          updates.label = result.label;
        }
        if (result.accounts && result.accounts.length > 0) {
          updates.parsedAccounts = result.accounts;
          updates.selectedAccounts = new Set(result.accounts.map((_, i) => i));
        }
      }

      return { ...prev, ...updates };
    });
  }, []);

  // Apply QR scan result to form
  useEffect(() => {
    if (scanResult) {
      applyParseResult(scanResult);
      setScanned(true);
    }
  }, [scanResult, applyParseResult]);

  // Apply USB connection result to form
  useEffect(() => {
    if (connectionResult) {
      setFormData(prev => ({
        ...prev,
        fingerprint: connectionResult.fingerprint,
        parsedAccounts: connectionResult.accounts,
        selectedAccounts: new Set(connectionResult.accounts.map((_, i) => i)),
      }));
      setScanned(true);
    }
  }, [connectionResult]);

  /**
   * Handle file upload for SD card / QR file mode
   */
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileScanning(true);
    setWarning(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = parseDeviceJson(content);

      if (result && (result.xpub || result.fingerprint || result.accounts?.length)) {
        applyParseResult(result);
        setScanned(true);
      } else {
        setWarning('Could not parse file. Please check the format.');
      }
      setFileScanning(false);
    };
    reader.onerror = () => {
      setWarning('Failed to read file.');
      setFileScanning(false);
    };
    reader.readAsText(file);
  }, [applyParseResult]);

  /** Update form data */
  const handleFormDataChange = useCallback((updates: Partial<DeviceFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  /** Toggle account selection */
  const handleToggleAccount = useCallback((index: number) => {
    setFormData(prev => {
      const newSelected = new Set(prev.selectedAccounts);
      if (newSelected.has(index)) {
        newSelected.delete(index);
      } else {
        newSelected.add(index);
      }
      return { ...prev, selectedAccounts: newSelected };
    });
  }, []);

  /** Handle method selection */
  const handleSelectMethod = useCallback((newMethod: ConnectionMethod) => {
    setMethod(newMethod);
    setScanned(false);
    setWarning(null);
    setQrExtractedFields(null);
    resetQr();
    resetUsb();
  }, [resetQr, resetUsb]);

  /** Build accounts array from selected parsed accounts */
  const buildAccountsPayload = useCallback((): DeviceAccountInput[] => {
    const accounts: DeviceAccountInput[] = [];
    if (formData.parsedAccounts.length > 0 && formData.selectedAccounts.size > 0) {
      formData.parsedAccounts.forEach((account, index) => {
        if (formData.selectedAccounts.has(index)) {
          accounts.push({
            purpose: account.purpose,
            scriptType: account.scriptType,
            derivationPath: account.derivationPath,
            xpub: account.xpub,
          });
        }
      });
    }
    return accounts;
  }, [formData.parsedAccounts, formData.selectedAccounts]);

  /** Build the save/merge payload */
  const buildPayload = useCallback((): CreateDeviceRequest | null => {
    if (!selectedModel) return null;
    const accounts = buildAccountsPayload();
    return {
      type: selectedModel.name,
      label: formData.label || `${selectedModel.name} ${formData.fingerprint}`,
      fingerprint: formData.fingerprint || '00000000',
      ...(accounts.length > 0
        ? { accounts }
        : { xpub: formData.xpub, derivationPath: formData.derivationPath }
      ),
      modelSlug: selectedModel.slug,
    };
  }, [selectedModel, formData, buildAccountsPayload]);

  /** Handle save */
  const handleSave = useCallback(async () => {
    const payload = buildPayload();
    if (payload) await saveDevice(payload);
  }, [buildPayload, saveDevice]);

  /** Handle merge */
  const handleMerge = useCallback(async () => {
    const payload = buildPayload();
    if (payload) await mergeDevice(payload);
  }, [buildPayload, mergeDevice]);

  return {
    formData,
    scanned,
    fileScanning,
    warning,
    qrExtractedFields,
    showQrDetails,
    method,
    handleFormDataChange,
    handleToggleAccount,
    handleFileUpload,
    handleSelectMethod,
    handleSave,
    handleMerge,
    setShowQrDetails,
  };
}
