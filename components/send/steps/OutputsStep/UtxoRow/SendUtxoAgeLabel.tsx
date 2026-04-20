import { AlertCircle, Clock } from 'lucide-react';
import type { UTXO } from '../../../../../types';
import { calculateUTXOAge, getAgeCategoryColor } from '../../../../../utils/utxoAge';

interface SendUtxoAgeLabelProps {
  utxo: UTXO;
}

export function SendUtxoAgeLabel({ utxo }: SendUtxoAgeLabelProps) {
  if (utxo.confirmations < 6) {
    return (
      <span className="text-amber-500 flex items-center gap-0.5">
        <AlertCircle className="w-2.5 h-2.5" />
        {utxo.confirmations} conf
      </span>
    );
  }

  const age = calculateUTXOAge({ confirmations: utxo.confirmations, date: utxo.date });

  return (
    <span className={`flex items-center gap-0.5 ${getAgeCategoryColor(age.category)}`}>
      <Clock className="w-2.5 h-2.5" />
      {age.shortText}
    </span>
  );
}
