import { X } from 'lucide-react';
import type { Transaction } from '../../../types';
import { getTimestampParts } from './detailsModel';

type TransactionDetailsHeaderProps = {
  selectedTx: Transaction;
  onClose: () => void;
};

export function TransactionDetailsHeader({ selectedTx, onClose }: TransactionDetailsHeaderProps) {
  const timestamp = getTimestampParts(selectedTx);

  return (
    <div className="sticky top-0 surface-elevated p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex justify-between items-start z-10">
      <div>
        <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Transaction Details</h3>
        <p className="text-sm text-sanctuary-500">{timestamp.header}</p>
      </div>
      <button onClick={onClose} className="p-2 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-full transition-colors">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
