/**
 * Step 2: Signer Selection
 *
 * Displays compatible devices for the selected wallet type and allows
 * the user to select signers. Shows warnings for incompatible devices.
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WalletType, Device, DeviceAccount } from '../../types';
import { SignerCompatibilityWarning } from './SignerCompatibilityWarning';
import { SignerDeviceCard } from './SignerDeviceCard';
import {
  SignerSelectionEmptyState,
  SignerSelectionHint,
} from './SignerSelectionMessages';
import {
  getSignerAccountTypeLabel,
  getSignerSelectionDescription,
} from './signerSelectionData';

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
  const accountTypeLabel = getSignerAccountTypeLabel(walletType);

  return (
    <div className="space-y-6 animate-fade-in">
        <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">Select Signers</h2>
        <p className="text-center text-sanctuary-500 mb-6">
            {getSignerSelectionDescription(walletType)}
        </p>

        <SignerCompatibilityWarning
          incompatibleDevices={incompatibleDevices}
          accountTypeLabel={accountTypeLabel}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
            {compatibleDevices.map(device => (
                <SignerDeviceCard
                  key={device.id}
                  device={device}
                  walletType={walletType}
                  isSelected={selectedDeviceIds.has(device.id)}
                  onToggle={toggleDevice}
                  getDisplayAccount={getDisplayAccount}
                />
            ))}
             {/* Add New Device Option */}
             <button
                onClick={() => navigate('/devices/connect')}
                className="p-4 rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700 flex items-center justify-center text-sanctuary-500 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors"
             >
                <Plus className="w-5 h-5 mr-2" />
                <span className="text-sm font-medium">Connect New Device</span>
             </button>
        </div>

        {/* Helpful message when no compatible devices */}
        {compatibleDevices.length === 0 && (
          <SignerSelectionEmptyState accountTypeLabel={accountTypeLabel} />
        )}

        {compatibleDevices.length > 0 && (
          <SignerSelectionHint accountTypeLabel={accountTypeLabel} />
        )}
    </div>
  );
};
