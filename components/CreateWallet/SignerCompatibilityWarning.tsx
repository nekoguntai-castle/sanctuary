import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Device } from '../../types';
import {
  getHiddenDeviceDescription,
  getHiddenDeviceSummary,
} from './signerSelectionData';

interface SignerCompatibilityWarningProps {
  incompatibleDevices: Device[];
  accountTypeLabel: string;
}

export const SignerCompatibilityWarning: React.FC<SignerCompatibilityWarningProps> = ({
  incompatibleDevices,
  accountTypeLabel,
}) => {
  const navigate = useNavigate();
  const firstDeviceId = incompatibleDevices[0]?.id;

  if (incompatibleDevices.length === 0) return null;

  return (
    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
          {getHiddenDeviceSummary(incompatibleDevices.length)}
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
          {getHiddenDeviceDescription(incompatibleDevices, accountTypeLabel)}
          <button
            onClick={() => firstDeviceId && navigate(`/devices/${firstDeviceId}`)}
            className="underline hover:no-underline ml-1"
          >
            Add derivation path
          </button>
        </p>
      </div>
    </div>
  );
};
