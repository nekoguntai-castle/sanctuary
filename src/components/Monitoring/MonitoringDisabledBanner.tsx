import React from 'react';
import { Info } from 'lucide-react';

interface MonitoringDisabledBannerProps {
  show: boolean;
}

export const MonitoringDisabledBanner: React.FC<MonitoringDisabledBannerProps> = ({ show }) => {
  if (!show) {
    return null;
  }

  return (
    <div className="mb-6 p-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
      <div className="flex items-start space-x-3">
        <Info className="w-5 h-5 text-warning-600 dark:text-warning-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-medium text-warning-800 dark:text-warning-200">
            Monitoring Stack Not Enabled
          </h3>
          <p className="text-sm text-warning-700 dark:text-warning-300 mt-1">
            To enable monitoring, start Sanctuary with the monitoring compose file:
          </p>
          <code className="block mt-2 text-xs font-mono bg-warning-100 dark:bg-warning-900/40 p-2 rounded text-warning-800 dark:text-warning-200">
            docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
          </code>
        </div>
      </div>
    </div>
  );
};
