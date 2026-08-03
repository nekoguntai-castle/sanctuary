import React from 'react';
import type { NetworkSyncResult as NetworkSyncResultValue } from './types';

interface NetworkSyncResultProps {
  result: NetworkSyncResultValue | null;
}

const getResultClassName = (type: NetworkSyncResultValue['type']) => {
  if (type === 'success') {
    return 'text-sm text-success-600 dark:text-success-400';
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
