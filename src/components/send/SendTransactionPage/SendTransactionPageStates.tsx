import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '../../ui/Button';

interface SendTransactionErrorStateProps {
  error: string | null;
  onGoBack: () => void;
}

export function SendTransactionLoadingState() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-4" />
        <p className="text-sanctuary-500">Loading transaction data...</p>
      </div>
    </div>
  );
}

export function SendTransactionErrorState({
  error,
  onGoBack,
}: SendTransactionErrorStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          Failed to Load
        </h2>
        <p className="text-sanctuary-500 mb-4">
          {error || 'Unable to load wallet data'}
        </p>
        <Button variant="primary" onClick={onGoBack}>
          Go Back
        </Button>
      </div>
    </div>
  );
}
