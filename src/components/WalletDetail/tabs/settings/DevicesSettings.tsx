/**
 * DevicesSettings - Hardware device list for wallet settings
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { getDeviceIcon } from '../../../ui/CustomIcons';
import { WalletType } from '../../../../types';
import type { Wallet, Device } from '../../../../types';

interface DevicesSettingsProps {
  wallet: Wallet;
  devices: Device[];
}

export const DevicesSettings: React.FC<DevicesSettingsProps> = ({ wallet, devices }) => {
  const navigate = useNavigate();

  return (
    <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
      <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Hardware Devices</h3>
      {devices.length > 0 ? (
        <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
          {devices.map(d => {
            const hasAccountMismatch = d.accountMissing;
            return (
              <li
                key={d.id}
                onClick={() => navigate(`/devices/${d.id}`)}
                className={`py-3 flex justify-between items-center cursor-pointer hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 -mx-2 px-2 rounded-lg transition-colors ${hasAccountMismatch ? 'border-l-4 border-rose-500' : ''}`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${hasAccountMismatch ? 'bg-rose-100 dark:bg-rose-900/30' : 'surface-secondary'}`}>
                    {getDeviceIcon(d.type, `w-5 h-5 ${hasAccountMismatch ? 'text-rose-600 dark:text-rose-400' : 'text-sanctuary-600 dark:text-sanctuary-400'}`)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{d.label}</p>
                    <p className="text-xs text-sanctuary-500">{d.type} &bull; {d.fingerprint}</p>
                    {hasAccountMismatch ? (
                      <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                        Missing {wallet.type === WalletType.MULTI_SIG ? 'multisig' : 'single-sig'} account for {wallet.scriptType} - cannot sign
                      </p>
                    ) : (
                      <p className="text-xs font-mono text-sanctuary-400">{d.derivationPath}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasAccountMismatch ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-rose-600 text-white">
                      Cannot Sign
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-zen-indigo text-white">
                      Active
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-sanctuary-400" />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-sanctuary-500">No hardware devices associated with this wallet.</p>
      )}
    </div>
  );
};
