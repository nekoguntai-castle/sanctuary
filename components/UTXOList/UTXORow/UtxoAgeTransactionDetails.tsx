import { ExternalLink } from 'lucide-react';
import type { UTXO } from '../../../types';
import { getTxExplorerUrl } from '../../../utils/explorer';
import { calculateUTXOAge, getAgeCategoryColor } from '../../../utils/utxoAge';

interface UtxoAgeTransactionDetailsProps {
  utxo: UTXO;
  network: string;
  explorerUrl: string;
}

export function UtxoAgeTransactionDetails({
  utxo,
  network,
  explorerUrl,
}: UtxoAgeTransactionDetailsProps) {
  const age = calculateUTXOAge(utxo);
  const confirmationText = utxo.confirmations.toLocaleString();

  return (
    <div className="text-xs text-sanctuary-400 text-right">
      <span
        className={`font-medium ${getAgeCategoryColor(age.category)}`}
        title={`${confirmationText} confirmations`}
      >
        {age.displayText}
      </span>
      <span className="text-[10px] opacity-70"> old</span>
      <br />
      <span className="text-[10px] opacity-70">{confirmationText} confs</span>
      <br />
      <a
        href={`${getTxExplorerUrl(utxo.txid, network, explorerUrl)}#vout=${utxo.vout}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center font-mono text-[10px] text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 hover:underline"
        title={`View transaction ${utxo.txid} output #${utxo.vout} on block explorer`}
      >
        txid:{utxo.txid.substring(0, 8)}...:{utxo.vout}
        <ExternalLink className="w-2.5 h-2.5 ml-1" />
      </a>
    </div>
  );
}
