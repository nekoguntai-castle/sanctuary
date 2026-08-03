import { Clock } from 'lucide-react';
import type { Transfer } from '../../types';
import { getTransferTimestamp } from './transferCardData';
import type { TransferCardVariant } from './transferCardData';
import { formatExpiry } from './transferTimeUtils';

interface TransferTimestampProps {
  transfer: Transfer;
  variant: TransferCardVariant;
}

export function TransferTimestamp({ transfer, variant }: TransferTimestampProps) {
  return (
    <div className="flex items-center text-xs text-sanctuary-400 mt-2 space-x-3">
      <span>{getTransferTimestamp(transfer, variant)}</span>
      <span className="flex items-center">
        <Clock className="w-3 h-3 mr-1" />
        {formatExpiry(transfer.expiresAt)}
      </span>
    </div>
  );
}
