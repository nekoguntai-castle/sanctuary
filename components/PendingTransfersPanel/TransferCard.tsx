/**
 * TransferCard Component
 *
 * Renders a single transfer card for incoming, outgoing, or awaiting-confirmation transfers.
 * Replaces three near-identical JSX blocks with a single variant-driven component.
 */

import type { Transfer } from '../../types';
import { TransferCardActions } from './TransferCardActions';
import { TransferDirection } from './TransferDirection';
import { TransferMessage } from './TransferMessage';
import { TransferTimestamp } from './TransferTimestamp';
import { TRANSFER_CARD_VARIANTS } from './transferCardData';
import type { TransferCardVariant } from './transferCardData';
import type { TransferAction } from './useTransferActions';

export interface TransferCardProps {
  transfer: Transfer;
  variant: TransferCardVariant;
  actionLoading: string | null;
  onAction: (transferId: string, action: TransferAction) => void;
}

export function TransferCard({
  transfer,
  variant,
  actionLoading,
  onAction,
}: TransferCardProps) {
  const config = TRANSFER_CARD_VARIANTS[variant];
  const Icon = config.Icon;
  const isLoading = actionLoading === transfer.id;

  return (
    <div
      className={`surface-elevated rounded-lg p-4 border ${config.borderClass}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start">
          <div className={`p-2 ${config.iconBgClass} rounded-lg mr-3`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {config.title}
            </p>
            <TransferDirection transfer={transfer} variant={variant} />
            <TransferMessage transfer={transfer} variant={variant} />
            <TransferTimestamp transfer={transfer} variant={variant} />
          </div>
        </div>

        <div className="flex space-x-2">
          <TransferCardActions
            transferId={transfer.id}
            variant={variant}
            isLoading={isLoading}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}
