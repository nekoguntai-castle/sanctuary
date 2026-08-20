import React from 'react';
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
