/**
 * Step 2: Signer Selection
 *
 * Displays compatible devices for the selected wallet type and allows
 * the user to select signers. Shows warnings for incompatible devices.
 */

import React from 'react';
import { Plus, CheckCircle, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WalletType, Device, DeviceAccount } from '../../types';
import { getDeviceIcon } from '../ui/CustomIcons';

interface SignerSelectionStepProps {
  walletType: WalletType;
  compatibleDevices: Device[];
  incompatibleDevices: Device[];
  selectedDeviceIds: Set<string>;
  toggleDevice: (id: string) => void;
  getDisplayAccount: (device: Device, type: WalletType) => DeviceAccount | null;
}

export const SignerSelectionStep: React.FC<SignerSelectionStepProps> = ({
  walletType,
  compatibleDevices,
  incompatibleDevices,
  selectedDeviceIds,
  toggleDevice,
  getDisplayAccount,
}) => {
  const navigate = useNavigate();
  const accountTypeLabel = walletType === WalletType.MULTI_SIG ? 'multisig' : 'single-sig';

  return (
    <div className="space-y-6 animate-fade-in">
        <h2 className="text-xl font-light text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">Select Signers</h2>
        <p className="text-center text-sanctuary-500 mb-6">
            {walletType === WalletType.SINGLE_SIG ? "Select the device that will control this wallet." : "Select the devices that will participate in this multisig quorum."}
        </p>

        {/* Warning about incompatible devices */}
        {incompatibleDevices.length > 0 && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                {incompatibleDevices.length} device{incompatibleDevices.length !== 1 ? 's' : ''} hidden
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                {incompatibleDevices.map(d => d.label).join(', ')} {incompatibleDevices.length === 1 ? 'doesn\'t' : 'don\'t'} have a {accountTypeLabel} derivation path.
                <button
                  onClick={() => navigate(`/devices/${incompatibleDevices[0].id}`)}
                  className="underline hover:no-underline ml-1"
                >
                  Add derivation path
                </button>
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
            {compatibleDevices.map(device => {
                const isSelected = selectedDeviceIds.has(device.id);
                const displayAccount = getDisplayAccount(device, walletType);
                return (
                    <div
                        key={device.id}
                        onClick={() => toggleDevice(device.id)}
                        className={`cursor-pointer p-4 rounded-xl border flex items-center justify-between transition-all ${isSelected ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500' : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'}`}
                    >
                        <div className="flex items-center space-x-3">
                            <div className="text-sanctuary-500">{getDeviceIcon(device.type, "w-6 h-6")}</div>
                            <div>
                                <h4 className="font-medium text-sm">{device.label}</h4>
                                <p className="text-xs text-sanctuary-400 font-mono">{device.fingerprint}</p>
                                {displayAccount && (
                                  <p className="text-[10px] text-sanctuary-400 font-mono mt-0.5">
                                    {displayAccount.derivationPath}
                                  </p>
                                )}
                            </div>
                        </div>
                        {isSelected && <CheckCircle className="w-5 h-5 text-sanctuary-800 dark:text-sanctuary-200" />}
                    </div>
                );
            })}
             {/* Add New Device Option */}
             <button
                onClick={() => navigate('/devices/connect')}
                className="p-4 rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700 flex items-center justify-center text-sanctuary-500 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors"
             >
                <Plus className="w-5 h-5 mr-2" />
                <span className="text-sm font-medium">Connect New Device</span>
             </button>
        </div>

        {/* Helpful message when no compatible devices */}
        {compatibleDevices.length === 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-sanctuary-500">
              No devices with {accountTypeLabel} accounts found.
            </p>
            <p className="text-xs text-sanctuary-400 mt-1">
              Connect a new device or add a {accountTypeLabel} derivation path to an existing device.
            </p>
          </div>
        )}

        {compatibleDevices.length > 0 && (
          <div className="text-center text-xs text-sanctuary-400 mt-2">
              Don't see your device? It may need a {accountTypeLabel} derivation path added.
          </div>
        )}
    </div>
  );
};
