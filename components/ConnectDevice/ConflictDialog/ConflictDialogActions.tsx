import React from 'react';
import { ExternalLink, GitMerge, Loader2 } from 'lucide-react';
import type { DeviceConflictResponse } from '../../../src/api/devices';
import { Button } from '../../ui/Button';
import { accountNoun } from './formatters';

interface ConflictDialogActionsProps {
  comparison: DeviceConflictResponse['comparison'];
  merging: boolean;
  error: string | null;
  onMerge: () => void;
  onViewExisting: () => void;
  onCancel: () => void;
}

export const ConflictDialogActions: React.FC<ConflictDialogActionsProps> = ({
  comparison,
  merging,
  error,
  onMerge,
  onViewExisting,
  onCancel,
}) => {
  const hasNewAccounts = comparison.newAccounts.length > 0;
  const hasConflictingAccounts = comparison.conflictingAccounts.length > 0;

  return (
    <>
      <div className="flex flex-col gap-2">
        {hasNewAccounts && (
          <Button onClick={onMerge} disabled={merging || hasConflictingAccounts} className="w-full">
            <MergeButtonContent newAccountCount={comparison.newAccounts.length} merging={merging} />
          </Button>
        )}

        <button
          onClick={onViewExisting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 text-sm font-medium hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          View Existing Device
        </button>

        <button
          onClick={onCancel}
          className="w-full px-4 py-2 text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
        >
          Cancel
        </button>
      </div>

      {error && <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

      {hasConflictingAccounts && (
        <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-3">
          Cannot merge while there are conflicting accounts. Please resolve the conflicts first.
        </p>
      )}
    </>
  );
};

const MergeButtonContent: React.FC<{ newAccountCount: number; merging: boolean }> = ({ newAccountCount, merging }) => {
  if (merging) {
    return (
      <>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Merging...
      </>
    );
  }

  return (
    <>
      <GitMerge className="w-4 h-4 mr-2" />
      Merge {newAccountCount} New {accountNoun(newAccountCount)}
    </>
  );
};
