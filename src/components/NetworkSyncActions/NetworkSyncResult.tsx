import React from 'react';
import { X } from 'lucide-react';
import type { NetworkSyncResult as NetworkSyncResultValue } from './types';

interface NetworkSyncResultProps {
  result: NetworkSyncResultValue | null;
}

// `success` and `warning` invert per mode and declare no 300/400 shade, so the
// base class is correct in both; `rose` is standard Tailwind and keeps its
// explicit dark variant.
const getResultClassName = (type: NetworkSyncResultValue['type']) => {
  if (type === 'success') {
    return 'text-sm text-success-600';
  }

  if (type === 'warning') {
    return 'text-sm text-warning-600';
  }

  return 'text-sm text-rose-600 dark:text-rose-400';
};

interface CompactNetworkSyncResultProps extends NetworkSyncResultProps {
  onDismiss: () => void;
}

/**
 * The compact header has no room for an inline message, so the result floats
 * under the header's action row (the nearest positioned ancestor): full row
 * width on phones, right-aligned from `sm` up. A polite live region must exist
 * before its text changes, so the sr-only status region is always mounted and
 * announces non-error outcomes; errors interrupt through the panel's alert
 * role instead.
 */
export const CompactNetworkSyncResult: React.FC<CompactNetworkSyncResultProps> = ({
  result,
  onDismiss,
}) => {
  const isError = result?.type === 'error';

  return (
    <>
      <div role="status" className="sr-only">
        {result && !isError ? result.message : ''}
      </div>
      {result && (
        <div
          role={isError ? 'alert' : undefined}
          className="absolute left-0 right-0 top-full z-20 mt-2 flex items-start gap-2 rounded-lg border border-sanctuary-200 p-3 shadow-lg surface-elevated dark:border-sanctuary-800 sm:left-auto sm:w-72"
        >
          <p className={`min-w-0 flex-1 break-words ${getResultClassName(result.type)}`}>
            {result.message}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss sync result"
            className="rounded p-0.5 text-sanctuary-500 hover:bg-sanctuary-100 hover:text-sanctuary-700 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
};

export const NetworkSyncResult: React.FC<NetworkSyncResultProps> = ({ result }) => {
  if (!result) {
    return null;
  }

  return (
    <span className={getResultClassName(result.type)}>
      {result.message}
    </span>
  );
};
