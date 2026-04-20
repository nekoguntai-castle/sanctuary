import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

interface MonitoringHeaderProps {
  isRefreshing: boolean;
  onRefresh: () => void;
}

export const MonitoringHeader: React.FC<MonitoringHeaderProps> = ({
  isRefreshing,
  onRefresh,
}) => (
  <div className="mb-6">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
          Monitoring
        </h2>
        <p className="text-sanctuary-500">
          Access observability tools for metrics, logs, and tracing
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
        Refresh Status
      </Button>
    </div>
  </div>
);
