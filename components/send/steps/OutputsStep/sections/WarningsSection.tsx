/**
 * Warnings Section
 *
 * Displays no-spendable-UTXOs warning and fee warnings.
 */

import React from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { UTXO } from '../../../../../types';

interface WarningsSectionProps {
  spendableCount: number;
  draftLocked: UTXO[];
  manuallyFrozen: UTXO[];
  feeWarnings: string[];
}

export const WarningsSection: React.FC<WarningsSectionProps> = ({
  spendableCount,
  draftLocked,
  manuallyFrozen,
  feeWarnings,
}) => {
  return (
    <>
      {/* No Spendable UTXOs Warning */}
      {spendableCount === 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
          <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
              No spendable funds available
            </p>
            <p className="text-sm text-rose-600 dark:text-rose-400 mt-1">
              {draftLocked.length > 0
                ? `All UTXOs are locked by pending transactions or drafts. Wait for pending transactions to confirm or delete drafts to release the funds.`
                : manuallyFrozen.length > 0
                  ? `All UTXOs are frozen. Unfreeze coins to make them spendable.`
                  : `This wallet has no confirmed UTXOs to spend.`
              }
            </p>
          </div>
        </div>
      )}

      {/* Fee Warnings */}
      {feeWarnings.length > 0 && (
        <div className="space-y-2">
          {feeWarnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-700 dark:text-amber-300">{warning}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
