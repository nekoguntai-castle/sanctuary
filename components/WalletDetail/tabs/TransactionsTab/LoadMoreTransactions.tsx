import React from 'react';

interface LoadMoreTransactionsProps {
  hasMoreTx: boolean;
  transactionsCount: number;
  loadingMoreTx: boolean;
  onLoadMore: () => void;
}

export const LoadMoreTransactions: React.FC<LoadMoreTransactionsProps> = ({
  hasMoreTx,
  transactionsCount,
  loadingMoreTx,
  onLoadMore,
}) => {
  if (!hasMoreTx || transactionsCount === 0) {
    return null;
  }

  return (
    <div className="mt-4 text-center">
      <button
        onClick={onLoadMore}
        disabled={loadingMoreTx}
        className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50"
      >
        {loadingMoreTx ? (
          <span className="flex items-center justify-center">
            <span className="animate-spin rounded-full h-4 w-4 border border-primary-500 border-t-transparent mr-2" />
            Loading...
          </span>
        ) : (
          `Load More (${transactionsCount} shown)`
        )}
      </button>
    </div>
  );
};
