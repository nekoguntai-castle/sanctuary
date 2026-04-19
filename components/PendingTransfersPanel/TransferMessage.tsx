import type { Transfer } from '../../types';
import {
  getAcceptedTransferMessage,
  shouldShowTransferMessage,
} from './transferCardData';
import type { TransferCardVariant } from './transferCardData';

interface TransferMessageProps {
  transfer: Transfer;
  variant: TransferCardVariant;
}

export function TransferMessage({ transfer, variant }: TransferMessageProps) {
  if (variant === 'awaiting_confirmation') {
    return (
      <p className="text-xs text-primary-600 dark:text-primary-400 mt-2">
        {getAcceptedTransferMessage(transfer)}
      </p>
    );
  }

  if (!shouldShowTransferMessage(transfer, variant)) {
    return null;
  }

  return <p className="text-sm text-sanctuary-500 mt-2">"{transfer.message}"</p>;
}
