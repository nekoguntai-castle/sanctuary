import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import type { Transaction } from '../../../types';
import { Amount } from '../../Amount';
import { getConfirmationStatus } from './detailsModel';

type TransactionAmountHeroProps = {
  selectedTx: Transaction;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
};

export function TransactionAmountHero({
  selectedTx,
  confirmationThreshold,
  deepConfirmationThreshold,
}: TransactionAmountHeroProps) {
  const status = getConfirmationStatus(
    selectedTx.confirmations,
    confirmationThreshold,
    deepConfirmationThreshold
  );

  return (
    <div className="text-center">
      <div className={`text-4xl font-bold mb-2 ${selectedTx.amount > 0 ? 'text-success-600 dark:text-success-400' : 'text-sanctuary-900 dark:text-sanctuary-100'}`}>
        <Amount
          sats={selectedTx.amount}
          showSign={selectedTx.amount > 0}
          size="xl"
          className="items-center"
        />
      </div>
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${status.className}`}>
        <ConfirmationIcon icon={status.icon} />
        {status.label}
      </span>
    </div>
  );
}

function ConfirmationIcon({ icon }: { icon: 'shield' | 'check' | 'clock' }) {
  if (icon === 'shield') {
    return <ShieldCheck className="w-4 h-4 mr-2" />;
  }

  if (icon === 'check') {
    return <CheckCircle2 className="w-4 h-4 mr-2" />;
  }

  return <Clock className="w-4 h-4 mr-2" />;
}
