import React from 'react';
import { CheckCircle } from 'lucide-react';
import { WalletType, type Device, type DeviceAccount } from '../../types';
import { getDeviceIcon } from '../ui/CustomIcons';

interface SignerDeviceCardProps {
  device: Device;
  walletType: WalletType;
  isSelected: boolean;
  onToggle: (id: string) => void;
  getDisplayAccount: (device: Device, walletType: WalletType) => DeviceAccount | null;
}

export const SignerDeviceCard: React.FC<SignerDeviceCardProps> = ({
  device,
  walletType,
  isSelected,
  onToggle,
  getDisplayAccount,
}) => {
  const displayAccount = getDisplayAccount(device, walletType);

  return (
    <button
      type="button"
      aria-label={`Select signer ${device.label}, ${device.fingerprint}`}
      aria-pressed={isSelected}
      onClick={() => onToggle(device.id)}
      className={`w-full text-left p-4 rounded-lg border flex items-center justify-between transition-all ${
        isSelected
          ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500'
          : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
      }`}
    >
      <div className="min-w-0 flex items-center space-x-3">
        <div className="text-sanctuary-500">{getDeviceIcon(device.type, 'w-6 h-6')}</div>
        <div className="min-w-0 break-words">
          <span className="block font-medium text-sm break-words">{device.label}</span>
          <p className="text-xs text-sanctuary-400 font-mono break-all">{device.fingerprint}</p>
          {displayAccount && (
            <p className="text-[10px] text-sanctuary-400 font-mono mt-0.5 break-all">
              {displayAccount.derivationPath}
            </p>
          )}
        </div>
      </div>
      {isSelected && <CheckCircle className="w-5 h-5 shrink-0 text-sanctuary-800 dark:text-sanctuary-200" />}
    </button>
  );
};
