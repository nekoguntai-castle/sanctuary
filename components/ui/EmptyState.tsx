import React from 'react';
import { Wallet, Cpu, Plus } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  compact = false,
}) => {
  const handleAction = () => {
    if (actionTo) {
      window.location.hash = actionTo;
    } else if (onAction) {
      onAction();
    }
  };

  if (compact) {
    return (
      <div className="py-3 px-4 text-center">
        <p className="text-xs text-sanctuary-400 dark:text-sanctuary-500">{title}</p>
        {actionLabel && (
          <button
            onClick={handleAction}
            className="mt-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            {actionLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center animate-fade-in-up">
      {icon && (
        <div className="mb-5 p-5 rounded-2xl border-2 border-dashed border-primary-200 dark:border-primary-800/50 bg-primary-50/30 dark:bg-primary-900/10">
          {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
            className: ((icon as React.ReactElement<{ className?: string }>).props.className || '').replace(/text-sanctuary-\d+/g, '') + ' text-primary-400 dark:text-primary-500',
          }) : icon}
        </div>
      )}
      <h4 className="text-base font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
        {title}
      </h4>
      {description && (
        <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-sm mb-4">
          {description}
        </p>
      )}
      {actionLabel && (
        <Button variant="secondary" size="sm" onClick={handleAction}>
          <Plus className="w-4 h-4 mr-1.5" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

export const WalletEmptyState: React.FC<{ network?: string }> = ({ network = 'mainnet' }) => (
  <EmptyState
    icon={<Wallet className="w-8 h-8 text-sanctuary-400 dark:text-sanctuary-500" />}
    title={`No ${network} wallets yet`}
    description={`Create or import a ${network} wallet to start managing your Bitcoin.`}
    actionLabel="Create Wallet"
    actionTo="/wallets/create"
  />
);

export const DeviceEmptyState: React.FC = () => (
  <EmptyState
    icon={<Cpu className="w-8 h-8 text-sanctuary-400 dark:text-sanctuary-500" />}
    title="No devices connected"
    description="Connect a hardware wallet to sign transactions securely."
    actionLabel="Connect Device"
    actionTo="/devices/connect"
  />
);
