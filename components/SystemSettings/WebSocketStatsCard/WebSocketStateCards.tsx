import { AlertCircle } from 'lucide-react';

export function WebSocketLoadingCard() {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-1/3"></div>
        <div className="h-20 bg-sanctuary-200 dark:bg-sanctuary-700 rounded"></div>
      </div>
    </div>
  );
}

export function WebSocketErrorCard({ error }: { error: string }) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-6">
      <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
        <AlertCircle className="w-5 h-5" />
        <span>{error}</span>
      </div>
    </div>
  );
}
