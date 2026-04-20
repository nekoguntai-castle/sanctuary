import { Radio, RefreshCw } from 'lucide-react';
import { Button } from '../../ui/Button';

interface WebSocketCardHeaderProps {
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function WebSocketCardHeader({
  isRefreshing,
  onRefresh,
}: WebSocketCardHeaderProps) {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">WebSocket Status</h3>
            <p className="text-sm text-sanctuary-500">Real-time connection monitoring</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </div>
  );
}
