import { ArrowLeft } from 'lucide-react';
import { Button } from '../../ui/Button';
import { WizardNavigation } from '../WizardNavigation';
import type { WizardStep } from '../../../contexts/send';
import type { ReactNode } from 'react';

interface WizardShellProps {
  children: ReactNode;
  currentStep: WizardStep;
  error: string | null;
  onCancel: () => void;
  onClearError: () => void;
  walletName: string;
}

function WizardError({
  error,
  onClearError,
}: {
  error: string;
  onClearError: () => void;
}) {
  return (
    <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      <button
        onClick={onClearError}
        className="text-xs text-red-600 dark:text-red-400 underline mt-1"
      >
        Dismiss
      </button>
    </div>
  );
}

function WizardHeader({
  onCancel,
  walletName,
}: {
  onCancel: () => void;
  walletName: string;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        <ArrowLeft className="w-4 h-4 mr-2" />
        Cancel
      </Button>
      <h1 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
        Send from {walletName}
      </h1>
      <div className="w-20" />
    </div>
  );
}

export function WizardShell({
  children,
  currentStep,
  error,
  onCancel,
  onClearError,
  walletName,
}: WizardShellProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <WizardHeader onCancel={onCancel} walletName={walletName} />

      {error && <WizardError error={error} onClearError={onClearError} />}

      {currentStep !== 'review' && (
        <div className="mb-8">
          <WizardNavigation hideButtons />
        </div>
      )}

      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        {children}
      </div>
    </div>
  );
}
