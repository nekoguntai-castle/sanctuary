import { UtxoGardenDot } from './UTXOGarden/UtxoGardenDot';
import { UtxoGardenLegend } from './UTXOGarden/UtxoGardenLegend';
import { createUtxoGardenDotModel, getMaxUtxoAmount } from './UTXOGarden/utxoGardenModel';
import type { UTXOGardenProps } from './UTXOGarden/types';

export function UTXOGarden({
  utxos,
  selectedUtxos,
  onToggleSelect,
  currentFeeRate,
  showPrivacy,
  format,
}: UTXOGardenProps) {
  const maxAmount = getMaxUtxoAmount(utxos);
  const now = Date.now();

  return (
    <div className="surface-elevated rounded-lg p-3 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex flex-wrap gap-1.5 items-center justify-start">
        {utxos.map((utxo) => (
          <UtxoGardenDot
            key={`${utxo.txid}:${utxo.vout}`}
            model={createUtxoGardenDotModel({
              utxo,
              selectedUtxos,
              currentFeeRate,
              maxAmount,
              now,
              format,
            })}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
      <UtxoGardenLegend showPrivacy={showPrivacy} />
    </div>
  );
}
