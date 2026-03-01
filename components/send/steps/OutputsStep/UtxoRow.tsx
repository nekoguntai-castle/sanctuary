import React from 'react';
import {
  Check,
  Lock,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { calculateUTXOAge, getAgeCategoryColor } from '../../../../utils/utxoAge';
import { PrivacyBadge } from '../../../PrivacyBadge';
import type { UTXO } from '../../../../types';
import type { UtxoPrivacyInfo } from '../../../../src/api/transactions';

interface UtxoRowProps {
  utxo: UTXO;
  selectable?: boolean;
  selected: boolean;
  privacyInfo?: UtxoPrivacyInfo;
  onToggle: (utxoId: string) => void;
  format: (amount: number) => string;
  formatFiat: (amount: number) => string | null;
}

export const UtxoRow: React.FC<UtxoRowProps> = ({
  utxo,
  selectable = true,
  selected,
  privacyInfo,
  onToggle,
  format,
  formatFiat,
}) => {
  const utxoId = `${utxo.txid}:${utxo.vout}`;

  return (
    <div
      onClick={() => selectable && onToggle(utxoId)}
      className={`
        p-3 rounded-lg border transition-all
        ${selectable ? 'cursor-pointer hover:shadow-sm' : 'cursor-not-allowed opacity-50'}
        ${selected
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
        }
      `}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {selectable && (
            <div
              className={`
                w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                ${selected
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-sanctuary-300 dark:border-sanctuary-600'
                }
              `}
            >
              {selected && <Check className="w-2.5 h-2.5 text-white" />}
            </div>
          )}
          {!selectable && utxo.frozen && (
            <Lock className="w-3.5 h-3.5 text-sanctuary-400" />
          )}

          <div className="min-w-0">
            <div className="font-mono text-xs text-sanctuary-900 dark:text-sanctuary-100 truncate">
              {utxo.address.slice(0, 8)}...{utxo.address.slice(-6)}
            </div>
            <div className="text-[10px] text-sanctuary-500 flex items-center gap-1.5">
              {utxo.confirmations < 6 ? (
                <span className="text-amber-500 flex items-center gap-0.5">
                  <AlertCircle className="w-2.5 h-2.5" />
                  {utxo.confirmations} conf
                </span>
              ) : (
                (() => {
                  const age = calculateUTXOAge({ confirmations: utxo.confirmations, date: utxo.date });
                  return (
                    <span className={`flex items-center gap-0.5 ${getAgeCategoryColor(age.category)}`}>
                      <Clock className="w-2.5 h-2.5" />
                      {age.shortText}
                    </span>
                  );
                })()
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Privacy Badge */}
          {privacyInfo?.score && (
            <PrivacyBadge
              grade={privacyInfo.score.grade}
              score={privacyInfo.score.score}
              size="sm"
            />
          )}

          <div className="text-right">
            <div className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100">
              {format(utxo.amount)}
            </div>
            {formatFiat(utxo.amount) && (
              <div className="text-[10px] text-sanctuary-500">
                {formatFiat(utxo.amount)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
