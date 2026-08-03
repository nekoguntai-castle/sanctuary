import { ArrowRight } from 'lucide-react';
import type { Transfer } from '../../types';
import { getTransferDirectionLabels } from './transferCardData';
import type { TransferCardVariant } from './transferCardData';

interface TransferDirectionProps {
  transfer: Transfer;
  variant: TransferCardVariant;
}

export function TransferDirection({ transfer, variant }: TransferDirectionProps) {
  const { leftLabel, rightLabel, leftClassName, rightClassName } = getTransferDirectionLabels(
    transfer,
    variant,
  );

  return (
    <div className="flex items-center text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-1">
      <span className={leftClassName}>{leftLabel}</span>
      <ArrowRight className="w-4 h-4 mx-1" />
      <span className={rightClassName}>{rightLabel}</span>
    </div>
  );
}
