import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { DeviceAccountInput, DeviceConflictResponse } from '../../../src/api/devices';
import { accountNoun } from './formatters';

interface AccountComparisonSectionsProps {
  comparison: DeviceConflictResponse['comparison'];
}

export const AccountComparisonSections: React.FC<AccountComparisonSectionsProps> = ({ comparison }) => (
  <div className="space-y-3 mb-6">
    <NewAccountsSection accounts={comparison.newAccounts} />
    <MatchingAccountsSection accounts={comparison.matchingAccounts} />
    <ConflictingAccountsSection conflicts={comparison.conflictingAccounts} />
  </div>
);

const NewAccountsSection: React.FC<{ accounts: DeviceAccountInput[] }> = ({ accounts }) => {
  if (accounts.length === 0) {
    return null;
  }

  return (
    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
      <div className="flex items-center gap-2 mb-2">
        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          {accounts.length} New {accountNoun(accounts.length)} Can Be Added
        </span>
      </div>
      <DerivationPathList accounts={accounts} className="text-emerald-600 dark:text-emerald-400" />
    </div>
  );
};

const MatchingAccountsSection: React.FC<{ accounts: DeviceAccountInput[] }> = ({ accounts }) => {
  if (accounts.length === 0) {
    return null;
  }

  return (
    <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700">
      <div className="flex items-center gap-2 mb-2">
        <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
          {accounts.length} {accountNoun(accounts.length)} Already Exist
        </span>
      </div>
      <DerivationPathList accounts={accounts} className="text-blue-600 dark:text-blue-400" />
    </div>
  );
};

const ConflictingAccountsSection: React.FC<{
  conflicts: DeviceConflictResponse['comparison']['conflictingAccounts'];
}> = ({ conflicts }) => {
  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
        <span className="text-sm font-medium text-rose-700 dark:text-rose-300">
          {conflicts.length} Conflicting {accountNoun(conflicts.length)}
        </span>
      </div>
      <p className="text-xs text-rose-600 dark:text-rose-400 mb-2 ml-6">
        These paths have different xpubs than what's already registered. This could indicate a security issue.
      </p>
      <div className="space-y-1 ml-6">
        {conflicts.map((conflict, index) => (
          <div key={`${conflict.incoming.derivationPath}-${index}`} className="text-xs font-mono">
            <span className="text-rose-600 dark:text-rose-400">{conflict.incoming.derivationPath}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const DerivationPathList: React.FC<{ accounts: DeviceAccountInput[]; className: string }> = ({
  accounts,
  className,
}) => (
  <div className="space-y-1 ml-6">
    {accounts.map((account, index) => (
      <div key={`${account.derivationPath}-${index}`} className={`text-xs ${className} font-mono`}>
        {account.derivationPath}
      </div>
    ))}
  </div>
);
