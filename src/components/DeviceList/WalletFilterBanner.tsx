import type { WalletFilter } from './types';

export function WalletFilterBanner({
  effectiveWalletFilter,
  sortedDeviceCount,
  exclusiveDeviceCount,
  onClear,
}: {
  effectiveWalletFilter: WalletFilter;
  sortedDeviceCount: number;
  exclusiveDeviceCount: number;
  onClear: () => void;
}) {
  if (effectiveWalletFilter !== 'all' && effectiveWalletFilter !== 'unassigned') {
    return (
      <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 text-sm">
        <span className="text-primary-800 dark:text-primary-700">
          Showing {sortedDeviceCount} device{sortedDeviceCount !== 1 ? 's' : ''} linked to this wallet.
          {exclusiveDeviceCount > 0 && (
            <> <strong>{exclusiveDeviceCount}</strong> {exclusiveDeviceCount === 1 ? 'is' : 'are'} exclusive to this wallet.</>
          )}
        </span>
        <button
          onClick={onClear}
          className="text-xs text-primary-600 dark:text-primary-600 hover:underline ml-4 flex-shrink-0"
        >
          Clear filter
        </button>
      </div>
    );
  }

  if (effectiveWalletFilter === 'unassigned') {
    return (
      <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800 border border-sanctuary-200 dark:border-sanctuary-700 text-sm">
        <span className="text-sanctuary-600 dark:text-sanctuary-400">
          Showing {sortedDeviceCount} unassigned device{sortedDeviceCount !== 1 ? 's' : ''} (not linked to any wallet).
        </span>
        <button
          onClick={onClear}
          className="text-xs text-sanctuary-500 hover:underline ml-4 flex-shrink-0"
        >
          Clear filter
        </button>
      </div>
    );
  }

  return null;
}
