import React from 'react';
import { AlertCircle } from 'lucide-react';

interface MonitoringErrorBannerProps {
  error: string | null;
}

export const MonitoringErrorBanner: React.FC<MonitoringErrorBannerProps> = ({ error }) => {
  if (!error) {
    return null;
  }

  return (
    <div className="mb-6 p-4 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
      <div className="flex items-center space-x-2 text-rose-700 dark:text-rose-300">
        <AlertCircle className="w-5 h-5" />
        <span>{error}</span>
      </div>
    </div>
  );
};
