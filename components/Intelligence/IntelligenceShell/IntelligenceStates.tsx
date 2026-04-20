import { Brain } from 'lucide-react';
import { SanctuarySpinner } from '../../ui/CustomIcons';

export function IntelligenceLoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <SanctuarySpinner size="lg" />
    </div>
  );
}

export function IntelligenceEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sanctuary-500 dark:text-sanctuary-400">
      <Brain className="h-10 w-10" />
      <p className="text-sm">No wallets available for intelligence analysis.</p>
    </div>
  );
}
