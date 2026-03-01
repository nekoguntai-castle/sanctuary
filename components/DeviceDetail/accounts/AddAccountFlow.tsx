import React, { useState, useRef } from 'react';
import { X, Usb, QrCode, HardDrive, Edit2 } from 'lucide-react';
import { URRegistryDecoder } from '@keystonehq/bc-ur-registry';
import { URDecoder as BytesURDecoder } from '@ngraveio/bc-ur';
import { DeviceAccount as ParsedDeviceAccount, parseDeviceJson } from '../../../services/deviceParsers';
import { hardwareWalletService, isSecureContext, DeviceType } from '../../../services/hardwareWallet';
import { getDevice, addDeviceAccount } from '../../../src/api/devices';
import { Device } from '../../../types';
import { createLogger } from '../../../utils/logger';
import { ManualAccountForm } from '../ManualAccountForm';
import type { ManualAccountData } from '../ManualAccountForm';
import { ImportReview } from './ImportReview';
import type { AccountConflict } from './ImportReview';
import { UsbImport } from './UsbImport';
import { QrImport } from './QrImport';
import { FileImport } from './FileImport';
import { extractFromUrResult, normalizeDerivationPath } from './urHelpers';

const log = createLogger('DeviceDetail');

interface AddAccountFlowProps {
  deviceId: string;
  device: Device;
  onClose: () => void;
  onDeviceUpdated: (device: Device) => void;
}

// Helper to get device type from device model
const getDeviceTypeFromDeviceModel = (device: Device): DeviceType | null => {
  const type = device.type?.toLowerCase();
  if (type?.includes('trezor')) return 'trezor';
  if (type?.includes('ledger')) return 'ledger';
  if (type?.includes('coldcard')) return 'coldcard';
  if (type?.includes('bitbox')) return 'bitbox';
  if (type?.includes('jade')) return 'jade';
  return null;
};

