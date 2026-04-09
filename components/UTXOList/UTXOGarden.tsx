import React from 'react';
import { Shield } from 'lucide-react';
import type { UTXO } from '../../types';
import { calculateUTXOAge } from '../../utils/utxoAge';
import { isDustUtxo, getSpendCost } from './dustUtils';

interface UTXOGardenProps {
  utxos: UTXO[];
  selectedUtxos: Set<string>;
  onToggleSelect?: (id: string) => void;
  currentFeeRate: number;
  showPrivacy: boolean;
  format: (sats: number) => string;
}

const DAY_MS = 86400000;

function getAgeColor(timestamp: number, now: number): string {
  const age = now - timestamp;
  if (age < DAY_MS) return 'bg-zen-matcha border-zen-matcha'; // Fresh
  if (age < DAY_MS * 30) return 'bg-zen-indigo border-zen-indigo'; // Month
  if (age < DAY_MS * 365) return 'bg-zen-gold border-zen-gold'; // Year
  return 'bg-sanctuary-700 border-sanctuary-700'; // Ancient
}

function getSize(amount: number, maxAmount: number): number {
  const MIN_SIZE = 14;
  const MAX_SIZE = 48;
  // Use square root so circle AREA is proportional to amount (more perceptually accurate)
  const ratio = Math.sqrt(amount / maxAmount);
  return Math.round(MIN_SIZE + ratio * (MAX_SIZE - MIN_SIZE));
}

export const UTXOGarden: React.FC<UTXOGardenProps> = ({
  utxos,
  selectedUtxos,
  onToggleSelect,
  currentFeeRate,
  showPrivacy,
  format,
}) => {
  const maxAmount = Math.max(...utxos.map(u => u.amount), 1);
  const now = Date.now();

  return (
    <div className="surface-elevated rounded-lg p-3 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex flex-wrap gap-1.5 items-center justify-start">
        {utxos.map((utxo) => {
          const id = `${utxo.txid}:${utxo.vout}`;
          const isSelected = selectedUtxos.has(id);
          const utxoTimestamp = typeof utxo.date === 'string' ? new Date(utxo.date).getTime() : (utxo.date ?? now);
          const isLocked = !!utxo.lockedByDraftId;
          const isDisabled = utxo.frozen || isLocked;
          const isDust = !utxo.frozen && !isLocked && isDustUtxo(utxo, currentFeeRate);
          const spendCost = isDust ? getSpendCost(utxo, currentFeeRate) : 0;
          const colorClass = utxo.frozen || isLocked || isDust ? '' : getAgeColor(utxoTimestamp, now);

          // Red striped pattern for frozen UTXOs
          // Using zen-vermilion color (#e05a47)
          const frozenStyle = utxo.frozen ? {
            background: `repeating-linear-gradient(
              45deg,
              #e05a47,
              #e05a47 4px,
              #c44a3a 4px,
              #c44a3a 8px
            )`
          } : {};

          // Cyan striped pattern for locked UTXOs (reserved for draft)
          const lockedStyle = isLocked && !utxo.frozen ? {
            background: `repeating-linear-gradient(
              45deg,
              #06b6d4,
              #06b6d4 4px,
              #0891b2 4px,
              #0891b2 8px
            )`
          } : {};

          // Amber/orange dotted pattern for dust UTXOs (uneconomical to spend)
          const dustStyle = isDust ? {
            background: `radial-gradient(circle at 25% 25%, #f59e0b 2px, transparent 2px),
                         radial-gradient(circle at 75% 75%, #f59e0b 2px, transparent 2px),
                         #d97706`
          } : {};

          const size = getSize(utxo.amount, maxAmount);
          const age = calculateUTXOAge(utxo);
          const statusLabel = utxo.frozen ? '(Frozen)'
            : isLocked ? `(Locked: ${utxo.lockedByDraftLabel || 'Draft'})`
            : isDust ? `(Dust - costs ${format(spendCost)} to spend)`
            : '';
          return (
            <div
              key={id}
              onClick={() => !isDisabled && onToggleSelect && onToggleSelect(id)}
              style={{
                width: size,
                height: size,
                ...frozenStyle,
                ...lockedStyle,
                ...dustStyle
              }}
              className={`
                relative rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-125 hover:z-10
                ${isDisabled ? 'cursor-not-allowed' : ''}
                ${isSelected ? 'ring-2 ring-offset-1 ring-sanctuary-400 dark:ring-offset-sanctuary-900' : ''}
                ${colorClass} text-white shadow-md
              `}
              title={`${format(utxo.amount)} - ${age.displayText} old - ${utxo.label || 'No Label'} ${statusLabel}`}
            >
              <span className="text-[9px] font-bold opacity-0 hover:opacity-100 transition-opacity absolute bg-black/80 text-white px-1.5 py-0.5 rounded whitespace-nowrap -top-6 z-20 pointer-events-none">
                {format(utxo.amount)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-2 border-t border-sanctuary-100 dark:border-sanctuary-800 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-sanctuary-500">
        <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-zen-matcha mr-1"></span>Fresh</div>
        <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-zen-indigo mr-1"></span>&lt;1mo</div>
        <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-zen-gold mr-1"></span>&lt;1yr</div>
        <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-sanctuary-700 mr-1"></span>Ancient</div>
        <div className="flex items-center"><span className="w-2 h-2 rounded-full mr-1" style={{background: 'radial-gradient(circle at 25% 25%, #f59e0b 1px, transparent 1px), radial-gradient(circle at 75% 75%, #f59e0b 1px, transparent 1px), #d97706'}}></span>Dust</div>
        <div className="flex items-center"><span className="w-2 h-2 rounded-full mr-1" style={{background: 'repeating-linear-gradient(45deg, #06b6d4, #06b6d4 2px, #0891b2 2px, #0891b2 4px)'}}></span>Locked</div>
        <div className="flex items-center"><span className="w-2 h-2 rounded-full mr-1" style={{background: 'repeating-linear-gradient(45deg, #e05a47, #e05a47 2px, #c44a3a 2px, #c44a3a 4px)'}}></span>Frozen</div>
        {showPrivacy && (
          <div className="flex items-center"><Shield className="w-2 h-2 mr-1 text-zen-indigo" />Privacy</div>
        )}
      </div>
    </div>
  );
};
