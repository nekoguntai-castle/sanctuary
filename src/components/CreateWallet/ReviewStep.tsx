/**
 * Step 4: Review Wallet Details
 *
 * Displays a summary of all wallet configuration before creation.
 */

import React from 'react';
import { Shield } from 'lucide-react';
import { WalletType, Device } from '../../types';
import { formatNetworkTitle, getNetworkColorClass } from '../../app/networks';
import type { ScriptType, Network, SelectedSigner } from './types';

interface ReviewStepProps {
  walletName: string;
  walletType: WalletType;
  network: Network;
  scriptType: ScriptType;
  quorumM: number;
  selectedSigners: SelectedSigner[];
  availableDevices: Device[];
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  walletName,
  walletType,
  network,
  scriptType,
  quorumM,
  selectedSigners,
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
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getNetworkColorClass(network, 'borderedBadge')}`}>
                          {formatNetworkTitle(network)}
                      </span>
                  </dd>
              </div>
              <div className="px-6 py-4 grid grid-cols-2 gap-4">
                 <dt className="text-sm text-sanctuary-500">Script</dt>
                 <dd className="text-sm font-medium capitalize">{scriptType.replace('_', ' ')}</dd>
              </div>
              {walletType === WalletType.MULTI_SIG && (
                  <div className="px-6 py-4 grid grid-cols-2 gap-4">
                     <dt className="text-sm text-sanctuary-500">Quorum</dt>
                     <dd className="text-sm font-medium">{quorumM} of {selectedSigners.length}</dd>
                  </div>
              )}
              <div className="px-6 py-4">
                  <dt className="text-sm text-sanctuary-500 mb-2">Signers</dt>
                  <dd className="text-sm font-medium space-y-1">
                      {selectedSigners.map((signer, signerIndex) => {
                          const dev = availableDevices.find(d => d.id === signer.deviceId);
                          const account = dev?.accounts?.find(candidate => candidate.id === signer.deviceAccountId);
                          return (
                              <div key={signer.deviceId} className="flex items-start">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success-500 mr-2"></span>
                                  <span>
                                    {signerIndex + 1}. {dev?.label} ({dev?.type})
                                    <span className="block text-xs text-sanctuary-400 font-mono">
                                      {account?.derivationPath}
                                    </span>
                                  </span>
                              </div>
                          );
                      })}
                  </dd>
              </div>
          </dl>
      </div>
  </div>
);
