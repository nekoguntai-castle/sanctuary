import React from 'react';
import { Plus, Loader2, Check } from 'lucide-react';
import { DeviceAccount as ParsedDeviceAccount } from '../../../services/deviceParsers';

export interface AccountConflict {
  existingAccounts: import('../../../types').DeviceAccount[];
  newAccounts: ParsedDeviceAccount[];
  matchingAccounts: ParsedDeviceAccount[];
}

interface ImportReviewProps {
  parsedAccounts: ParsedDeviceAccount[];
  selectedParsedAccounts: Set<number>;
  setSelectedParsedAccounts: (selected: Set<number>) => void;
  accountConflict: AccountConflict | null;
  addAccountLoading: boolean;
  onAddParsedAccounts: () => void;
}

export const ImportReview: React.FC<ImportReviewProps> = ({
  parsedAccounts,
  selectedParsedAccounts,
  setSelectedParsedAccounts,
  accountConflict,
  addAccountLoading,
  onAddParsedAccounts,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300">
          Select accounts to add:
        </p>
        <span className="text-xs text-sanctuary-400">
          {selectedParsedAccounts.size} of {parsedAccounts.length}
        </span>
      </div>

      {accountConflict && accountConflict.matchingAccounts.length > 0 && (
        <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-xs text-blue-600 dark:text-blue-400">
          <Check className="w-3 h-3 inline mr-1" />
          {accountConflict.matchingAccounts.length} account(s) already exist
        </div>
      )}

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {parsedAccounts.map((account, index) => {
          const isSelected = selectedParsedAccounts.has(index);
          return (
            <label
              key={index}
              className={`block p-3 rounded-lg border cursor-pointer transition-all ${
                isSelected
                  ? 'border-sanctuary-500 bg-sanctuary-50 dark:bg-sanctuary-800'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    const newSelected = new Set(selectedParsedAccounts);
                    if (isSelected) {
                      newSelected.delete(index);
                    } else {
                      newSelected.add(index);
                    }
                    setSelectedParsedAccounts(newSelected);
                  }}
                  className="mt-1 rounded border-sanctuary-300"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      account.purpose === 'multisig'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>
                      {account.purpose === 'multisig' ? 'Multisig' : 'Single-sig'}
                    </span>
                  </div>
                  <code className="text-xs font-mono text-sanctuary-600 dark:text-sanctuary-300">
                    {account.derivationPath}
                  </code>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <button
        onClick={onAddParsedAccounts}
        disabled={selectedParsedAccounts.size === 0 || addAccountLoading}
        className="w-full px-4 py-2.5 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {addAccountLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <Plus className="w-4 h-4" />
            Add {selectedParsedAccounts.size} Account{selectedParsedAccounts.size !== 1 ? 's' : ''}
          </>
        )}
      </button>
    </div>
  );
};
