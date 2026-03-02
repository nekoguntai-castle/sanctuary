/**
 * Summary Bar
 *
 * Displays available balance, fee, and max sendable amount.
 */

import React from 'react';

interface SummaryBarProps {
  effectiveAvailable: number;
  estimatedFee: number;
  feeRate: number;
  maxSendable: number;
  format: (sats: number) => string;
}

export const SummaryBar: React.FC<SummaryBarProps> = ({
  effectiveAvailable,
  estimatedFee,
  feeRate,
  maxSendable,
  format,
}) => {
  return (
    <div className="surface-elevated p-3 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-sanctuary-500">Available: </span>
            <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {format(effectiveAvailable)}
            </span>
          </div>
          <div>
            <span className="text-sanctuary-500">Fee: </span>
            <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {format(estimatedFee)}
            </span>
            <span className="text-xs text-sanctuary-400 ml-1">
              ({feeRate} sat/vB)
            </span>
          </div>
        </div>
        <div>
          <span className="text-sanctuary-500">Max: </span>
          <span className="font-semibold text-primary-600 dark:text-primary-400">
            {format(maxSendable)}
          </span>
        </div>
      </div>
    </div>
  );
};
