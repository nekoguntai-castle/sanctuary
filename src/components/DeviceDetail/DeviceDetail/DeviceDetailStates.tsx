import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../../ui/Button';

export function DeviceDetailLoadingState() {
  return <div className="p-8 text-center text-sanctuary-400">Loading device...</div>;
}

export function DeviceDetailNotFoundState() {
  return <div className="p-8 text-center text-sanctuary-400">Device not found.</div>;
}

export function DeviceDetailLoadErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="p-8 text-center">
      <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg p-6 max-w-md mx-auto">
        <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-rose-900 dark:text-rose-100 mb-2">Failed to Load Device</h3>
        <p className="text-rose-700 dark:text-rose-300 mb-4">{error}</p>
        <Button onClick={onRetry} variant="primary">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    </div>
  );
}