export const AddAccountFlow: React.FC<AddAccountFlowProps> = ({
  deviceId,
  device,
  onClose,
  onDeviceUpdated,
}) => {
  const [addAccountMethod, setAddAccountMethod] = useState<'usb' | 'manual' | 'sdcard' | 'qr' | null>(null);
  const [addAccountLoading, setAddAccountLoading] = useState(false);
  const [addAccountError, setAddAccountError] = useState<string | null>(null);
  const [usbProgress, setUsbProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [manualAccount, setManualAccount] = useState<ManualAccountData>({
    purpose: 'multisig',
    scriptType: 'native_segwit',
    derivationPath: "m/48'/0'/0'/2'",
    xpub: '',
  });

  // QR scanning state
  const [qrMode, setQrMode] = useState<'camera' | 'file'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [urProgress, setUrProgress] = useState<number>(0);
  const urDecoderRef = useRef<URRegistryDecoder | null>(null);
  const bytesDecoderRef = useRef<BytesURDecoder | null>(null);

  // Parsed accounts from file/QR import
  const [parsedAccounts, setParsedAccounts] = useState<ParsedDeviceAccount[]>([]);
  const [selectedParsedAccounts, setSelectedParsedAccounts] = useState<Set<number>>(new Set());
  const [importFingerprint, setImportFingerprint] = useState<string>('');
  const [accountConflict, setAccountConflict] = useState<AccountConflict | null>(null);

  /**
   * Process parsed accounts - compare with existing device accounts
   */
  const processImportedAccounts = (accounts: ParsedDeviceAccount[], fingerprint: string) => {
    // SECURITY: Fingerprint validation prevents adding accounts from wrong device.
    // Case-insensitive comparison because different hardware wallets export fingerprints
    // in different formats (some uppercase, some lowercase). This is a security check
    // to ensure imported data belongs to this device.
    if (fingerprint && device.fingerprint.toLowerCase() !== fingerprint.toLowerCase()) {
      setAddAccountError(`Fingerprint mismatch: imported ${fingerprint} but device has ${device.fingerprint}`);
      return;
    }

    const existingPaths = new Set(device.accounts?.map(a => a.derivationPath) || []);
    const existingXpubs = new Map(device.accounts?.map(a => [a.derivationPath, a.xpub]) || []);

    const newAccounts: ParsedDeviceAccount[] = [];
    const matchingAccounts: ParsedDeviceAccount[] = [];
    const conflictingAccounts: ParsedDeviceAccount[] = [];

    for (const account of accounts) {
      if (!existingPaths.has(account.derivationPath)) {
        newAccounts.push(account);
      } else {
        const existingXpub = existingXpubs.get(account.derivationPath);
        if (existingXpub === account.xpub) {
          matchingAccounts.push(account);
        } else {
          conflictingAccounts.push(account);
        }
      }
    }

    if (conflictingAccounts.length > 0) {
      setAddAccountError(`${conflictingAccounts.length} account(s) have conflicting xpubs - this may indicate a security issue`);
      return;
    }

    if (newAccounts.length === 0) {
      setAddAccountError('No new accounts to add - all derivation paths already exist on this device');
      return;
    }

    // Set up for selection
    setParsedAccounts(newAccounts);
    setSelectedParsedAccounts(new Set(newAccounts.map((_, i) => i)));
    setImportFingerprint(fingerprint);
    setAccountConflict({
      existingAccounts: device.accounts || [],
      newAccounts,
      matchingAccounts,
    });
  };

  /**
   * Handle file upload for SD card import
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = parseDeviceJson(content);

      if (result && (result.xpub || result.accounts?.length)) {
        if (result.accounts && result.accounts.length > 0) {
          processImportedAccounts(result.accounts, result.fingerprint || '');
          log.info('File parsed with multiple accounts', {
            format: result.format,
            accountCount: result.accounts.length,
          });
        } else if (result.xpub) {
          // Single account - convert to account format
          // BIP-48 defines script type indices in the derivation path: m/48'/coin'/account'/script'
          // Script type index: /1' = nested_segwit (P2SH-P2WSH), /2' = native_segwit (P2WSH)
          const singleAccount: ParsedDeviceAccount = {
            purpose: result.derivationPath?.includes("48'") ? 'multisig' : 'single_sig',
            scriptType: result.derivationPath?.includes("/2'") ? 'native_segwit' :
                       result.derivationPath?.includes("/1'") ? 'nested_segwit' : 'native_segwit',
            derivationPath: result.derivationPath || "m/84'/0'/0'",
            xpub: result.xpub,
          };
          processImportedAccounts([singleAccount], result.fingerprint || '');
        }
        setAddAccountLoading(false);
      } else {
        setAddAccountError('Could not parse file. Please check the format.');
        setAddAccountLoading(false);
      }
    };
    reader.onerror = () => {
      setAddAccountError('Failed to read file.');
      setAddAccountLoading(false);
    };
    reader.readAsText(file);
  };

  /**
   * Handle QR code scan result
   */
  const handleQrScan = (result: { rawValue: string }[]) => {
    if (!result || result.length === 0) return;

    const content = result[0].rawValue;
    const contentLower = content.toLowerCase();

    log.info('QR code scanned', { length: content.length, prefix: content.substring(0, 50) });

    // Check if this is UR format
    if (contentLower.startsWith('ur:')) {
      const urTypeMatch = contentLower.match(/^ur:([a-z0-9-]+)/);
      const urType = urTypeMatch ? urTypeMatch[1] : 'unknown';

      try {
        // Handle ur:bytes format
        if (urType === 'bytes') {
          if (!bytesDecoderRef.current) {
            bytesDecoderRef.current = new BytesURDecoder();
          }

          bytesDecoderRef.current.receivePart(content);
          const progress = bytesDecoderRef.current.estimatedPercentComplete();
          setUrProgress(Math.round(progress * 100));

          if (bytesDecoderRef.current.isComplete() !== true) {
            return;
          }

          setCameraActive(false);
          setAddAccountLoading(true);

          if (!bytesDecoderRef.current.isSuccess()) {
            throw new Error('UR bytes decode failed');
          }

          const decodedUR = bytesDecoderRef.current.resultUR();
          const rawBytes = decodedUR.decodeCBOR();
          const textDecoder = new TextDecoder('utf-8');
          const textContent = textDecoder.decode(rawBytes);

          const parseResult = parseDeviceJson(textContent);
          if (parseResult && parseResult.accounts) {
            processImportedAccounts(parseResult.accounts, parseResult.fingerprint || '');
          } else if (parseResult && parseResult.xpub) {
            const singleAccount: ParsedDeviceAccount = {
              purpose: parseResult.derivationPath?.includes("48'") ? 'multisig' : 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: parseResult.derivationPath || "m/84'/0'/0'",
              xpub: parseResult.xpub,
            };
            processImportedAccounts([singleAccount], parseResult.fingerprint || '');
          } else {
            throw new Error('Could not extract accounts from ur:bytes');
          }

          setAddAccountLoading(false);
          setUrProgress(0);
          bytesDecoderRef.current = null;
          return;
        }

        // For other UR types
        if (!urDecoderRef.current) {
          urDecoderRef.current = new URRegistryDecoder();
        }

        urDecoderRef.current.receivePart(content);
        const progress = urDecoderRef.current.estimatedPercentComplete();
        setUrProgress(Math.round(progress * 100));

        if (!urDecoderRef.current.isComplete()) {
          return;
        }

        setCameraActive(false);
        setAddAccountLoading(true);

        if (!urDecoderRef.current.isSuccess()) {
          throw new Error('UR decode failed');
        }

        const registryType = urDecoderRef.current.resultRegistryType();
        const extracted = extractFromUrResult(registryType);

        if (extracted && extracted.xpub) {
          const singleAccount: ParsedDeviceAccount = {
            purpose: extracted.path.includes("48'") ? 'multisig' : 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: normalizeDerivationPath(extracted.path) || "m/84'/0'/0'",
            xpub: extracted.xpub,
          };
          processImportedAccounts([singleAccount], extracted.fingerprint || '');
        } else {
          throw new Error('Could not extract xpub from UR');
        }

        setAddAccountLoading(false);
        setUrProgress(0);
        urDecoderRef.current = null;
        return;

      } catch (err) {
        log.error('Failed to decode UR QR code', { err });
        setAddAccountError(err instanceof Error ? err.message : 'Failed to decode UR QR code');
        setCameraActive(false);
        setAddAccountLoading(false);
        setUrProgress(0);
        urDecoderRef.current = null;
        bytesDecoderRef.current = null;
        return;
      }
    }

    // Non-UR format
    setCameraActive(false);
    setAddAccountLoading(true);

    const parseResult = parseDeviceJson(content);
    if (parseResult && (parseResult.xpub || parseResult.accounts?.length)) {
      if (parseResult.accounts && parseResult.accounts.length > 0) {
        processImportedAccounts(parseResult.accounts, parseResult.fingerprint || '');
      } else if (parseResult.xpub) {
        const singleAccount: ParsedDeviceAccount = {
          purpose: parseResult.derivationPath?.includes("48'") ? 'multisig' : 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: parseResult.derivationPath || "m/84'/0'/0'",
          xpub: parseResult.xpub,
        };
        processImportedAccounts([singleAccount], parseResult.fingerprint || '');
      }
      log.info('QR code parsed successfully', { format: parseResult.format });
    } else {
      setAddAccountError('Could not find valid account data in QR code');
    }
    setAddAccountLoading(false);
  };

  const handleCameraError = (error: unknown) => {
    log.error('Camera error', { error });
    setCameraActive(false);
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Please allow camera permissions.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError(`Camera error: ${error.message}`);
      }
    } else {
      setCameraError('Failed to access camera. Make sure you are using HTTPS.');
    }
  };

  /**
   * Reset import state
   */
  const resetImportState = () => {
    setParsedAccounts([]);
    setSelectedParsedAccounts(new Set());
    setAccountConflict(null);
    setImportFingerprint('');
    setCameraActive(false);
    setCameraError(null);
    setUrProgress(0);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
  };

  // Add accounts via USB connection
  const handleAddAccountsViaUsb = async () => {
    const deviceType = getDeviceTypeFromDeviceModel(device);
    if (!deviceType) {
      setAddAccountError('USB connection not supported for this device type');
      return;
    }

    setAddAccountLoading(true);
    setAddAccountError(null);
    setUsbProgress(null);

    try {
      // Connect to the device
      await hardwareWalletService.connect(deviceType);

      // Fetch all xpubs
      const allXpubs = await hardwareWalletService.getAllXpubs((current, total, name) => {
        setUsbProgress({ current, total, name });
      });

      // Filter out accounts that already exist on this device
      const existingPaths = new Set(device.accounts?.map(a => a.derivationPath) || []);
      const newAccounts = allXpubs.filter(x => !existingPaths.has(x.path));

      if (newAccounts.length === 0) {
        setAddAccountError('No new accounts to add. All derivation paths already exist on this device.');
        return;
      }

      // Add each new account
      let addedCount = 0;
      for (const account of newAccounts) {
        try {
          await addDeviceAccount(deviceId, {
            purpose: account.purpose,
            scriptType: account.scriptType,
            derivationPath: account.path,
            xpub: account.xpub,
          });
          addedCount++;
        } catch (err) {
          log.warn('Failed to add account', { path: account.path, err });
        }
      }

      // Refresh device data
      const updatedDevice = await getDevice(deviceId);
      onDeviceUpdated(updatedDevice);
      onClose();

      log.info('Added accounts via USB', { addedCount, totalFetched: allXpubs.length });
    } catch (err) {
      log.error('Failed to add accounts via USB', { err });
      setAddAccountError(err instanceof Error ? err.message : 'Failed to connect to device');
    } finally {
      setAddAccountLoading(false);
      setUsbProgress(null);
      try {
        await hardwareWalletService.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
  };

  // Add account manually
  const handleAddAccountManually = async () => {
    if (!manualAccount.xpub || !manualAccount.derivationPath) return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    try {
      await addDeviceAccount(deviceId, manualAccount);

      // Refresh device data
      const updatedDevice = await getDevice(deviceId);
      onDeviceUpdated(updatedDevice);
      onClose();

      log.info('Added account manually', { path: manualAccount.derivationPath });
    } catch (err) {
      log.error('Failed to add account manually', { err });
      setAddAccountError(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setAddAccountLoading(false);
    }
  };

  /**
   * Add selected parsed accounts to the device
   */
  const handleAddParsedAccounts = async () => {
    if (parsedAccounts.length === 0 || selectedParsedAccounts.size === 0) return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    try {
      let addedCount = 0;
      for (const [index, account] of parsedAccounts.entries()) {
        if (selectedParsedAccounts.has(index)) {
          try {
            await addDeviceAccount(deviceId, {
              purpose: account.purpose,
              scriptType: account.scriptType,
              derivationPath: account.derivationPath,
              xpub: account.xpub,
            });
            addedCount++;
          } catch (err) {
            log.warn('Failed to add account', { path: account.derivationPath, err });
          }
        }
      }

      // Refresh device data
      const updatedDevice = await getDevice(deviceId);
      onDeviceUpdated(updatedDevice);
      onClose();

      log.info('Added accounts from import', { addedCount });
    } catch (err) {
      log.error('Failed to add accounts', { err });
      setAddAccountError(err instanceof Error ? err.message : 'Failed to add accounts');
    } finally {
      setAddAccountLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full shadow-xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-50">
              Add Derivation Path
            </h3>
            <button
              onClick={() => {
                resetImportState();
                onClose();
              }}
              className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {!addAccountMethod ? (
            <div className="space-y-3">
              <p className="text-sm text-sanctuary-500 mb-4">
                Choose how to add a new derivation path to this device.
              </p>

              {/* USB Option */}
              {isSecureContext() && getDeviceTypeFromDeviceModel(device) && (
                <button
                  onClick={() => setAddAccountMethod('usb')}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
                >
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Usb className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                      Connect via USB
                    </p>
                    <p className="text-xs text-sanctuary-500">
                      Fetch all derivation paths from device
                    </p>
                  </div>
                </button>
              )}

              {/* SD Card Option */}
              <button
                onClick={() => { setAddAccountMethod('sdcard'); resetImportState(); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <HardDrive className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Import from SD Card
                  </p>
                  <p className="text-xs text-sanctuary-500">
                    Upload export file from device
                  </p>
                </div>
              </button>

              {/* QR Code Option */}
              <button
                onClick={() => { setAddAccountMethod('qr'); resetImportState(); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <QrCode className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Scan QR Code
                  </p>
                  <p className="text-xs text-sanctuary-500">
                    Scan animated or static QR codes
                  </p>
                </div>
              </button>

              {/* Manual Option */}
              <button
                onClick={() => setAddAccountMethod('manual')}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
                  <Edit2 className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
                </div>
                <div>
                  <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Enter Manually
                  </p>
                  <p className="text-xs text-sanctuary-500">
                    Enter derivation path and xpub
                  </p>
                </div>
              </button>
            </div>
          ) : parsedAccounts.length > 0 ? (
            <ImportReview
              parsedAccounts={parsedAccounts}
              selectedParsedAccounts={selectedParsedAccounts}
              setSelectedParsedAccounts={setSelectedParsedAccounts}
              accountConflict={accountConflict}
              addAccountLoading={addAccountLoading}
              onAddParsedAccounts={handleAddParsedAccounts}
            />
          ) : addAccountMethod === 'usb' ? (
            <UsbImport
              deviceType={device.type}
              addAccountLoading={addAccountLoading}
              usbProgress={usbProgress}
              onConnect={handleAddAccountsViaUsb}
            />
          ) : addAccountMethod === 'sdcard' ? (
            <FileImport
              deviceType={device.type}
              addAccountLoading={addAccountLoading}
              onFileUpload={handleFileUpload}
            />
          ) : addAccountMethod === 'qr' ? (
            <QrImport
              qrMode={qrMode}
              setQrMode={setQrMode}
              cameraActive={cameraActive}
              setCameraActive={setCameraActive}
              cameraError={cameraError}
              setCameraError={setCameraError}
              urProgress={urProgress}
              setUrProgress={setUrProgress}
              addAccountLoading={addAccountLoading}
              onQrScan={handleQrScan}
              onCameraError={handleCameraError}
              onFileUpload={handleFileUpload}
              urDecoderRef={urDecoderRef}
              bytesDecoderRef={bytesDecoderRef}
            />
          ) : addAccountMethod === 'manual' ? (
            <ManualAccountForm
              account={manualAccount}
              onChange={setManualAccount}
              onSubmit={handleAddAccountManually}
              loading={addAccountLoading}
            />
          ) : null}

          {/* Error Message */}
          {addAccountError && (
            <p className="mt-4 text-center text-sm text-rose-600 dark:text-rose-400">
              {addAccountError}
            </p>
          )}

          {/* Back button when in a method */}
          {addAccountMethod && !addAccountLoading && (
            <button
              onClick={() => {
                setAddAccountMethod(null);
                setAddAccountError(null);
                resetImportState();
              }}
              className="mt-4 w-full text-center text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300"
            >
              ← Back to options
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
