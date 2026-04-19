import { AlertCircle, Check } from 'lucide-react';

export function NodeConfigStatusMessages({
  error,
  success,
}: {
  error: string | null;
  success: boolean;
}) {
  if (!error && !success) return null;

  return (
    <div className="space-y-2">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mr-2 flex-shrink-0" />
          <span className="text-sm text-red-800 dark:text-red-300">{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center animate-fade-in">
          <Check className="w-4 h-4 text-green-600 dark:text-green-400 mr-2 flex-shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-300">Node configuration saved successfully</span>
        </div>
      )}
    </div>
  );
}
