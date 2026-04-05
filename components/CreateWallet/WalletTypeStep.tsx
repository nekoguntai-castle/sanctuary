/**
 * Step 1: Wallet Type Selection
 *
 * Allows user to choose between Single Signature and Multi Signature wallet types.
 */

import React from 'react';
import { WalletType } from '../../types';
import { SingleSigIcon, MultiSigIcon } from '../ui/CustomIcons';

interface WalletTypeStepProps {
  walletType: WalletType | null;
  setWalletType: (type: WalletType) => void;
}

export const WalletTypeStep: React.FC<WalletTypeStepProps> = ({ walletType, setWalletType }) => (
  <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-8">Select Wallet Topology</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
              onClick={() => setWalletType(WalletType.SINGLE_SIG)}
              className={`p-6 rounded-xl border-2 transition-all duration-200 flex flex-col items-center text-center space-y-4 active:scale-[0.98] ${walletType === WalletType.SINGLE_SIG ? 'border-emerald-600 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-900/20 shadow-md shadow-emerald-100 dark:shadow-emerald-900/20' : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400 hover:shadow-sm'}`}
          >
              <div className={`p-4 rounded-full ${walletType === WalletType.SINGLE_SIG ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400'}`}>
                  <SingleSigIcon className="w-12 h-12" />
              </div>
              <div>
                  <h3 className="text-lg font-medium">Single Signature</h3>
                  <p className="text-sm text-sanctuary-500 mt-2">Standard wallet. Requires one device to sign transactions. Simple and effective for daily use.</p>
              </div>
          </button>

          <button
              onClick={() => setWalletType(WalletType.MULTI_SIG)}
              className={`p-6 rounded-xl border-2 transition-all duration-200 flex flex-col items-center text-center space-y-4 active:scale-[0.98] ${walletType === WalletType.MULTI_SIG ? 'border-warning-600 bg-warning-50 dark:border-warning-400 dark:bg-warning-900/20 shadow-md shadow-warning-100 dark:shadow-warning-900/20' : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400 hover:shadow-sm'}`}
          >
              <div className={`p-4 rounded-full ${walletType === WalletType.MULTI_SIG ? 'bg-warning-100 dark:bg-warning-100 text-warning-600 dark:text-warning-600' : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400'}`}>
                  <MultiSigIcon className="w-12 h-12" />
              </div>
              <div>
                  <h3 className="text-lg font-medium">Multi Signature</h3>
                  <p className="text-sm text-sanctuary-500 mt-2">Enhanced security. Requires M of N devices to sign. Best for long-term cold storage and team custody.</p>
              </div>
          </button>
      </div>
  </div>
);
