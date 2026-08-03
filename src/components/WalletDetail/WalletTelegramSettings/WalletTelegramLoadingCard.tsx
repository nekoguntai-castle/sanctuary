export function WalletTelegramLoadingCard() {
  return (
    <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="animate-pulse flex space-x-4">
        <div className="h-5 w-5 bg-sanctuary-200 dark:bg-sanctuary-700 rounded"></div>
        <div className="flex-1 space-y-4 py-1">
          <div className="h-4 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-3/4"></div>
          <div className="h-4 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-1/2"></div>
        </div>
      </div>
    </div>
  );
}
