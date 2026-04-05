import React from 'react';
import {
  AlertCircle,
  CheckCircle,
  Usb,
  Loader2,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import type { DeviceType } from '../../../services/hardwareWallet/types';
import { isSecureContext } from '../../../services/hardwareWallet/environment';
import { loadHardwareWalletRuntime } from '../../../services/hardwareWallet/loader';
import { createLogger } from '../../../utils/logger';
import { ScriptType, HardwareDeviceType, getDerivationPath, scriptTypeOptions } from '../importHelpers';
import { XpubData } from '../hooks/useImportState';

const log = createLogger('ImportWallet');

interface HardwareImportProps {
  hardwareDeviceType: HardwareDeviceType;
  setHardwareDeviceType: (type: HardwareDeviceType) => void;
  deviceConnected: boolean;
  setDeviceConnected: (connected: boolean) => void;
  deviceLabel: string | null;
  setDeviceLabel: (label: string | null) => void;
  scriptType: ScriptType;
  setScriptType: (type: ScriptType) => void;
  accountIndex: number;
  setAccountIndex: (index: number) => void;
  xpubData: XpubData | null;
  setXpubData: (data: XpubData | null) => void;
  isFetchingXpub: boolean;
  setIsFetchingXpub: (fetching: boolean) => void;
  isConnecting: boolean;
  setIsConnecting: (connecting: boolean) => void;
  hardwareError: string | null;
  setHardwareError: (error: string | null) => void;
}

export const HardwareImport: React.FC<HardwareImportProps> = ({
  hardwareDeviceType,
  setHardwareDeviceType,
  deviceConnected,
  setDeviceConnected,
  deviceLabel,
  setDeviceLabel,
  scriptType,
  setScriptType,
  accountIndex,
  setAccountIndex,
  xpubData,
  setXpubData,
  isFetchingXpub,
  setIsFetchingXpub,
  isConnecting,
  setIsConnecting,
  hardwareError,
  setHardwareError,
}) => {
  // Check if Ledger is supported (requires HTTPS)
  const ledgerSupported = isSecureContext();

  // Hardware device connection handler
  const handleConnectDevice = async () => {
    setIsConnecting(true);
    setHardwareError(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      // Connect using the selected device type
      const device = await hardwareWalletService.connect(hardwareDeviceType as DeviceType);
      setDeviceConnected(true);
      setDeviceLabel(device.name || (hardwareDeviceType === 'trezor' ? 'Trezor Device' : 'Ledger Device'));
    } catch (error) {
      log.error('Failed to connect hardware device', { error });
      setHardwareError(error instanceof Error ? error.message : 'Failed to connect device');
    } finally {
      setIsConnecting(false);
    }
  };

  // Fetch xpub from connected device
  const handleFetchXpub = async () => {
    setIsFetchingXpub(true);
    setHardwareError(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      const path = getDerivationPath(scriptType, accountIndex);
      // Use the service which routes to the correct device implementation
      const result = await hardwareWalletService.getXpub(path);

      if (result.xpub && result.fingerprint) {
        setXpubData({
          xpub: result.xpub,
          fingerprint: result.fingerprint,
          path: path
        });
      } else {
        setHardwareError('Failed to retrieve xpub from device');
      }
    } catch (error) {
      log.error('Failed to fetch xpub', { error });
      setHardwareError(error instanceof Error ? error.message : 'Failed to fetch xpub');
    } finally {
      setIsFetchingXpub(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        Connect Hardware Device
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        Select your device type and connect via USB.
      </p>

      <div className="space-y-6">
        {/* Device Type Selection */}
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">
            Device Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setHardwareDeviceType('ledger');
                setDeviceConnected(false);
                setXpubData(null);
              }}
              disabled={!ledgerSupported}
              className={`p-4 rounded-lg border text-left transition-colors ${
                hardwareDeviceType === 'ledger'
                  ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : !ledgerSupported
                    ? 'border-sanctuary-200 dark:border-sanctuary-700 opacity-50 cursor-not-allowed'
                    : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
              }`}
            >
              <p className={`text-sm font-medium ${
                hardwareDeviceType === 'ledger'
                  ? 'text-primary-700 dark:text-primary-400'
                  : 'text-sanctuary-900 dark:text-sanctuary-100'
              }`}>
                Ledger
              </p>
              <p className="text-xs text-sanctuary-500 mt-0.5">
                {ledgerSupported ? 'Nano S, S Plus, X, Stax, Flex' : 'Requires HTTPS connection'}
              </p>
            </button>
            <button
              onClick={() => {
                setHardwareDeviceType('trezor');
                setDeviceConnected(false);
                setXpubData(null);
              }}
              className={`p-4 rounded-lg border text-left transition-colors ${
                hardwareDeviceType === 'trezor'
                  ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
              }`}
            >
              <p className={`text-sm font-medium ${
                hardwareDeviceType === 'trezor'
                  ? 'text-primary-700 dark:text-primary-400'
                  : 'text-sanctuary-900 dark:text-sanctuary-100'
              }`}>
                Trezor
              </p>
              <p className="text-xs text-sanctuary-500 mt-0.5">One, Model T, Safe 3/5/7</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Via Trezor Suite</p>
            </button>
          </div>
        </div>

        {/* Trezor workflow notice */}
        {hardwareDeviceType === 'trezor' && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium mb-1">Trezor Suite Required</p>
              <p className="text-amber-700 dark:text-amber-300">
                You'll need to switch between Sanctuary and Trezor Suite to approve requests on your device.
                Keep Trezor Suite open and check it when prompted.
              </p>
            </div>
          </div>
        )}

        {/* Device Connection */}
        <div className="surface-secondary rounded-lg p-6">
          {!deviceConnected ? (
            <div className="text-center">
              <div className="mx-auto w-16 h-16 surface-elevated rounded-full flex items-center justify-center mb-4">
                <Usb className="w-8 h-8 text-sanctuary-400" />
              </div>
              <p className="text-sm text-sanctuary-500 mb-4">
                {hardwareDeviceType === 'trezor'
                  ? 'Make sure Trezor Suite desktop app is running and your device is connected.'
                  : 'Make sure your Ledger is connected and the Bitcoin app is open.'}
              </p>
              <Button
                onClick={handleConnectDevice}
                isLoading={isConnecting}
                disabled={isConnecting || (hardwareDeviceType === 'ledger' && !ledgerSupported)}
              >
                {isConnecting ? 'Connecting...' : 'Connect Device'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success-100 dark:bg-success-900/30 rounded-full flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-success-600 dark:text-success-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  {deviceLabel}
                </p>
                <p className="text-xs text-success-600 dark:text-success-400">Connected</p>
              </div>
            </div>
          )}
        </div>

        {deviceConnected && (
          <>
            {/* Script Type Selection */}
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">
                Script Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                {scriptTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setScriptType(option.value);
                      setXpubData(null); // Clear xpub when script type changes
                    }}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      scriptType === option.value
                        ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                        : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
                    }`}
                  >
                    <p className={`text-sm font-medium ${
                      scriptType === option.value
                        ? 'text-primary-700 dark:text-primary-400'
                        : 'text-sanctuary-900 dark:text-sanctuary-100'
                    }`}>
                      {option.label}
                    </p>
                    <p className="text-xs text-sanctuary-500 mt-0.5">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Account Index */}
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                Account Index
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={accountIndex}
                onChange={(e) => {
                  setAccountIndex(Math.max(0, parseInt(e.target.value, 10) || 0));
                  setXpubData(null); // Clear xpub when account changes
                }}
                className="w-32 px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-sanctuary-500 mt-1">
                Use 0 for first account, 1 for second, etc.
              </p>
            </div>

            {/* Derivation Path Display */}
            <div className="surface-secondary rounded-lg p-4">
              <p className="text-xs text-sanctuary-500 mb-1">Derivation Path</p>
              <p className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100">
                {getDerivationPath(scriptType, accountIndex)}
              </p>
            </div>

            {/* Fetch Xpub Button */}
            <div className="text-center">
              <Button
                onClick={handleFetchXpub}
                isLoading={isFetchingXpub}
                disabled={isFetchingXpub}
                variant="secondary"
              >
                {isFetchingXpub ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Fetching from device...
                  </>
                ) : xpubData ? (
                  'Fetch Again'
                ) : (
                  'Fetch Xpub from Device'
                )}
              </Button>
            </div>

            {/* Xpub Result */}
            {xpubData && (
              <div className="surface-secondary rounded-lg p-4 border border-success-200 dark:border-success-800">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-4 h-4 text-success-600 dark:text-success-400" />
                  <p className="text-sm font-medium text-success-700 dark:text-success-400">
                    Xpub Retrieved Successfully
                  </p>
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-sanctuary-500">Fingerprint</p>
                    <p className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100">
                      {xpubData.fingerprint}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-sanctuary-500">Extended Public Key</p>
                    <p className="font-mono text-xs text-sanctuary-700 dark:text-sanctuary-300 break-all">
                      {xpubData.xpub.substring(0, 20)}...{xpubData.xpub.substring(xpubData.xpub.length - 20)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Error Display */}
        {hardwareError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{hardwareError}</span>
          </div>
        )}
      </div>
    </div>
  );
};
