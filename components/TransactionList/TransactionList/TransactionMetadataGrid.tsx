import type { Transaction } from '../../../types';
import { DetailCard } from './DetailCard';
import {
  getBlockHeightCard,
  getFeeOrConfirmationCard,
  getTimestampParts,
  getTransactionTypeInfo,
} from './detailsModel';

type TransactionMetadataGridProps = {
  selectedTx: Transaction;
  walletAddresses: string[];
  format: (sats: number, options?: { forceSats?: boolean }) => string;
};

export function TransactionMetadataGrid({
  selectedTx,
  walletAddresses,
  format,
}: TransactionMetadataGridProps) {
  const typeInfo = getTransactionTypeInfo(selectedTx, walletAddresses);
  const timestamp = getTimestampParts(selectedTx);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
        <p className="text-xs text-sanctuary-500 mb-1">Type</p>
        <p className={`text-sm font-medium ${typeInfo.className}`}>{typeInfo.label}</p>
      </div>

      <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
        <p className="text-xs text-sanctuary-500 mb-1">Date & Time</p>
        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{timestamp.date}</p>
        <p className="text-xs text-sanctuary-500">{timestamp.time}</p>
      </div>

      <DetailCard {...getBlockHeightCard(selectedTx)} />
      <DetailCard {...getFeeOrConfirmationCard(selectedTx, format)} />
    </div>
  );
}
