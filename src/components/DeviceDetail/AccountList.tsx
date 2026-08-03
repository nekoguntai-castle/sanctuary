/**
 * AccountList Component
 *
 * Displays a list of device accounts with their details.
 */

import React from 'react';
import { Check } from 'lucide-react';
import type { DeviceAccount } from '../../types';
import { getAccountTypeInfo } from './accountTypes';

interface AccountListProps {
  accounts: DeviceAccount[];
  className?: string;
}

export const AccountList: React.FC<AccountListProps> = ({ accounts, className = '' }) => {
  if (accounts.length === 0) {
    return (
      <div
        className={`surface-elevated rounded-lg p-8 text-center text-sanctuary-400 border border-dashed border-sanctuary-300 dark:border-sanctuary-700 ${className}`}
      >
        No accounts have been added to this device yet.
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {accounts.map((account, idx) => {
        const typeInfo = getAccountTypeInfo(account);
        return (
          <div
            key={account.id || idx}
            className="surface-elevated rounded-lg p-4 border border-sanctuary-200 dark:border-sanctuary-800"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h4 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  {typeInfo.title}
                </h4>
                <p className="text-xs text-sanctuary-500">{typeInfo.description}</p>
              </div>
              {typeInfo.recommended && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-success-100 dark:bg-success-500/10 text-success-700 dark:text-success-300 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Recommended
                </span>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-sanctuary-500 w-16">Path:</span>
                <code className="text-xs font-mono text-sanctuary-700 dark:text-sanctuary-300">
                  {account.derivationPath}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-sanctuary-500 w-16">XPub:</span>
                <code className="text-xs font-mono text-sanctuary-700 dark:text-sanctuary-300 truncate max-w-[300px]">
                  {account.xpub}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-sanctuary-500 w-16">Address:</span>
                <span className="text-xs text-sanctuary-400">{typeInfo.addressPrefix}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
