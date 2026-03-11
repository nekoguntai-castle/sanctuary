import React from 'react';
import type { DeviceType } from '../services/hardwareWallet/types';
import { Button } from './ui/Button';
import { X, Usb, Shield, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface HardwareWalletConnectProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (type: DeviceType) => Promise<void>;
  connecting: boolean;
  error: string | null;
  isSupported: boolean;
}

interface DeviceOption {
  type: DeviceType;
  name: string;
  description: string;
  icon: string;
  color: string;
}

const deviceOptions: DeviceOption[] = [
  {
    type: 'coldcard',
    name: 'Coldcard',
    description: 'Mk3, Mk4, Q',
    icon: '❄️',
    color: 'blue',
  },
  {
    type: 'ledger',
    name: 'Ledger',
    description: 'Nano S, Nano X, Nano S Plus',
    icon: '📱',
    color: 'green',
  },
  {
    type: 'trezor',
    name: 'Trezor',
    description: 'One, Model T, Safe 3/5/7',
    icon: '🔐',
    color: 'emerald',
  },
  {
    type: 'bitbox',
    name: 'BitBox',
    description: 'BitBox02',
    icon: '📦',
    color: 'orange',
  },
  {
    type: 'passport',
    name: 'Passport',
    description: 'Foundation Devices',
    icon: '🛂',
    color: 'purple',
  },
  {
    type: 'jade',
    name: 'Jade',
    description: 'Blockstream Jade',
    icon: '💎',
    color: 'cyan',
  },
];

export const HardwareWalletConnect: React.FC<HardwareWalletConnectProps> = ({
  isOpen,
  onClose,
  onConnect,
  connecting,
  error,
  isSupported,
}) => {
  if (!isOpen) return null;

  const handleDeviceClick = async (type: DeviceType) => {
    try {
      await onConnect(type);
    } catch (err) {
      // Error handled by parent
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="surface-elevated rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-sanctuary-200 dark:border-sanctuary-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-primary-100 dark:bg-primary-500/10 rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">
                Connect Hardware Wallet
              </h2>
              <p className="text-sm text-sanctuary-500">
                Select your device to sign transactions securely
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={connecting}
            className="p-2 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Browser Support Warning */}
        {!isSupported && (
          <div className="m-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 rounded-xl flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-1">
                USB Connection Unavailable
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                WebUSB requires HTTPS to connect hardware wallets directly. Use the PSBT file workflow instead:
                export unsigned transactions, sign on your device via SD card, then import the signed file.
              </p>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="m-6 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-rose-900 dark:text-rose-100 mb-1">
                Connection Failed
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          </div>
        )}

        {/* Device Grid */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {deviceOptions.map((deviceOption) => (
              <button
                key={deviceOption.type}
                onClick={() => handleDeviceClick(deviceOption.type)}
                disabled={connecting || !isSupported}
                className={`
                  p-6 rounded-xl border-2 transition-all text-left
                  ${
                    connecting
                      ? 'border-sanctuary-300 dark:border-sanctuary-700 opacity-50 cursor-not-allowed'
                      : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-primary-500 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]'
                  }
                  ${!isSupported ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-4xl">{deviceOption.icon}</div>
                  {connecting && (
                    <Loader2 className="w-5 h-5 text-sanctuary-400 animate-spin" />
                  )}
                </div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-50 mb-1">
                  {deviceOption.name}
                </h3>
                <p className="text-sm text-sanctuary-500">{deviceOption.description}</p>
                {deviceOption.type === 'trezor' && (
                  <p className="text-xs text-sanctuary-400 mt-1">Requires Trezor Suite</p>
                )}
              </button>
            ))}
          </div>

          {/* Info Box */}
          <div className="mt-6 p-4 surface-secondary/50 rounded-xl">
            <div className="flex items-start space-x-3">
              <Usb className="w-5 h-5 text-sanctuary-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-sanctuary-600 dark:text-sanctuary-400">
                <p className="font-medium mb-1">Connection Instructions:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Connect your hardware wallet via USB</li>
                  <li>Unlock your device with PIN if required</li>
                  <li>Select your device type above</li>
                  <li>Approve the connection request on your device</li>
                  <li>Verify transaction details on device screen before signing</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Trezor Info */}
          <div className="mt-4 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
            <div className="flex items-start space-x-3">
              <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100 mb-1">
                  Trezor Suite Required
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Trezor devices require <strong>Trezor Suite</strong> desktop app to be open and running.
                  You will need to switch between Trezor Suite (to confirm on your device) and this
                  app during the signing process. Make sure Trezor Suite is open before connecting.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-sanctuary-200 dark:border-sanctuary-800 flex justify-between items-center">
          <div className="flex items-center space-x-2 text-sm text-sanctuary-500">
            <Shield className="w-4 h-4" />
            <span>Your keys never leave the device</span>
          </div>
          <Button variant="ghost" onClick={onClose} disabled={connecting}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};
