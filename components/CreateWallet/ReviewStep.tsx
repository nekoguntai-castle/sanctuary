/**
 * Step 4: Review Wallet Details
 *
 * Displays a summary of all wallet configuration before creation.
 */

import React from 'react';
import { Shield } from 'lucide-react';
import { WalletType, Device } from '../../types';
import type { ScriptType, Network } from './types';

interface ReviewStepProps {
  walletName: string;
  walletType: WalletType;
  network: Network;
  scriptType: ScriptType;
  quorumM: number;
  selectedDeviceIds: Set<string>;
  availableDevices: Device[];
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  walletName,
  walletType,
  network,
  scriptType,
  quorumM,
  selectedDeviceIds,
  availableDevices,
}) => (
  <div className="space-y-6 animate-fade-in max-w-lg mx-auto text-center">
      <div className="mx-auto w-16 h-16 surface-secondary rounded-full flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-sanctuary-600 dark:text-sanctuary-300" />
      </div>
      <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Review Wallet Details</h2>

      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden text-left">
          <div className="px-6 py-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
              <h3 className="text-lg font-medium">{walletName}</h3>
          </div>
          <dl className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
              <div className="px-6 py-4 grid grid-cols-2 gap-4">
                  <dt className="text-sm text-sanctuary-500">Type</dt>
                  <dd className="text-sm font-medium">{walletType}</dd>
              </div>
              <div className="px-6 py-4 grid grid-cols-2 gap-4">
                  <dt className="text-sm text-sanctuary-500">Network</dt>
                  <dd className="text-sm font-medium">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          network === 'mainnet'
                              ? 'bg-mainnet-100/50 dark:bg-mainnet-900/20 text-mainnet-700 dark:text-mainnet-300 border border-mainnet-200 dark:border-mainnet-700'
                              : network === 'testnet'
                              ? 'bg-testnet-100/50 dark:bg-testnet-900/20 text-testnet-700 dark:text-testnet-300 border border-testnet-200 dark:border-testnet-700'
                              : 'bg-signet-100/50 dark:bg-signet-900/20 text-signet-700 dark:text-signet-300 border border-signet-200 dark:border-signet-700'
                      }`}>
                          {network.charAt(0).toUpperCase() + network.slice(1)}
                      </span>
                  </dd>
              </div>
              {walletType === WalletType.SINGLE_SIG ? (
                  <div className="px-6 py-4 grid grid-cols-2 gap-4">
                     <dt className="text-sm text-sanctuary-500">Script</dt>
                     <dd className="text-sm font-medium capitalize">{scriptType.replace('_', ' ')}</dd>
                  </div>
              ) : (
                  <div className="px-6 py-4 grid grid-cols-2 gap-4">
                     <dt className="text-sm text-sanctuary-500">Quorum</dt>
                     <dd className="text-sm font-medium">{quorumM} of {selectedDeviceIds.size}</dd>
                  </div>
              )}
              <div className="px-6 py-4">
                  <dt className="text-sm text-sanctuary-500 mb-2">Signers</dt>
                  <dd className="text-sm font-medium space-y-1">
                      {Array.from(selectedDeviceIds).map(id => {
                          const dev = availableDevices.find(d => d.id === id);
                          return (
                              <div key={id} className="flex items-center">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success-500 mr-2"></span>
                                  {dev?.label} ({dev?.type})
                              </div>
                          );
                      })}
                  </dd>
              </div>
          </dl>
      </div>
  </div>
);
